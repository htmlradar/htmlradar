// Everything the Worker does that is not the protocol itself: hand the user to
// the application's consent page, take them back, and turn the application's
// answer into an OAuth grant.
//
// The Worker never authenticates a user, never sees a password, and holds no
// database credential. The application is the only writer to Supabase on this
// path; the Worker's whole job is to carry a signed request across and a signed
// answer back.

import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import {
  bearerMatches,
  knownScopes,
  nowSeconds,
  randomHex,
  sign,
  verify,
  type Env,
  type Props,
} from './common.js';

/** How long a parked authorization request, and its /connect link, stay valid. */
export const CONSENT_TTL_SECONDS = 600;

/** Fixed on both sides on purpose: a return address that is never a parameter is never an open redirect. */
export const CALLBACK_PATH = '/connect/callback';

interface ExchangeResult {
  user_id: string;
  api_key: string;
  api_key_id: string;
  scope: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorize(request, env);
    if (url.pathname === CALLBACK_PATH) return callback(env, url);
    if (url.pathname === '/connect/revoke') return revoke(request, env);
    return new Response('Not found.', { status: 404 });
  },
};

/**
 * Step one: park the request and send the browser to the application.
 *
 * The client is identified by a Client ID Metadata Document, which is a URL it
 * must serve. With no registration endpoint there are no stored clients, so the
 * library has already refused anything that is not such a URL by the time this
 * runs; the second check below is belt and braces, and it is also where the host
 * the consent page displays comes from.
 */
async function authorize(request: Request, env: Env): Promise<Response> {
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return new Response(`Invalid authorization request: ${describe(error)}`, { status: 400 });
  }

  let clientHost: string;
  try {
    clientHost = new URL(oauthRequest.clientId).host;
  } catch {
    return new Response(
      'This server identifies clients by a Client ID Metadata Document, so client_id must be the ' +
        'URL of that document. It does not offer dynamic client registration.',
      { status: 400 },
    );
  }

  const tx = randomHex(16);
  await env.OAUTH_KV.put(`tx:${tx}`, JSON.stringify(oauthRequest), {
    expirationTtl: CONSENT_TTL_SECONDS,
  });

  const scope = knownScopes(oauthRequest.scope).join(' ');
  const exp = String(nowSeconds() + CONSENT_TTL_SECONDS);
  const signature = await sign(env.CONNECT_SIGNING_SECRET, [
    tx,
    oauthRequest.clientId,
    clientHost,
    scope,
    exp,
  ]);

  const consent = new URL('/connect', env.APP_BASE_URL);
  consent.searchParams.set('tx', tx);
  consent.searchParams.set('client_id', oauthRequest.clientId);
  // The host of the client_id URL, which is what the page displays as the
  // relying party. Never the name the document claims for itself: the document
  // is self-asserted and anybody may write "Claude" in it.
  consent.searchParams.set('client_host', clientHost);
  consent.searchParams.set('scope', scope);
  consent.searchParams.set('exp', exp);
  consent.searchParams.set('sig', signature);
  // The return address is not among them. It is the constant CALLBACK_PATH on
  // this host, hard-coded on both sides, which is what removes the open-redirect
  // surface: there is no parameter to substitute.

  return Response.redirect(consent.toString(), 302);
}

/**
 * Step two: the application's answer.
 *
 * Order matters. The signature is checked before anything in the query string
 * is believed, the expiry before the parked request is looked up, and the
 * parked request is deleted whether the user allowed or denied — a transaction
 * is used once either way.
 */
async function callback(env: Env, url: URL): Promise<Response> {
  const params = url.searchParams;
  const tx = params.get('tx') ?? '';
  const exp = params.get('exp') ?? '';
  const signature = params.get('sig') ?? '';
  const error = params.get('error');
  const code = params.get('code') ?? '';
  const scope = params.get('scope') ?? '';

  const signed = error ? [tx, error, exp] : [tx, code, scope, exp];
  if (!(await verify(env.CONNECT_SIGNING_SECRET, signed, signature))) {
    return new Response('This consent answer is not signed by HTMLRadar.', { status: 400 });
  }
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds()) {
    return new Response('This consent answer has expired. Start the connection again.', {
      status: 400,
    });
  }

  const parked = await env.OAUTH_KV.get<AuthRequest>(`tx:${tx}`, { type: 'json' });
  if (!parked) {
    return new Response('This consent answer has already been used, or it expired.', {
      status: 400,
    });
  }
  await env.OAUTH_KV.delete(`tx:${tx}`);

  if (error) return Response.redirect(clientErrorUrl(parked, error), 302);

  let granted: ExchangeResult;
  try {
    granted = await exchangeHandle(env, tx, code);
  } catch (failure) {
    return new Response(`Could not finish the connection: ${describe(failure)}`, { status: 502 });
  }

  const props: Props = {
    userId: granted.user_id,
    apiKey: granted.api_key,
    apiKeyId: granted.api_key_id,
    scope: granted.scope,
  };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parked,
    userId: granted.user_id,
    scope: knownScopes(granted.scope.split(' ')),
    // Storage-visible, by the library's own documentation: metadata and userId
    // are not encrypted because grants are enumerated and revoked by them. So
    // nothing here may be secret. The key identifier is not — it names a row,
    // it does not authenticate.
    metadata: { apiKeyId: granted.api_key_id, grantedAt: nowSeconds() },
    props,
  });
  return Response.redirect(redirectTo, 302);
}

/**
 * The handle for the key, server to server.
 *
 * Nothing that authenticates travels in a browser URL, where it would land in
 * history and referrer headers. The handle is single-use, expires in two
 * minutes, and is bound to this transaction, so one lifted from history is
 * worth nothing on its own.
 */
async function exchangeHandle(env: Env, tx: string, code: string): Promise<ExchangeResult> {
  const response = await fetch(new URL('/api/v1/connect/exchange', env.API_BASE_URL).toString(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CONNECT_EXCHANGE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tx, code }),
  });
  if (!response.ok) {
    throw new Error(`HTMLRadar refused the consent handle (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as Partial<ExchangeResult>;
  if (!body.user_id || !body.api_key || !body.api_key_id || !body.scope) {
    throw new Error('HTMLRadar returned an incomplete consent answer.');
  }
  return body as ExchangeResult;
}

/**
 * Step three of the revocation order, and the only one that may fail.
 *
 * Step one — the application setting `revoked_at` on the key row — has already
 * closed access by the time this is called, because every tool call carries
 * that key to the API. This tidies the OAuth grant afterwards. If it fails the
 * application records a reconciliation event and the monitor retries; access
 * stays closed throughout.
 */
async function revoke(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!bearerMatches(request.headers.get('authorization'), env.CONNECT_EXCHANGE_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    user_id?: string;
    grant_id?: string;
  } | null;
  if (!body?.user_id || !body?.grant_id) {
    return new Response('user_id and grant_id are required.', { status: 400 });
  }
  await env.OAUTH_PROVIDER.revokeGrant(body.grant_id, body.user_id);
  return new Response(null, { status: 204 });
}

function clientErrorUrl(parked: AuthRequest, error: string): string {
  const target = new URL(parked.redirectUri);
  target.searchParams.set('error', error);
  if (parked.state) target.searchParams.set('state', parked.state);
  if (parked.issuer) target.searchParams.set('iss', parked.issuer);
  return target.toString();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
