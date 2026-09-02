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
import { ALL_SCOPES, SCOPE_READ, sha256Hex, type Env } from './common.js';
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
    const replay = await refusedRefreshReplay(request, env);
    const response = replay ?? (await provider(env).fetch(request, env, ctx));
    // Committed is not deployed. The proxy stamps the same header and the
    // deploy step reads it back to prove the running artifact is this commit.
    const stamped = new Response(response.body, response);
    stamped.headers.set('X-HTMLRadar-Version', env.GIT_SHA ?? 'dev');
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
