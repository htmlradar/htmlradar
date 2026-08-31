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
import { logServerError } from './error-log';

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
  /**
   * What the key itself may do (schema/040). A read-only key authenticates
   * exactly like a full one and is refused at the routes that write, so a
   * watching assistant can hold a credential that cannot publish, revoke or
   * replace anything. A key created before 040 reads as 'full', which is what
   * it has always been.
   */
  scope: ApiKeyScope;
}

export type ApiKeyScope = 'full' | 'read_only';

/**
 * The hourly creation budget, by plan (31 August 2026 decision).
 *
 * Pro rises to 75 so a hundred personalised links fit inside ninety minutes;
 * free stays at 30. Both are abuse controls rather than pricing — the free
 * plan's actual limit is the two lifetime links the database enforces.
 */
export function creationMax(tier: 'free' | 'pro'): number {
  return tier === 'pro' ? 75 : 30;
}

// Listing and revoking are cheap reads and one-column writes; the budget is
// there so a loop cannot sweep an account, not because the work is expensive.
export const CHEAP_MAX = 120;

/**
 * The most rows one listing call returns.
 *
 * A page an agent can read in one go, and a ceiling on what a single request
 * costs to assemble. Fifty rather than everything, because "list my shares"
 * on an account with ten thousand of them is a request nobody meant to make.
 */
export const PAGE_SIZE = 50;

/**
 * The `before` cursor of a listing request, or the response to send instead.
 *
 * The cursor is the `created_at` of the last row of the previous page, handed
 * back as `next_before`, so paging is a timestamp comparison and needs no
 * server-side state. Anything that is not a timestamp is refused rather than
 * quietly ignored: silently returning page one to a caller that asked for
 * page four is how a loop becomes infinite.
 */
export function readBefore(req: Request): { before: string | null } | { error: ApiErrorResponse } {
  const raw = new URL(req.url).searchParams.get('before');
  if (!raw) return { before: null };
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return {
      error: validationError('"before" must be an ISO 8601 timestamp, as returned in next_before.'),
    };
  }
  return { before: when.toISOString() };
}

// Every public API limit is per hour. One window keeps the buckets, the
// Retry-After arithmetic and the operator's mental model down to one number.
export const RATE_WINDOW_SECONDS = 3600;

// Failed authentications, per IP address. This is the only budget an
// unauthenticated caller has, so it is counted on the address Cloudflare
// gives us rather than on anything the caller chooses.
const BAD_KEY_ATTEMPTS_PER_HOUR = 60;

/**
 * The caller's address, as Cloudflare saw it.
 *
 * ASSUMPTION: the app is a Pages Functions deployment, so every request
 * reaches this code through Cloudflare's edge and `cf-connecting-ip` is set by
 * Cloudflare itself, overwriting anything the caller sent. There is no origin
 * server to reach around the proxy — the code does not run anywhere else — so
 * the header is trustworthy here in a way it would not be behind a normal
 * origin. If this ever moves to hosting with a directly reachable origin, this
 * header stops being evidence and every limit counted on it stops meaning
 * anything.
 *
 * Requests with no header share one `unknown` bucket. That is deliberate: a
 * missing header on this platform means something is wrong, and one shared
 * budget is the safe reading of "we do not know who this is".
 */
function callerIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** Which budget a route spends, and whose it is. */
export interface ApiLimit {
  /** Bucket name. One route's budget is never another's. */
  name: string;
  /** Counted against the whole account, or against the single key calling. */
  per: 'account' | 'key';
  /**
   * The ceiling for this route, or a function of the caller's plan when the
   * two plans differ (see creationMax). Per call site: one route's generosity
   * is never another's.
   */
  max: number | ((tier: 'free' | 'pro') => number);
  /**
   * Optional second budget for the same route, counted on the caller's address
   * instead of their account. The account limit stops one customer running
   * away with the API; this one stops one machine doing it across many
   * accounts, which the per-account counter cannot see.
   */
  perIpMax?: number;
  /**
   * This route changes something. Set on every route that creates, revokes or
   * replaces, so a read-only key is refused here rather than at each route —
   * a route that forgot the check would be a route the scope does not cover.
   */
  write?: boolean;
}

