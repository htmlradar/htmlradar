// Types, scope names and the keyed hash that the two halves of the consent
// hand-off share.
//
// The contract these implement is docs/workstreams/mcp-product/
// CONNECTOR-CONTRACT-2026-09-02.md; the application's /connect route is
// written against the same document, so the field order below is a promise,
// not a detail.

import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  OAUTH_KV: KVNamespace;
  /** Injected by the OAuth library before it calls our handlers. */
  OAUTH_PROVIDER: OAuthHelpers;
  APP_BASE_URL: string;
  API_BASE_URL: string;
  SERVER_URL: string;
  GIT_SHA?: string;
  CONNECT_SIGNING_SECRET: string;
  CONNECT_EXCHANGE_SECRET: string;
}

/**
 * What a grant carries, encrypted by the library under key material derived
 * from the issued access token — so only a request bearing that token can
 * decrypt it.
 *
 * `apiKey` is an ordinary `hr_live_` key the application minted at consent.
 * That is the whole point of the design: past this line every tool call is
 * exactly the call the stdio server makes, and there is no second identity
 * system to keep in step.
 */
export interface Props {
  userId: string;
  apiKey: string;
  apiKeyId: string;
  scope: string;
}

export const SCOPE_READ = 'shares:read';
export const SCOPE_WRITE = 'shares:write';
export const ALL_SCOPES = [SCOPE_READ, SCOPE_WRITE];

/** The four tools a read-only grant may not call. */
export const WRITE_TOOLS = new Set([
  'share_html',
  'create_share',
  'replace_document',
  'revoke_share',
]);

/**
 * The requested scopes, reduced to the ones we issue.
 *
 * Unknown values are dropped rather than refused: clients send extras, and a
 * grant narrower than the request is the safe direction. An empty result is
 * read-only, never nothing.
 */
export function knownScopes(requested: readonly string[]): string[] {
  const kept = ALL_SCOPES.filter((scope) => requested.includes(scope));
  return kept.length > 0 ? kept : [SCOPE_READ];
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The signature over one leg of the hand-off.
 *
 * The parts are joined with a newline, which none of them can contain — a
 * transaction id is hex, a scope list is space-separated, an expiry is digits,
 * and a client id is a URL. Concatenating without a separator would let two
 * different parameter sets produce one string.
 */
export async function sign(secret: string, parts: string[]): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(parts.join('\n')),
  );
  return base64url(mac);
}

/** Constant-time comparison, so a wrong signature cannot be found a byte at a time. */
export async function verify(secret: string, parts: string[], signature: string): Promise<boolean> {
  const expected = await sign(secret, parts);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/** Same comparison, for the shared bearer credential on /connect/revoke. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer[ \t]+(\S+)$/.exec((header ?? '').trim());
  const given = match?.[1] ?? '';
  if (!secret || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) {
    diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The same token identifier the OAuth library computes: SHA-256, lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A fixed-window counter in the one key-value namespace this Worker already
 * has. Returns the seconds to wait, or 0 when the caller is inside its budget.
 *
 * ponytail: fixed window, not a sliding one, and one read plus one write per
 * counted request. A caller can therefore send `max` at the very end of one
 * window and `max` again at the start of the next. That is the known ceiling,
 * and it is fine for the job — this exists to stop a script hammering
 * /authorize and /token, not to shape traffic to the second. The upgrade path
 * is Cloudflare's own rate-limiting binding, which needs no storage at all;
 * take it if the key-value cost ever shows up in a bill.
 *
 * Fails open, like the application's limiter and for the same reason: this is
 * abuse control, not authorisation, and a key-value hiccup must not close the
 * connector. The failure is not silent — it is one line on stderr with no
 * caller identity in it.
 */
export async function retryAfterSeconds(
  env: Env,
  bucket: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<number> {
  const now = nowSeconds();
  const windowStart = now - (now % windowSeconds);
  const key = `rl:${bucket}:${windowStart}:${subject}`;
  try {
    const used = Number((await env.OAUTH_KV.get(key)) ?? '0');
    if (used >= max) return windowStart + windowSeconds - now;
    // Written with a lifetime, so nothing here is ever swept by hand. The
    // minimum a key-value namespace accepts is 60 seconds.
    await env.OAUTH_KV.put(key, String(used + 1), {
      expirationTtl: Math.max(60, windowSeconds),
    });
    return 0;
  } catch {
    console.error(`connector: rate limit counter unavailable for bucket ${bucket}`);
    return 0;
  }
}

/** The 429 the contract asks for: a Retry-After header and a readable body. */
export function tooManyRequests(retryAfter: number): Response {
  return Response.json(
    { error: 'rate_limited', retry_after_seconds: retryAfter },
    { status: 429, headers: { 'retry-after': String(retryAfter), 'cache-control': 'no-store' } },
  );
}
