// A whole connection, from the address a user pastes to a tool result: the
// authorization hand-off, the consent answer, the token exchange, and the seven
// tools answering with the key that consent minted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  CLIENT_REDIRECT,
  CONNECTOR_API_KEY,
  completeGrant,
  makeEnv,
  rpc,
  SIGNING_SECRET,
  stubNetwork,
  withCompatibilityFlag,
  type NetworkStub,
} from './harness.js';
import { verify } from '../src/common.js';

let network: NetworkStub;

beforeEach(() => {
  withCompatibilityFlag(true);
  network = stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the hand-off to the consent page', () => {
  it('sends the user to htmlradar.com with a signature the application can check', async () => {
    const env = makeEnv();
    const { consent } = await completeGrant(env);

    expect(consent.origin).toBe('https://htmlradar.com');
    expect(consent.pathname).toBe('/connect');
    expect(consent.searchParams.get('client_id')).toBe(CLIENT_ID);
    // The host of the client_id URL, not the name the document claims. The
    // document says "Claude"; anybody's document could.
    expect(consent.searchParams.get('client_host')).toBe('claude.ai');
    expect(consent.searchParams.get('scope')).toBe('shares:read shares:write');
    expect(consent.searchParams.get('tx')).toMatch(/^[0-9a-f]{32}$/);

    const signed = [
      consent.searchParams.get('tx') ?? '',
      consent.searchParams.get('client_id') ?? '',
      consent.searchParams.get('client_host') ?? '',
      consent.searchParams.get('scope') ?? '',
      consent.searchParams.get('exp') ?? '',
    ];
    expect(await verify(SIGNING_SECRET, signed, consent.searchParams.get('sig') ?? '')).toBe(true);
  });

  it('narrows an unknown scope to read-only rather than passing it on', async () => {
    const env = makeEnv();
    // The application grants what the narrowed request asked for; the Worker
    // refuses anything wider (tests/hostile.test.ts).
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const { consent } = await completeGrant(env, { requested: 'admin:everything' });
    expect(consent.searchParams.get('scope')).toBe('shares:read');
  });
});

describe('the exchange', () => {
  it('carries the shared secret and the transaction, and never the key back through the browser', async () => {
    const env = makeEnv();
    const { clientRedirect } = await completeGrant(env);

    const exchange = network.calls.find(
      (entry) => entry.url === 'https://htmlradar.com/api/v1/connect/exchange',
    );
    expect(exchange?.authorization).toBe('Bearer test-exchange-secret-value-32-byte!!');
    expect((exchange?.body as { tx?: string }).tx).toMatch(/^[0-9a-f]{32}$/);

    // What came back through the browser is an authorization code, and nothing
    // that would authenticate against HTMLRadar.
    expect(clientRedirect.origin + clientRedirect.pathname).toBe(CLIENT_REDIRECT);
    expect(clientRedirect.searchParams.get('state')).toBe('client-state-value');
    expect(clientRedirect.toString()).not.toContain('hr_live_');
  });
});

describe('the tools', () => {
  it('completes a handshake, lists seven tools, and calls one with the granted key', async () => {
    const env = makeEnv();
    const { accessToken } = await completeGrant(env);

    const initialize = await rpc(env, accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
    expect(initialize.status).toBe(200);
    const handshake = await readRpc(initialize);
    expect((handshake['result'] as { serverInfo: { name: string } }).serverInfo.name).toBe(
      'htmlradar',
    );

    const listed = await rpc(env, accessToken, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (await readRpc(listed))['result'] as { tools: { name: string }[] };
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'create_share',
      'get_share_activity',
      'list_shares',
      'replace_document',
      'revoke_share',
      'share_html',
      'whoami',
    ]);

    const called = await rpc(env, accessToken, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    const result = (await readRpc(called))['result'] as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain('Plan: pro');

    // The whole design in one assertion: past consent, the tool call is the
    // ordinary API call the npm package makes, with an ordinary API key.
    const apiCall = network.calls.find((entry) => entry.url === 'https://htmlradar.com/api/v1/me');
    expect(apiCall?.authorization).toBe(`Bearer ${CONNECTOR_API_KEY}`);
  });
});

describe('a read-only grant', () => {
  it('still sees all seven tools', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const { accessToken } = await completeGrant(env, { requested: 'shares:read' });

    const listed = await rpc(env, accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (await readRpc(listed))['result'] as { tools: { name: string }[] };
    expect(tools.tools).toHaveLength(7);
  });

  it('gets a 403 with the step-up challenge when it calls a write tool', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const { accessToken } = await completeGrant(env, { requested: 'shares:read' });

    const called = await rpc(env, accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'share_html', arguments: { html: '<p>hello</p>' } },
    });

    expect(called.status).toBe(403);
    const challenge = called.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    // Both scopes, not only the missing one: clients do not reliably carry an
    // earlier grant forward.
    expect(challenge).toContain('scope="shares:read shares:write"');
    expect(challenge).toContain('resource_metadata=');
    // And nothing reached HTMLRadar.
    expect(network.calls.some((entry) => entry.url.endsWith('/api/v1/shares'))).toBe(false);
  });

  it('is not refused for a read tool', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const { accessToken } = await completeGrant(env, { requested: 'shares:read' });

    const called = await rpc(env, accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    });
    expect(called.status).toBe(200);
  });
});

describe('a full grant', () => {
  it('may call a write tool', async () => {
    const env = makeEnv();
    const { accessToken } = await completeGrant(env);
    const called = await rpc(env, accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'share_html', arguments: { html: '<p>hello</p>' } },
    });
    expect(called.status).toBe(200);
    const result = (await readRpc(called))['result'] as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain('https://htmlradar.page/r/acme');
  });
});

describe('revocation', () => {
  it('needs the shared secret, and then ends the grant', async () => {
    const env = makeEnv();
    const { accessToken } = await completeGrant(env);

    const wrongSecret = await fetchRevoke(env, 'Bearer wrong', 'user-1');
    expect(wrongSecret.status).toBe(401);

    const revoked = await fetchRevoke(env, 'Bearer test-exchange-secret-value-32-byte!!', 'user-1');
    expect(revoked.status).toBe(204);

    const after = await rpc(env, accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(after.status).toBe(401);
  });
});

async function fetchRevoke(
  env: ReturnType<typeof makeEnv>,
  authorization: string,
  userId: string,
  apiKeyId = 'key-row-1',
): Promise<Response> {
  const { call } = await import('./harness.js');
  return call(
    env,
    new Request('https://mcp.htmlradar.com/connect/revoke', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, api_key_id: apiKeyId }),
    }),
  );
}

/** The answer, whether it came back as JSON or as a one-message event stream. */
async function readRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const line = text.split('\n').find((candidate) => candidate.startsWith('data: '));
    return JSON.parse((line ?? '').slice(6)) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}