/**
 * Seconds the caller must wait, or 0 when the request is within its limit.
 *
 * The counter is the `rate_limits` table the anon-facing RPCs have always
 * used (schema/001, 002); schema/035 adds the variant that returns the wait
 * instead of a boolean, so a 429 can carry an honest Retry-After.
 *
 * ponytail: fails open. This is abuse control, not authorisation — a Supabase
 * hiccup must not take the API down with it, and the Cloudflare per-IP rule
 * is the layer that still holds when this one cannot. Failing open silently is
 * the part that is not acceptable, so the failure is logged: a missing
 * function, a revoked grant or an outage turns every limit in the API off at
 * once, and that has to be something an operator can see rather than infer.
 *
 * A returned error and a thrown one are the same outage and are treated the
 * same way. They are not the same code path by default: a throw would leave
 * the route with no response at all, and it would skip whatever budget the
 * caller was going to check next.
 */
async function retryAfter(
  supabase: ReturnType<typeof serviceClient>,
  key: string,
  max: number,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('rate_limit_retry_after', {
      p_key: key,
      p_window_seconds: RATE_WINDOW_SECONDS,
      p_max_count: max,
    });
    if (error) return await failOpen(key, error.code ?? 'unknown');
    return typeof data === 'number' && data > 0 ? data : 0;
  } catch (err) {
    // A dropped connection, a gateway 5xx PostgREST could not parse, an
    // aborted fetch: nothing here is the caller's doing and none of it is a
    // reason to refuse them.
    return await failOpen(key, (err as { code?: string } | null)?.code ?? 'exception');
  }
}

/**
 * Records that a budget went unchecked, and answers "no wait".
 *
 * Nothing in here may throw: the logger is one more remote call, and a
 * limiter that fails open except when the log is also down is a limiter that
 * fails closed on exactly the worst day.
 */
async function failOpen(bucket: string, code: string): Promise<number> {
  try {
    // The bucket key and the SQLSTATE, nothing else. The key names a route and
    // a server-generated identifier; it never contains any part of an API key.
    await logServerError({
      source: 'api.rate_limit',
      level: 'warn',
      message: 'rate limiter failed open',
      context: { bucket, code },
    });
  } catch {
    // There is nowhere left to report it. The request still goes through.
  }
  return 0;
}

/**
 * The response for a request that did not authenticate.
 *
 * Both the "no key" and the "unknown key" paths come through here, so the
 * per-IP budget cannot be skipped by choosing which way to fail.
 */
async function refuse(
  supabase: ReturnType<typeof serviceClient>,
  req: Request,
): Promise<ApiErrorResponse> {
  const wait = await retryAfter(
    supabase,
    `api:bad-key:${callerIp(req)}`,
    BAD_KEY_ATTEMPTS_PER_HOUR,
  );
  return wait > 0 ? rateLimited(wait) : INVALID_KEY;
}

export type ApiAuth = { caller: ApiCaller } | { error: ApiErrorResponse };

/**
 * Who is calling, or the response to send instead.
 *
 * The lookup and the `last_used_at` stamp are one statement: the WHERE clause
 * is the authentication (hash matches AND not revoked) and RETURNING is the
 * answer, so a revoked key cannot be authenticated by a code path that forgot
 * to check. One round trip, and no un-awaited write that the edge runtime
 * would cancel after the response.
 *
 * The rate limit is taken here rather than in each route for the same reason
 * the authentication is: a route that forgot to call it would be a route with
 * no limit at all.
 */
