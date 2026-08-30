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

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

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
  const { error: insertError } = await supabase.from('documents').insert({
    id: docId,
    title,
    owner_id: userId,
    source_type: 'upload',
    r2_key: key,
  });
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
  return docId;
}
