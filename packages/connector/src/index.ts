// The connector Worker: https://mcp.htmlradar.com
//
// Contract: docs/workstreams/mcp-product/CONNECTOR-CONTRACT-2026-09-02.md.
//
// The library owns the OAuth endpoints — both discovery documents, the token
// endpoint (issue, refresh and RFC 7009 revocation at one address), and the 401
// that starts a sign-in. We own three things: /authorize, which hands the user
// to the application's consent page; /connect/callback, which takes the answer
// back; and /mcp, which is the protocol.

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { ALL_SCOPES, SCOPE_READ, type Env } from './common.js';
import consentHandler from './consent.js';
import mcpHandler from './mcp.js';

/** One hour, the plan's figure. A stolen access token is worth an hour of one account's links. */
const ACCESS_TOKEN_TTL_SECONDS = 3600;

let cached: OAuthProvider | undefined;

function provider(env: Env): OAuthProvider {
  cached ??= new OAuthProvider({
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
  });
  return cached;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await provider(env).fetch(request, env, ctx);
    // Committed is not deployed. The proxy stamps the same header and the
    // deploy step reads it back to prove the running artifact is this commit.
    const stamped = new Response(response.body, response);
    stamped.headers.set('X-HTMLRadar-Version', env.GIT_SHA ?? 'dev');
    return stamped;
  },
};
