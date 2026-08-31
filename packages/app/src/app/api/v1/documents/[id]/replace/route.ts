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
  REQUEST_TIMEOUT,
  serviceClient,
  STORAGE_FAILED,
  tooLarge,
  validationError,
} from '@/lib/api-auth';
import { flagIfHighScore, screenUpload } from '@/lib/create-document';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { r2Key, uploadHtml } from '@/lib/r2';

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
  const nextVersion = (document.current_version ?? 0) + 1;
  const newKey = r2Key(caller.userId, document.id as string, nextVersion);

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

  // The score describes the document being served now, so it is rewritten on
  // every replace rather than kept at its highest — the same line the browser
  // path takes.
  const { error: updateError } = await supabase
    .from('documents')
    .update({
      current_version: nextVersion,
      r2_key: newKey,
      updated_at: new Date().toISOString(),
      screen_score: screen.score,
      screen_signals: screen.signals,
    })
    .eq('id', document.id)
    .eq('owner_id', caller.userId);
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
