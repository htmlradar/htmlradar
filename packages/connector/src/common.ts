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

/**
 * Which browser origins may call /mcp.
 *
 * Bearer tokens are not cookies, so a permissive policy is not automatic
 * account theft — but any page that gets hold of a token should not also get a
 * free browser channel to spend it on. Native clients send no Origin at all and
 * are unaffected by any of this; they are allowed through untouched.
 */
export const ALLOWED_ORIGINS = new Set([
  'https://claude.ai',
  'https://www.claude.ai',
  'https://claude.com',
  'https://www.claude.com',
]);

/** A host we are willing to be reached on: the configured one, or a loopback for local runs. */
export function isLoopbackHost(host: string): boolean {
  const name = host.split(':')[0] ?? '';
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

/**
 * Why this Worker cannot safely serve a request, or null when it can.
 *
 * Checked on every request rather than once at module load, because a Worker
 * has no startup hook that can refuse to start — the first request is the
 * earliest honest moment. The answer names the variable and never its value.
 */
export function configurationProblem(env: Env): string | null {
  for (const name of ['CONNECT_SIGNING_SECRET', 'CONNECT_EXCHANGE_SECRET'] as const) {
    const value = env[name];
    if (typeof value !== 'string' || value.length < 32) {
      return `${name} is missing or shorter than 32 characters`;
    }
  }
  if (env.CONNECT_SIGNING_SECRET === env.CONNECT_EXCHANGE_SECRET) {
    // They rotate separately on purpose: a leak of the signing secret must not
    // also be key theft.
    return 'CONNECT_SIGNING_SECRET and CONNECT_EXCHANGE_SECRET are the same value';
  }
  for (const name of ['APP_BASE_URL', 'API_BASE_URL', 'SERVER_URL'] as const) {
    const value = env[name];
    if (!value) return `${name} is not set`;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return `${name} is not a URL`;
    }
    // The exchange secret and a live API key travel to API_BASE_URL, and
    // APP_BASE_URL is where a browser mid-consent is sent, so plain HTTP is
    // only ever acceptable against a loopback address on a dev machine.
    //
    // SERVER_URL is exempt: it is an identifier, not an address anything is
    // sent to, and it has to match the scheme the request actually arrives on
    // or the token audience will not match. A local `wrangler dev` run answers
    // on http for a host that is https in production, so requiring https here
    // would make the connector untestable locally and buy nothing.
    if (name !== 'SERVER_URL' && parsed.protocol !== 'https:' && !isLoopbackHost(parsed.host)) {
      return `${name} is not an https address`;
    }
  }
  return null;
}
