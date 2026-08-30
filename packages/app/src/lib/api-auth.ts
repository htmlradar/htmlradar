// Bearer-key authentication and error shaping for the public API
// (src/app/api/v1/**). Everything here is edge-safe: Web Crypto only, no Node
// built-ins.
//
// A key looks like `hr_live_` followed by 40 lowercase hex characters — 20
// bytes of CSPRNG output, which is the same order of entropy as a UUIDv4 and
// well past guessing. The key is shown to the customer exactly once at
// creation; only its SHA-256 hash is ever stored (schema/034_api_keys.sql), so
// a dump of api_keys cannot be replayed against the API.
//
// Nothing in this file logs the key, the hash, or any prefix of them.

import { createClient } from '@supabase/supabase-js';
import { describeSlugError } from './share-slug';

export const API_KEY_PREFIX = 'hr_live_';
const API_KEY_PATTERN = /^hr_live_[0-9a-f]{40}$/;

// How much of a key is stored in the clear, so the owner can tell two keys
// apart in the settings list: the prefix plus six hex characters.
const VISIBLE_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;

const UPGRADE_URL = 'https://htmlradar.com/upgrade';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh key. Shown once, then only its hash survives. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + toHex(crypto.getRandomValues(new Uint8Array(20)));
}

/** The part of a key that is safe to store and display. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, VISIBLE_PREFIX_LENGTH);
}

/**
 * The key out of an `Authorization: Bearer …` header, or null.
 *
 * Anything that is not exactly a well-formed key is null rather than a
 * lookup: a malformed header should cost a regex, not a database round trip,
 * and it keeps arbitrary caller-controlled text away from the query.
 */
export function parseBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/.exec(header.trim());
  const key = match?.[1];
  return key && API_KEY_PATTERN.test(key) ? key : null;
}

/** SHA-256, lowercase hex — the form stored in api_keys.key_hash. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return toHex(new Uint8Array(digest));
}

export function serviceClient() {
  // Read at request time: next-on-pages cannot always resolve env at module
  // load on the edge runtime (same reason settings/page.tsx reads inline).
  return createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface ApiCaller {
  userId: string;
  tier: 'free' | 'pro';
}

/**
 * Who is calling, or null if nobody valid is.
 *
 * The lookup and the `last_used_at` stamp are one statement: the WHERE clause
 * is the authentication (hash matches AND not revoked) and RETURNING is the
 * answer, so a revoked key cannot be authenticated by a code path that forgot
 * to check. One round trip, and no un-awaited write that the edge runtime
 * would cancel after the response.
 */
export async function authenticateApiKey(req: Request): Promise<ApiCaller | null> {
  const key = parseBearerKey(req.headers.get('authorization'));
  if (!key) return null;

  const supabase = serviceClient();
  const { data: row } = await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', await hashApiKey(key))
    .is('revoked_at', null)
    .select('user_id')
    .maybeSingle();
  if (!row) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', row.user_id)
    .maybeSingle();

  return { userId: row.user_id as string, tier: profile?.tier === 'pro' ? 'pro' : 'free' };
}

export interface ApiErrorResponse {
  status: number;
  body: Record<string, unknown>;
}

export const INVALID_KEY: ApiErrorResponse = { status: 401, body: { error: 'invalid_api_key' } };

export const FREE_LIMIT_REACHED: ApiErrorResponse = {
  status: 402,
  body: {
    error: 'free_limit_reached',
    message: `Free accounts get 2 tracked links. Upgrade at ${UPGRADE_URL}`,
    upgrade_url: UPGRADE_URL,
  },
};

// Two fixed 500s. A caller learns that the call failed on our side and
// nothing else: a Postgres constraint name, an R2 object key or a storage
// message tells them about the shape of the system behind the endpoint, and
// none of it is anything they can act on. The detail goes to logServerError
// at the call site instead, where it stays queryable.
export const INTERNAL: ApiErrorResponse = { status: 500, body: { error: 'internal' } };
export const STORAGE_FAILED: ApiErrorResponse = {
  status: 500,
  body: { error: 'storage_failed' },
};

export function tooLarge(maxBytes: number): ApiErrorResponse {
  return { status: 413, body: { error: 'too_large', max_bytes: maxBytes } };
}

export function validationError(message: string): ApiErrorResponse {
  return { status: 422, body: { error: 'validation', message } };
}

/**
 * A Postgres error from create_share_as, as an API response.
 *
 * The free-tier cap is the one that gets its own status: 402 is the whole
 * point of the endpoint returning something a caller can act on. The match is
 * the same pair of strings createShareFormAction matches on, so the browser
 * and the API cannot disagree about what "you are out of links" looks like.
 * Chosen-address failures reuse the customer-facing copy from share-slug.ts
 * for the same reason.
 *
 * Every message returned from here is one we wrote. An unrecognised message is
 * an unrecognised message — passing it through would forward whatever Postgres
 * said, which is how constraint names and internal identifiers reach a caller.
 * It becomes a 500 the call site logs in full.
 */
export function mapCreateShareError(message: string): ApiErrorResponse {
  if (/free_tier_share_cap_reached|tracked links, lifetime/i.test(message)) {
    return FREE_LIMIT_REACHED;
  }
  const slugProblem = describeSlugError(message);
  if (slugProblem) return validationError(slugProblem);
  if (message.includes('document_not_found')) {
    return validationError('That document does not exist, or it is not yours.');
  }
  if (message.includes('password_too_short')) {
    return validationError('Password must be at least 8 characters.');
  }
  return INTERNAL;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(err: ApiErrorResponse): Response {
  return jsonResponse(err.status, err.body);
}