export async function authenticateApiKey(req: Request, limit: ApiLimit): Promise<ApiAuth> {
  const supabase = serviceClient();

  const key = parseBearerKey(req.headers.get('authorization'));
  if (!key) return { error: await refuse(supabase, req) };

  const row = await findKeyRow(supabase, await hashApiKey(key));
  if (!row) return { error: await refuse(supabase, req) };

  // Read before the limit rather than after it, because the creation budget
  // is a function of the plan (creationMax). One extra read on a request that
  // is about to be refused, and one number instead of two implementations of
  // "which plan is this".
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', row.user_id)
    .maybeSingle();
  const tier: 'free' | 'pro' = profile?.tier === 'pro' ? 'pro' : 'free';

  const subject = limit.per === 'account' ? row.user_id : row.id;
  const max = typeof limit.max === 'function' ? limit.max(tier) : limit.max;
  const wait = await retryAfter(supabase, `api:${limit.name}:${subject}`, max);
  if (wait > 0) return { error: rateLimited(wait) };

  // Checked after the account budget, so a caller inside its own limit is the
  // only one who ever spends address budget.
  if (limit.perIpMax !== undefined) {
    const ipWait = await retryAfter(
      supabase,
      `api:${limit.name}-ip:${callerIp(req)}`,
      limit.perIpMax,
    );
    if (ipWait > 0) return { error: rateLimited(ipWait) };
  }

  // After the budgets, not before: a script looping on a route its key cannot
  // use still runs into a 429, so the 403 is not a free retry.
  const scope: ApiKeyScope = row.scope === 'read_only' ? 'read_only' : 'full';
  if (limit.write && scope === 'read_only') return { error: READ_ONLY_KEY };

  return { caller: { userId: row.user_id, tier, scope } };
}

/**
 * The key row, with `last_used_at` stamped in the same statement.
 *
 * ponytail: schema/040 adds `scope`, and migrations here are a human pasting
 * SQL into an editor after the deploy has already landed. Between those two
 * moments a select naming the column fails, and every API request with it, so
 * the read falls back to the columns that have always existed and the key
 * behaves as the full-access key it is today. Delete the fallback once 040 is
 * applied.
 */
async function findKeyRow(
  supabase: ReturnType<typeof serviceClient>,
  keyHash: string,
): Promise<{ id: string; user_id: string; scope?: string | null } | null> {
  const stamp = { last_used_at: new Date().toISOString() };
  const lookup = (columns: string) =>
    supabase
      .from('api_keys')
      .update(stamp)
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .select(columns)
      .maybeSingle();

  const { data, error } = await lookup('id, user_id, scope');
  if (error && /scope/.test(error.message)) {
    console.warn('[api] api_keys has no scope column yet — schema/040 is not applied');
    const fallback = await lookup('id, user_id');
    return (fallback.data as { id: string; user_id: string } | null) ?? null;
  }
  return (data as { id: string; user_id: string; scope?: string | null } | null) ?? null;
}

/**
 * What `readBodyCapped` returns when the body stopped arriving.
 *
 * A sentinel string rather than a second return type, so every route that
 * reads a body keeps compiling: it is not a JSON text, so a route that has
 * not been taught to check for it still refuses the request — as the 422 it
 * already sends for a body it cannot parse, rather than the 408 that says
 * what actually happened. A route opts into the honest answer with
 * `if (raw === BODY_TIMED_OUT) return errorResponse(REQUEST_TIMEOUT);`.
 *
 * ponytail: a caller who sends exactly these bytes picks 408 over 422 for
 * themselves. Both are refusals, so that is the whole of the collision.
 */
export const BODY_TIMED_OUT = '\u0000htmlradar:body-timed-out';

// How long the whole body has to arrive. Cloudflare gives a Worker 30 seconds
// of wall clock per request; half of it is far more than an honest 5.5 MB
// upload needs and leaves the route time to answer.
const BODY_READ_TIMEOUT_MS = 15_000;

const READ_DEADLINE = Symbol('body read deadline');

