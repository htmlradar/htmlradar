// POST /api/v1/documents/{id}/replace — new content behind the same links.
//
// The loop the product is for: an assistant reads that four of six recipients
// stopped at the third section, rewrites that section, and the links already
// sitting in those recipients' inboxes serve the new version on the next
// open. Nobody is sent a second link and nothing about the links changes.
//
// The five steps are replaceDocumentAction's, in its order and with its
// failure handling (app/(app)/docs/[id]/actions.ts):
//
//   1. upload the new bytes at the next version's key — first, so a failed
//      upload leaves every recipient reading the version they already had;
//   2. update the document row to point at it (an orphaned R2 object is the
//      acceptable failure here, and the sweep collects those);
//   3. flag the document if the phishing screen scored it high;
//   4. append the version-history row (schema/018), logged and swallowed on
//      failure, because a successful replace must not roll back over a
//      missed history row;
//   5. record the event.
//
// The screen runs on the new bytes before any of that. Replacement is exactly
// the swap-content-behind-a-trusted-link move the screen exists for — upload
// an innocent page, get it past the screen, then replace it with the kit —
// and it screens and flags rather than blocking, which is what every other
// upload path does. A wrong "no" costs a paying customer their document.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  BODY_TIMED_OUT,
  creationMax,
  errorResponse,
  INTERNAL,
  jsonResponse,
  NOT_FOUND,
  readBodyCapped,
  REPLACE_CONFLICT,
  REQUEST_TIMEOUT,
  serviceClient,
  STORAGE_FAILED,
  tooLarge,
  validationError,
} from '@/lib/api-auth';
import { flagIfHighScore, screenUpload } from '@/lib/create-document';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { deleteR2Object, r2Key, uploadHtml } from '@/lib/r2';

export const runtime = 'edge';

