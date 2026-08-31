// POST /api/v1/shares/{id}/revoke — switch a link off, or back on.
//
// The undo. A tool that can publish to a public address and cannot take it
// down again is a tool whose worst mistake needs a browser to fix, and that
// is the whole reason this endpoint exists (31 August decision: revoking yes,
// deleting no). Deletion stays on the website: revoking is reversible and
// deleting is not, and an assistant that misreads a sentence must not be able
// to destroy a live client link.
//
// The write is the same shape as the create route's `lock_deck` follow-up: the
// dashboard's toggle runs through a cookie-scoped client and reads auth.uid(),
// which an API request does not have, so the service client writes the column
// directly and scopes the statement by id AND owner. Both filters, always —
// the id alone would be somebody else's link with a typo.
//
// Two-way, because the dashboard's toggleShareAction is: it flips revoked_at
// between a timestamp and null. `{"revoked": false}` puts a link back.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  BODY_TIMED_OUT,
  CHEAP_MAX,
  errorResponse,
  INTERNAL,
  jsonResponse,
  NOT_FOUND,
  readBodyCapped,
  REQUEST_TIMEOUT,
  serviceClient,
  validationError,
} from '@/lib/api-auth';
import { findOwnedShare } from '@/lib/api-share-lookup';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { shareUrl } from '@/lib/share-url';

export const runtime = 'edge';

const ROUTE = '/api/v1/shares/{id}/revoke';

// A body is optional here and never large: `{"revoked": false}` is the whole
// of it. The cap is small so a caller cannot stream a megabyte at an endpoint
// that reads one boolean.
const MAX_BODY_BYTES = 4096;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authenticateApiKey(req, {
    name: 'share-revoke',
    per: 'account',
    max: CHEAP_MAX,
    write: true,
  });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  let revoked = true;
  const raw = await readBodyCapped(req, MAX_BODY_BYTES);
  if (raw === null) return errorResponse(validationError('Body must be a small JSON object.'));
  if (raw === BODY_TIMED_OUT) return errorResponse(REQUEST_TIMEOUT);
  if (raw.trim()) {
    let body: { revoked?: unknown };
    try {
      body = JSON.parse(raw) as { revoked?: unknown };
    } catch {
      return errorResponse(validationError('Body must be JSON.'));
    }
    if (body?.revoked !== undefined) {
      if (typeof body.revoked !== 'boolean') {
        return errorResponse(validationError('"revoked" must be a boolean.'));
      }
      revoked = body.revoked;
    }
  }

  const supabase = serviceClient();
  const share = await findOwnedShare<{ id: string; slug: string; owner_id: string }>(
    supabase,
    caller.userId,
    params.id,
    'id, slug',
  );
  if (!share) return errorResponse(NOT_FOUND);

  const revokedAt = revoked ? new Date().toISOString() : null;
  const { error } = await supabase
    .from('document_shares')
    .update({ revoked_at: revokedAt })
    .eq('id', share.id)
    .eq('owner_id', caller.userId);
  if (error) {
    await logServerError({
      source: 'api.v1.shares.revoke',
      message: error.message,
      userId: caller.userId,
      route: ROUTE,
      context: { step: 'set_revoked_at', share_id: share.id, revoked },
    });
    return errorResponse(INTERNAL);
  }

  // The same two event names the dashboard's toggle emits, so a revoke from
  // an assistant and a revoke from the website are one number.
  await captureServerEvent({
    event: revoked ? 'share.revoked' : 'share.reactivated',
    distinctId: caller.userId,
    userId: caller.userId,
    properties: { share_id: share.id, via: 'api' },
  });

  return jsonResponse(200, {
    share_id: share.id,
    url: shareUrl(share.slug),
    revoked,
    revoked_at: revokedAt,
  });
}
