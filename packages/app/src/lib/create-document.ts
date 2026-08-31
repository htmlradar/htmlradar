// Document creation, shared by the /new server action and POST /api/v1/shares.
//
// Lifted out of new/actions.ts unchanged so the API cannot drift from the
// browser: the INSERT-then-upload ordering, the rollback when R2 fails, and
// the v1 version-history seed are all things the two callers must do
// identically, and the second copy is where they would stop matching.
//
// The caller passes its own Supabase client and userId — the server action's
// is cookie-scoped (RLS), the API's is the service role (no session to scope
// to). owner_id is always written explicitly, so RLS is a backstop here, not
// the thing deciding who owns the row.
//
// Documents are not capped (pricing v4). The free-tier lever is the tracked
// link, enforced at share creation by enforce_share_cap (schema/027).

import type { SupabaseClient } from '@supabase/supabase-js';
import { r2Key, uploadHtml } from './r2';
import { captureServerEvent } from './events';
import { screenHtml, SCREEN_FLAG_THRESHOLD, type ScreenResult } from './screen-html';

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

// How much of an upload the phishing screen reads (schema/039, lib/screen-html).
//
// ponytail: the first five megabytes, which is the whole of anything the public
// API will store, so the browser path is never screened less thoroughly than
// the API path. The browser accepts thirty, and decoding thirty megabytes into
// a UTF-16 string next to the Uint8Array it came from is sixty more megabytes
// on a 128 MB edge isolate — a memory failure on a legitimate upload, to catch
// a phishing kit that has never in its life been larger than a few kilobytes.
// Raise it if a kit ever turns up hiding past the cap.
const SCREEN_MAX_BYTES = 5 * 1024 * 1024;

export type DocumentSource =
  | { type: 'url'; url: string }
  | { type: 'upload'; bytes: Uint8Array; filename: string | null };

// Seed document_versions v1 for a freshly-created document. Retries once
// (failures here are almost always transient edge/network blips) and, if it
// still fails, captures an event so the gap is visible on /admin/events
// instead of silently leaving a document with no recorded v1.
async function seedFirstVersion(
  supabase: SupabaseClient,
  userId: string,
  row: {
    document_id: string;
    filename: string | null;
    bytes: number | null;
    source_type: 'url' | 'upload';
    source_url: string | null;
    r2_key: string | null;
  },
) {
  const attempt = () =>
    supabase.from('document_versions').insert({ version: 1, replaced_by: userId, ...row });
  let { error } = await attempt();
  if (error) ({ error } = await attempt());
  if (error) {
    console.warn('[version-history] v1 insert failed:', error.message);
    await captureServerEvent({
      event: 'version.v1_seed_failed',
      distinctId: userId,
      userId,
      properties: { document_id: row.document_id, error: error.message },
    });
  }
}

/**
 * Score the bytes of an upload. The cap is the whole of this function's
 * cleverness — see SCREEN_MAX_BYTES.
 */
export function screenUpload(bytes: Uint8Array): ScreenResult {
  return screenHtml(new TextDecoder().decode(bytes.subarray(0, SCREEN_MAX_BYTES)));
}

/**
 * Whether a Postgres error is "this database has not had schema/039 applied".
 *
 * ponytail: deploys land before migrations do here — a push runs CI and
 * deploys itself, while 039 is a human pasting SQL into an editor afterwards —
 * and in that window every write naming a screen column would fail. Both write
 * paths retry without the columns rather than fail a customer's upload. Delete
 * this and its two call sites once 039 has been applied.
 */
export function screenColumnsMissing(message: string): boolean {
  return /screen_score|screen_signals/.test(message);
}

/**
 * Put a high-scoring upload into the abuse queue for a human to look at.
 * A no-op below the threshold, so callers do not repeat the comparison.
 *
 * Written straight to the table with the service role rather than through
 * `report_abuse` (schema/037). That RPC is the trust border for a stranger on
 * the internet — it rate limits, it resolves a slug, it counts a hashed
 * address — and none of that applies to our own upload path, which has no
 * address to count, no slug yet (the document exists before any link does) and
 * no reason to be limited. Same reasoning the monitor worker writes
 * telegram_outbox by hand (schema/038): an RPC exists to let an untrusted
 * caller write safely, and there is no untrusted caller here.
 *
 * Best effort, never throws. A queue write that fails must not fail a
 * customer's upload — the screen exists to inform an operator, not to gate the
 * product. The console line and the captured event are what make a lost write
 * findable afterwards.
 */