const ROUTE = '/api/v1/documents/{id}/replace';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The same two ceilings the create route has, for the same reasons: 5 MB of
// document, and half a megabyte of slack above it for JSON escaping.
const MAX_API_HTML_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 5.5 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Replacing is storing a document, so it spends the creation budget: 75 an
  // hour on Pro, 30 on free. A loop that replaces is as expensive as a loop
  // that creates, and it would otherwise have a budget of its own to spend.
  const auth = await authenticateApiKey(req, {
    name: 'shares',
    per: 'account',
    max: creationMax,
    perIpMax: 120,
    write: true,
  });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return errorResponse(tooLarge(MAX_API_HTML_BYTES));
  }

  let body: { html?: unknown };
  try {
    const raw = await readBodyCapped(req, MAX_REQUEST_BYTES);
    if (raw === null) return errorResponse(tooLarge(MAX_API_HTML_BYTES));
    if (raw === BODY_TIMED_OUT) return errorResponse(REQUEST_TIMEOUT);
    body = JSON.parse(raw) as { html?: unknown };
  } catch {
    return errorResponse(validationError('Body must be JSON.'));
  }

  const html = typeof body?.html === 'string' ? body.html : null;
  if (html === null) return errorResponse(validationError('"html" is required.'));
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength > MAX_API_HTML_BYTES) return errorResponse(tooLarge(MAX_API_HTML_BYTES));
  if (!/<[a-z!/]/i.test(html)) {
    return errorResponse(validationError('"html" does not look like HTML.'));
  }

  if (!UUID.test(params.id)) return errorResponse(NOT_FOUND);

  const supabase = serviceClient();
  const { data: document } = await supabase
    .from('documents')
    .select('id, source_type, current_version')
    .eq('id', params.id)
    .eq('owner_id', caller.userId)
    .is('deleted_at', null)
    .maybeSingle();
  // Not the caller's, deleted, or never there: one answer for all three.
  if (!document) return errorResponse(NOT_FOUND);
  if (document.source_type !== 'upload') {
    return errorResponse(
      validationError('That document is served from its own address; there is nothing to replace.'),
    );
  }

  const screen = screenUpload(bytes);
  const readVersion = (document.current_version as number | null) ?? 0;
  const nextVersion = readVersion + 1;

  // The object goes to a key nobody else can be writing at the same moment.
  // Two replacements that both read version 3 both call the next one 4, and if
  // they shared v4.html the loser's tidy-up would delete the winner's bytes
  // and every recipient would get a 404 from a link that was working. The row
  // is the only thing that says where a document lives (documents.r2_key is
  // what the proxy reads; nothing anywhere rebuilds a key from the version),
  // so the suffix costs nothing.
  const newKey = r2Key(caller.userId, document.id as string, nextVersion).replace(
    /\.html$/,
    `-${crypto.randomUUID().slice(0, 8)}.html`,
  );

  try {
    await uploadHtml(newKey, bytes);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not store the document.';
    await logServerError({
      source: 'api.v1.documents.replace',
      message,
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'upload', document_id: document.id },
    });
    return errorResponse(STORAGE_FAILED);
  }

  // Compare and swap, because there is no transaction to be had here: an edge
  // route talks to PostgREST, one statement at a time. The update only lands
  // on a row that is still at the version this call read and is still not
  // deleted, so of two replacements racing for version 4 exactly one wins, and
  // a delete that landed while the bytes were uploading takes the swap with
  // it. Returning the row is what makes the loss visible — an update that
  // matches nothing is a success with no rows, not an error.
  //
  // The score describes the document being served now, so it is rewritten on
  // every replace rather than kept at its highest — the same line the browser
  // path takes.
  const { data: claimed, error: updateError } = await supabase
    .from('documents')
    .update({
      current_version: nextVersion,
      r2_key: newKey,
      updated_at: new Date().toISOString(),
      screen_score: screen.score,
      screen_signals: screen.signals,
    })
    .eq('id', document.id)
    .eq('owner_id', caller.userId)
    .eq('current_version', readVersion)
    .is('deleted_at', null)
    .select('id');
  if (updateError) {
    // The uploaded object is now an orphan: the row still points at the
    // previous version and every recipient still reads it. Same trade the
    // browser path makes — the sweep collects the object, and nobody is
    // served a document their sender did not mean to publish.
    await logServerError({
      source: 'api.v1.documents.replace',
      message: updateError.message,
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'update_document', document_id: document.id, version: nextVersion },
    });
    return errorResponse(INTERNAL);
  }

  // Nothing matched: somebody else replaced this document, or deleted it,
  // between the read at the top of this call and here. The bytes just uploaded
  // belong to nothing, and this is the one moment anybody knows that, so they
  // go now rather than waiting for a sweep.
  if (!claimed || claimed.length === 0) {
    try {
      await deleteR2Object(newKey);
    } catch {
      // An orphaned object is the acceptable half of this failure; a 500 in
      // place of an honest 409 is not.
    }
    return errorResponse(REPLACE_CONFLICT);
  }

  await flagIfHighScore(document.id as string, caller.userId, screen);

  // History-write failure is logged and swallowed: a successful replace must
  // not be rolled back over a missed history row.
  const { error: versionError } = await supabase.from('document_versions').insert({
    document_id: document.id,
    version: nextVersion,
    filename: null,
    bytes: bytes.byteLength,
    source_type: 'upload',
    r2_key: newKey,
    replaced_by: caller.userId,
  });
  if (versionError) {
    console.warn('[version-history] replace insert failed:', versionError.message);
  }

  await captureServerEvent({
    event: 'document.replaced',
    distinctId: caller.userId,
    userId: caller.userId,
    properties: { document_id: document.id, version: nextVersion, via: 'api' },
  });

  return jsonResponse(200, {
    document_id: document.id,
    version: nextVersion,
    // Said out loud because it is the point of the endpoint, and because an
    // assistant relaying this to a person should relay that part.
    links_unchanged: true,
  });
}
