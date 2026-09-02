// The Worker under test is the real one — the OAuth library included. Only
// three things are stood in for: the key-value store (a Map), the outside
// network (the client's metadata document and the application's exchange
// endpoint), and the compatibility flag the runtime would otherwise report.
//
// Testing through `worker.fetch` rather than against the pieces is deliberate:
// the answers that matter here are HTTP status codes and headers, and a test
// that calls a function directly cannot tell you what the wire looks like.

import { vi } from 'vitest';
import worker from '../src/index.js';
import { CALLBACK_PATH } from '../src/consent.js';
import { nowSeconds, sign, type Env } from '../src/common.js';

export const SIGNING_SECRET = 'test-signing-secret-value-32-bytes!!';
export const EXCHANGE_SECRET = 'test-exchange-secret-value-32-byte!!';
export const CLIENT_ID = 'https://claude.ai/api/mcp/client-metadata.json';
export const CLIENT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const ORIGIN = 'https://mcp.htmlradar.com';

/**
 * The compatibility flag the OAuth library reads before it will advertise
 * Client ID Metadata Documents. Set here for the same reason wrangler.toml sets
 * it in production: without it the feature silently turns itself off.
 */
export function withCompatibilityFlag(enabled: boolean): void {
  (globalThis as Record<string, unknown>)['Cloudflare'] = enabled
    ? { compatibilityFlags: { global_fetch_strictly_public: true } }
    : { compatibilityFlags: {} };
}

export function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, options?: unknown) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      const type = typeof options === 'string' ? options : (options as { type?: string })?.type;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    OAUTH_KV: fakeKv(),
    OAUTH_PROVIDER: undefined as unknown as Env['OAUTH_PROVIDER'],
    APP_BASE_URL: 'https://htmlradar.com',
    API_BASE_URL: 'https://htmlradar.com',
    SERVER_URL: `${ORIGIN}/mcp`,
    GIT_SHA: 'testsha',
    CONNECT_SIGNING_SECRET: SIGNING_SECRET,
    CONNECT_EXCHANGE_SECRET: EXCHANGE_SECRET,
    ...overrides,
  };
}

export function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

export const clientMetadataDocument = {
  client_id: CLIENT_ID,
  client_name: 'Claude',
  redirect_uris: [CLIENT_REDIRECT],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
};

interface Recorded {
  url: string;
  authorization: string | null;
  body: unknown;
}

export interface NetworkStub {
  /** What the application's exchange endpoint answers. Reassign per test. */
  exchange: () => Response;
  /** Every request the Worker made to the application, exchange and tools alike. */
  calls: Recorded[];
}

export const CONNECTOR_API_KEY = 'hr_live_' + 'a1b2c3d4'.repeat(5);

/**
 * Replaces the global fetch with the two hosts this Worker ever talks to: the
 * client's metadata document, and the application. Anything else is a failure,
 * not a pass-through — a Worker reaching an unexpected address is exactly what
 * this test would otherwise hide.
 */
export function stubNetwork(exchange?: () => Response): NetworkStub {
  const stub: NetworkStub = {
    exchange: exchange ?? (() => Response.json(defaultExchangeAnswer)),
    calls: [],
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === CLIENT_ID) {
      return new Response(JSON.stringify(clientMetadataDocument), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const headers = new Headers(init?.headers);
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    stub.calls.push({ url, authorization: headers.get('authorization'), body });

    if (url === 'https://htmlradar.com/api/v1/connect/exchange') return stub.exchange();
    if (url === 'https://htmlradar.com/api/v1/me') {
      return Response.json({
        user_id: 'user-1',
        tier: 'pro',
        free_links_used: 0,
        free_links_cap: null,
      });
    }
    if (url === 'https://htmlradar.com/api/v1/shares') {
      return Response.json({
        share_id: 'share-1',
        document_id: 'doc-1',
        url: 'https://htmlradar.page/r/acme',
        dashboard_url: 'https://htmlradar.com/d/share-1',
      });
    }
    throw new Error(`unexpected outbound request to ${url}`);
  });
  return stub;
}

export const defaultExchangeAnswer = {
  user_id: 'user-1',
  api_key: CONNECTOR_API_KEY,
  api_key_id: 'key-row-1',
  scope: 'shares:read shares:write',
};

export function call(env: Env, request: Request): Promise<Response> {
  return worker.fetch(request, env, ctx());
}

/** The PKCE pair a client would generate. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = 'verifier-'.padEnd(64, 'x');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

export interface Granted {
  /** The URL the Worker sent the user to on htmlradar.com. */
  consent: URL;
  /** The URL the Worker sent the browser back to on the client. */
  clientRedirect: URL;
  accessToken: string;
  refreshToken: string;
  tokenBody: Record<string, unknown>;
}

/**
 * One whole sign-in, from /authorize to an access token, with the consent page
 * played by the test.
 *
 * This is the sequence a real client runs, executed against the real library, so
 * everything downstream of it is testing what a client would actually hold.
 */
export async function completeGrant(
  env: Env,
  options: { requested?: string; grantedScope?: string; state?: string } = {},
): Promise<Granted> {
  const { verifier, challenge } = await pkce();
  const state = options.state ?? 'client-state-value';

  const authorize = new URL(`${ORIGIN}/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set('redirect_uri', CLIENT_REDIRECT);
  authorize.searchParams.set('scope', options.requested ?? 'shares:read shares:write');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const handoff = await call(env, new Request(authorize.toString()));
  if (handoff.status !== 302) throw new Error(`/authorize answered ${handoff.status}`);
  const consent = new URL(handoff.headers.get('location') ?? '');

  const tx = consent.searchParams.get('tx') ?? '';
  const grantedScope = options.grantedScope ?? consent.searchParams.get('scope') ?? '';
  const back = await approve(env, tx, grantedScope);
  if (back.status !== 302)
    throw new Error(`callback answered ${back.status}: ${await back.text()}`);
  const clientRedirect = new URL(back.headers.get('location') ?? '');

  const token = await call(
    env,
    new Request(`${ORIGIN}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: clientRedirect.searchParams.get('code') ?? '',
        redirect_uri: CLIENT_REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    }),
  );
  const tokenBody = (await token.json()) as Record<string, unknown>;
  if (token.status !== 200)
    throw new Error(`/token answered ${token.status}: ${JSON.stringify(tokenBody)}`);

  return {
    consent,
    clientRedirect,
    accessToken: String(tokenBody['access_token']),
    refreshToken: String(tokenBody['refresh_token']),
    tokenBody,
  };
}

/** The application's "Allow", signed the way the contract says it is. */
export async function approve(env: Env, tx: string, scope: string): Promise<Response> {
  const exp = String(nowSeconds() + 120);
  const code = `handle-${tx}`;
  const callback = new URL(`${ORIGIN}${CALLBACK_PATH}`);
  callback.searchParams.set('tx', tx);
  callback.searchParams.set('code', code);
  callback.searchParams.set('scope', scope);
  callback.searchParams.set('exp', exp);
  callback.searchParams.set('sig', await sign(SIGNING_SECRET, [tx, code, scope, exp]));
  return call(env, new Request(callback.toString()));
}

/** One JSON-RPC call at /mcp with a bearer token. */
export function rpc(env: Env, token: string, message: Record<string, unknown>): Promise<Response> {
  return call(
    env,
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(message),
    }),
  );
}