export async function flagIfHighScore(
  documentId: string,
  userId: string,
  screen: ScreenResult,
): Promise<void> {
  if (screen.score < SCREEN_FLAG_THRESHOLD) return;

  await captureServerEvent({
    event: 'document.screen_flagged',
    distinctId: userId,
    userId,
    properties: { document_id: documentId, score: screen.score, signals: screen.signals },
  });

  const supabaseUrl = process.env['SUPABASE_URL'] ?? '';
  const serviceRole = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!supabaseUrl || !serviceRole) {
    console.warn('[screen] flagged document %s but the service role is not configured', documentId);
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/abuse_reports`, {
      method: 'POST',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        document_id: documentId,
        // 'phishing' is what the recipient's report form calls "phishing or
        // impersonation", and it is already in the CHECK constraint on
        // abuse_reports.reason. An automated flag is the same claim about the
        // same page arriving from a different direction, so it needs no new
        // value; `note` is what says a machine said it.
        reason: 'phishing',
        note: `automated upload screen: score ${screen.score}, ${screen.signals.join(', ')}`.slice(
          0,
          500,
        ),
      }),
    });
    if (!res.ok) {
      console.warn('[screen] abuse_reports insert failed for %s: %s', documentId, res.status);
    }
  } catch (err) {
    console.warn('[screen] abuse_reports insert threw for %s: %s', documentId, String(err));
  }
}

/**
 * Create a document owned by `userId` and return its id. Throws on failure.
 *
 * INSERT-then-upload, not upload-then-INSERT: if the row cannot be written we
 * never touch R2, and if the upload fails afterwards the row is deleted so a
 * retry starts clean.
 */
export async function createDocumentForUser(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  source: DocumentSource,
): Promise<string> {
  const docId = crypto.randomUUID();

  if (source.type === 'url') {
    const { error } = await supabase.from('documents').insert({
      id: docId,
      title,
      owner_id: userId,
      source_type: 'url',
      source_url: source.url,
    });
    if (error) throw new Error(error.message);

    // Seed version history (schema 018) with v1. Awaited because the Edge
    // runtime may terminate the worker after the response; retried + logged on
    // failure rather than silently dropped (see seedFirstVersion).
    await seedFirstVersion(supabase, userId, {
      document_id: docId,
      filename: null,
      bytes: null,
      source_type: 'url',
      source_url: source.url,
      r2_key: null,
    });
    return docId;
  }

  const key = r2Key(userId, docId, 1);

  // The phishing screen, on the same INSERT rather than a second write: the
  // score is a property of the upload and costs nothing to carry with it.
  //
  // A URL-source document is not screened at all — there is no HTML here to
  // read, and fetching the address to get some would be a network call on the
  // upload path and a request-forgery surface besides. Those rows keep a null
  // score, which is honestly "not screened" rather than "screened, clean".
  //
  // Row-level security scopes rows, not columns (the lesson of schema/032 and
  // 033), so a customer holding the anon key can UPDATE their own document's
  // screen_score to zero through PostgREST. That is worth knowing and is not
  // worth defending: the score is advisory, and the thing an operator acts on
  // is the abuse_reports row below, which no customer-facing role can read,
  // write or delete.
  const screen = screenUpload(source.bytes);

  const row = { id: docId, title, owner_id: userId, source_type: 'upload', r2_key: key };

  let { error: insertError } = await supabase
    .from('documents')
    .insert({ ...row, screen_score: screen.score, screen_signals: screen.signals });
  if (insertError && screenColumnsMissing(insertError.message)) {
    console.warn('[screen] documents has no screen columns yet — schema/039 is not applied');
    ({ error: insertError } = await supabase.from('documents').insert(row));
  }
  if (insertError) throw new Error(insertError.message);

  try {
    await uploadHtml(key, source.bytes);
  } catch (err) {
    // Roll back the row so the user can retry against a clean slate.
    await supabase.from('documents').delete().eq('id', docId);
    throw err;
  }

  await seedFirstVersion(supabase, userId, {
    document_id: docId,
    filename: source.filename,
    bytes: source.bytes.byteLength,
    source_type: 'upload',
    source_url: null,
    r2_key: key,
  });

  // After the upload, so a document that never made it into R2 never reaches
  // the queue. If a caller rolls the document back afterwards — the API does,
  // when the link it was created for is refused — the row goes with it on the
  // foreign key cascade, which is correct: there is no longer a document for
  // an operator to look at. The captured event above has no foreign key and
  // survives, so the attempt is still visible on /admin/events.
  await flagIfHighScore(docId, userId, screen);
  return docId;
}
