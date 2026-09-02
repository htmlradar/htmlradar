// The connector Worker: https://mcp.htmlradar.com
//
// Contract: docs/workstreams/mcp-product/CONNECTOR-CONTRACT-2026-09-02.md.
//
// The library owns the OAuth endpoints — both discovery documents, the token
// endpoint (issue, refresh and RFC 7009 revocation at one address), and the 401
// that starts a sign-in. We own three things: /authorize, which hands the user
// to the application's consent page; /connect/callback, which takes the answer
// back; and /mcp, which is the protocol.

import OAuthProvider, {
  getOAuthApi,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';
import {
  ALLOWED_ORIGINS,
  ALL_SCOPES,
  SCOPE_READ,
  configurationProblem,
  isLoopbackHost,
  retryAfterSeconds,
  sha256Hex,
  tooManyRequests,
  type Env,
} from './common.js';
import consentHandler from './consent.js';
import mcpHandler from './mcp.js';

/** One hour, the plan's figure. A stolen access token is worth an hour of one account's links. */
const ACCESS_TOKEN_TTL_SECONDS = 3600;

let cached: OAuthProvider | undefined;

function options(env: Env): OAuthProviderOptions<Env> {
  return {
    apiRoute: '/mcp',
    apiHandler: mcpHandler,
    defaultHandler: consentHandler,
    authorizeEndpoint: '/authorize',
    // Issue, refresh and revocation. The library advertises this same address
    // as `revocation_endpoint`, which is why there is no separate /revoke.
    tokenEndpoint: '/token',
    // No `clientRegistrationEndpoint`, deliberately. Client ID Metadata
    // Documents only: no unauthenticated write endpoint, no client rows, and
    // nothing to rate-limit or label "unverified". If a launch client is shown
    // to fail without registration, it is added then.
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    scopesSupported: ALL_SCOPES,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      // Pinned, so an access token minted for some other resource is refused
      // here rather than accepted because nothing said otherwise.
      resource: env.SERVER_URL,
      // The baseline the 401 challenge advertises. Read, not read-and-write:
      // this is what a caller needs to be useful at all, and the write scope is
      // asked for by the 403 at the moment a write is attempted.
      scopes_supported: [SCOPE_READ],
      resource_name: 'HTMLRadar',
    },
  };
}

function provider(env: Env): OAuthProvider {
  cached ??= new OAuthProvider(options(env));
  return cached;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const refused = refusedByPolicy(request, env);
    const limited = refused ? null : await overBudget(request, env);
    const replay = (refused ?? limited) ? null : await refusedRefreshReplay(request, env);
    const response = refused ?? limited ?? replay ?? (await provider(env).fetch(request, env, ctx));
    // Committed is not deployed. The proxy stamps the same header and the
    // deploy step reads it back to prove the running artifact is this commit.
    const stamped = new Response(response.body, response);
    stamped.headers.set('X-HTMLRadar-Version', env.GIT_SHA ?? 'dev');
    applyCors(request, stamped);
    return stamped;
  },
};

/**
 * A refresh token presented twice, refused, and its grant ended.
 *
 * The pinned library keeps the immediately previous refresh token usable after
 * a rotation — its own design, so a client whose rotation response was lost can
 * retry. That is also the shape of a replay: whoever holds a copy of the last
 * token can spend it once more. The contract promises that a reuse we observe
 * is rejected and the grant revoked, so this is where that promise is kept.
 *
 * It reads the same grant record the library reads, and compares the presented
 * token against the *previous* hash only. The current token is untouched: this
 * adds a refusal, it never adds an acceptance.
 *
 * ponytail: best effort by construction, and the contract says so in those
 * words. Cloudflare KV is eventually consistent across locations, so two
 * refreshes racing in two places can both read a state in which neither is a
 * replay. Serialising would mean a Durable Object per grant, which is a second
 * billing surface and a stateful class for a window this narrow — and the API
 * key, not the token, is the authoritative off switch either way.
 */