/**
 * The request body as text, or null the moment it passes `maxBytes`, or
 * `BODY_TIMED_OUT` if it stops arriving.
 *
 * `req.json()` and `req.text()` both buffer the whole body before anything can
 * look at it, and Content-Length is not a limit: it is absent on a chunked
 * request and it is whatever the caller felt like writing on any other. So the
 * bytes are counted as they arrive and the read is abandoned the instant the
 * running total goes over — a caller with a valid key cannot make an edge
 * isolate hold 100 MB it was always going to refuse.
 *
 * A body that is absent entirely reads as empty rather than oversized, so
 * "you sent nothing" stays a 422 about JSON and does not become a 413.
 *
 * The cap alone does not end the read: a client can stay under it, send
 * nothing more and never close the connection, and `reader.read()` waits for
 * a chunk that is not coming. So the read has a deadline as well as a
 * ceiling, and it is one deadline for the whole body rather than one per
 * chunk — a trickle of bytes must not be able to renew it.
 */
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
  { timeoutMs = BODY_READ_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, expire) => {
    timer = setTimeout(() => expire(READ_DEADLINE), timeoutMs);
  });
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => {});
        return null;
      }
      // Decoded as it streams: a multi-byte character split across two chunks
      // survives, and the bytes are never held twice.
      text += decoder.decode(value, { stream: true });
    }
  } catch (err) {
    if (err !== READ_DEADLINE) throw err; // a real stream error, as before
    reader.cancel().catch(() => {});
    return BODY_TIMED_OUT;
  } finally {
    // Every exit clears it, including the two returns above: a timer left
    // pending is a handle the isolate keeps alive for a request that is over.
    clearTimeout(timer);
  }
  return text + decoder.decode();
}

export interface ApiErrorResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export const INVALID_KEY: ApiErrorResponse = { status: 401, body: { error: 'invalid_api_key' } };

/**
 * A read-only key on a route that writes.
 *
 * 403 rather than 401: the key is good, and it is the key its owner meant to
 * make. The message says which key to use instead, because the caller is an
 * assistant relaying it to a person who can create a full one.
 */
export const READ_ONLY_KEY: ApiErrorResponse = {
  status: 403,
  body: {
    error: 'read_only_key',
    message:
      'This API key is read-only: it can list and read activity but cannot create, revoke or ' +
      'replace anything. Create a full-access key at https://htmlradar.com/settings.',
  },
};

/**
 * Not the caller's, or not there at all — deliberately the same answer.
 * A key must not be usable to probe for the ids of other accounts.
 */
export const NOT_FOUND: ApiErrorResponse = { status: 404, body: { error: 'not_found' } };

export const FREE_LIMIT_REACHED: ApiErrorResponse = {
  status: 402,
  body: {
    error: 'free_limit_reached',
    message: `Free accounts get 2 tracked links. Upgrade at ${UPGRADE_URL}`,
    upgrade_url: UPGRADE_URL,
  },
};

/**
 * The body stopped arriving.
 *
 * 408 rather than 413 or 422: the request was not too large and it was not
 * malformed — it never finished. A client that retries a stalled upload is
 * doing the right thing, and only this status tells it so.
 */
export const REQUEST_TIMEOUT: ApiErrorResponse = {
  status: 408,
  body: { error: 'request_timeout' },
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

/**
 * URL mode, switched off at the door.
 *
 * The proxy fetches a caller-supplied address server-side and does not yet
 * resolve hostnames or reject every non-public address, so an API caller can
 * currently aim it at network locations that are not theirs to reach. See the
 * server-side-request-forgery section of the 2026-08-30 API/MCP audit. The
 * code path behind API_URL_MODE_ENABLED stays wired so re-enabling it is a
 * constant, not a rewrite.
 */
export const URL_MODE_DISABLED: ApiErrorResponse = validationError(
  'URL mode is not yet available through the API; upload the HTML instead.',
);

/**
 * Over the hourly budget.
 *
 * The header and the body carry the same number: a machine client reads
 * `Retry-After`, a person reading the JSON reads `retry_after_seconds`, and
 * neither has to guess what the other means.
 */
export function rateLimited(retryAfterSeconds: number): ApiErrorResponse {
  return {
    status: 429,
    body: { error: 'rate_limited', retry_after_seconds: retryAfterSeconds },
    headers: { 'retry-after': String(retryAfterSeconds) },
  };
}

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

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(err: ApiErrorResponse): Response {
  return jsonResponse(err.status, err.body, err.headers ?? {});
}
