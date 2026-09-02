// Two connections at once, and revoking exactly one of them.
//
// This is the behaviour a person meets the first time they add HTMLRadar from
// Claude Desktop and then from claude.ai, or from a second Claude account. The
// OAuth library's default would have disconnected the first; the Worker turns
// that default off, so what these tests fix is a decision, not an accident.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTOR_API_KEY,
  EXCHANGE_SECRET,
  ORIGIN,
  call,
  completeGrant,
  makeEnv,
  rpc,
  stubNetwork,
  withCompatibilityFlag,
  type NetworkStub,
} from './harness.js';

let network: NetworkStub;

beforeEach(() => {
  withCompatibilityFlag(true);
  network = stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The exchange answer for one connection, with the key row it minted. */
function grantingKey(apiKeyId: string): () => Response {
  return () =>
    Response.json({
      user_id: 'user-1',
      api_key: CONNECTOR_API_KEY,
      api_key_id: apiKeyId,
      scope: 'shares:read shares:write',
    });
}

function revokeByKeyId(
  env: ReturnType<typeof makeEnv>,
  body: Record<string, unknown>,
  authorization = `Bearer ${EXCHANGE_SECRET}`,
): Promise<Response> {
  return call(
    env,
    new Request(`${ORIGIN}/connect/revoke`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('a second connection for the same account', () => {
  it('does not disconnect the first', async () => {
    const env = makeEnv();

    network.exchange = grantingKey('key-row-1');
    const first = await completeGrant(env);
    network.exchange = grantingKey('key-row-2');
    const second = await completeGrant(env, { state: 'second' });

    for (const token of [first.accessToken, second.accessToken]) {
      const listed = await rpc(env, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(listed.status).toBe(200);
    }
  });
});

describe('POST /connect/revoke', () => {
  it('revokes the grant naming that key, and leaves the other alone', async () => {
    const env = makeEnv();

    network.exchange = grantingKey('key-row-1');
    const first = await completeGrant(env);
    network.exchange = grantingKey('key-row-2');
    const second = await completeGrant(env, { state: 'second' });

    const response = await revokeByKeyId(env, { user_id: 'user-1', api_key_id: 'key-row-1' });
    expect(response.status).toBe(204);
    expect(response.headers.get('x-grants-revoked')).toBe('1');

    const gone = await rpc(env, first.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(gone.status).toBe(401);
    const alive = await rpc(env, second.accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(alive.status).toBe(200);
  });

  it('is a 204 when the key has no grant left, so a retry is safe', async () => {
    const env = makeEnv();
    network.exchange = grantingKey('key-row-1');
    await completeGrant(env);

    expect((await revokeByKeyId(env, { user_id: 'user-1', api_key_id: 'key-row-1' })).status).toBe(
      204,
    );
    const again = await revokeByKeyId(env, { user_id: 'user-1', api_key_id: 'key-row-1' });
    expect(again.status).toBe(204);
    expect(again.headers.get('x-grants-revoked')).toBe('0');
  });

  it('never touches another account, even with the shared secret', async () => {
    const env = makeEnv();
    network.exchange = grantingKey('key-row-1');
    const mine = await completeGrant(env);

    // The same key identifier, claimed for a different user.
    const response = await revokeByKeyId(env, { user_id: 'user-2', api_key_id: 'key-row-1' });
    expect(response.status).toBe(204);
    expect(response.headers.get('x-grants-revoked')).toBe('0');

    const alive = await rpc(env, mine.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(alive.status).toBe(200);
  });

  it('refuses a body that names no key', async () => {
    const env = makeEnv();
    expect((await revokeByKeyId(env, { user_id: 'user-1' })).status).toBe(400);
    expect((await revokeByKeyId(env, { api_key_id: 'key-row-1' })).status).toBe(400);
  });
});