async function refusedRefreshReplay(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/token') return null;

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.clone().text());
  } catch {
    return null;
  }
  if (form.get('grant_type') !== 'refresh_token') return null;
  const token = form.get('refresh_token') ?? '';
  const [userId, grantId] = token.split(':');
  if (!userId || !grantId) return null;

  const grant = await env.OAUTH_KV.get<{ previousRefreshTokenId?: string }>(
    `grant:${userId}:${grantId}`,
    { type: 'json' },
  );
  if (!grant?.previousRefreshTokenId) return null;
  if (grant.previousRefreshTokenId !== (await sha256Hex(token))) return null;

  // Observed reuse. End the grant: the holder of the current token and the
  // holder of this one are not the same party, and there is no way to tell
  // which of them is the customer.
  // `env.OAUTH_PROVIDER` is only injected once the library calls one of our
  // handlers, and this check runs before that, so the helpers are built here.
  await getOAuthApi(options(env), env).revokeGrant(grantId, userId);
  return Response.json(
    {
      error: 'invalid_grant',
      error_description:
        'This refresh token has already been exchanged. The connection has been ended; connect again from your client.',
    },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * What each endpoint costs, per minute, per calling address.
 *
 * The address is the only identity available before the OAuth library has
 * authenticated anything, and it is the only one worth counting on: Cloudflare
 * sets `cf-connecting-ip` itself and a caller cannot choose it. Anything taken
 * out of the request — a token, a header, a path — is text the caller wrote,
 * and counting on it hands them two ways out: a fresh value per request buys an
 * unlimited budget, and a value belonging to somebody else spends theirs.
 *
 * ponytail: so `/mcp` is counted per address rather than per connection, and a
 * whole office behind one address shares one budget. 240 a minute is generous
 * enough that this costs nobody anything real. A genuine per-connection budget
 * would have to be taken inside the protocol handler, where the grant is
 * authenticated — worth adding the day one connection's traffic is a problem,
 * not before.
 */
const BUDGETS = {
  authorize: 20,
  token: 60,
  mcp: 240,
} as const;

const RATE_WINDOW_SECONDS = 60;

/** The 429 to send instead of serving this request, or null. */
async function overBudget(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const bucket =
    path === '/authorize'
      ? 'authorize'
      : path === '/token'
        ? 'token'
        : path === '/mcp'
          ? 'mcp'
          : null;
  if (bucket === null) return null;

  const address = request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
  const wait = await retryAfterSeconds(env, bucket, address, BUDGETS[bucket], RATE_WINDOW_SECONDS);
  return wait > 0 ? tooManyRequests(wait) : null;
}

/** A stable public error. What went wrong goes to the log, not to the caller. */
function refuse(status: number, error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * The request is refused before anything else looks at it, or null.
 *
 * Three checks, in the order that costs least: is this Worker configured at
 * all, was it reached on the host it is supposed to answer for, and is the
 * browser origin one we serve.
 */
function refusedByPolicy(request: Request, env: Env): Response | null {
  const problem = configurationProblem(env);
  if (problem) {
    // The name of the setting, never its value, and never to the caller.
    console.error(`connector: refusing every request — ${problem}`);
    return refuse(
      503,
      'temporarily_unavailable',
      'This server is not configured. Try again shortly.',
    );
  }

  const url = new URL(request.url);
  // The Host the request arrived on. A token minted for mcp.htmlradar.com must
  // not be spendable against the same code answering on some other name.
  const expected = new URL(env.SERVER_URL).host;
  if (url.host !== expected && !isLoopbackHost(url.host)) {
    return refuse(421, 'misdirected_request', 'This is not the address of this server.');
  }

  // Native clients send no Origin and must keep working. A browser sending one
  // we do not serve is refused before the request reaches the OAuth library,
  // which would otherwise reflect whatever origin it was given.
  const origin = request.headers.get('origin');
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return refuse(403, 'origin_not_allowed', 'This origin may not call this server.');
  }

  // A preflight from an allowed origin is answered here, so the headers a
  // browser sees are ours rather than the library's reflection of the caller.
  if (request.method === 'OPTIONS' && origin !== null) {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers':
          'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
        'access-control-max-age': '86400',
      },
    });
  }
  return null;
}

/** The cross-origin headers on every answer, replacing whatever the library set. */
function applyCors(request: Request, response: Response): void {
  const origin = request.headers.get('origin');
  // Vary regardless, so a cached answer for one origin is never served to
  // another — including the no-Origin case a native client produces.
  response.headers.append('Vary', 'Origin');
  if (origin === null || !ALLOWED_ORIGINS.has(origin)) {
    response.headers.delete('Access-Control-Allow-Origin');
    return;
  }
  response.headers.set('Access-Control-Allow-Origin', origin);
  // The challenge is the whole point of the 401: a browser client that cannot
  // read it cannot find the metadata document and cannot start a sign-in.
  response.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, X-HTMLRadar-Version');
}
