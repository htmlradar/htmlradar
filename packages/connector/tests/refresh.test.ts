// Refresh rotation, and what happens when the same refresh token is spent
// twice. The pinned OAuth library keeps the previous token usable after a
// rotation; the Worker refuses it and ends the grant.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  ORIGIN,
  call,
  completeGrant,
  makeEnv,
  rpc,
  stubNetwork,
  withCompatibilityFlag,
} from './harness.js';
import type { Env } from '../src/common.js';

beforeEach(() => {
  withCompatibilityFlag(true);
  stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function refresh(env: Env, refreshToken: string): Promise<Response> {
  return call(
    env,
    new Request(`${ORIGIN}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    }),
  );
}

describe('a refresh token', () => {
  it('rotates, and the new one works', async () => {
    const env = makeEnv();
    const { refreshToken } = await completeGrant(env);

    const rotated = await refresh(env, refreshToken);
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as Record<string, string>;
    expect(body['refresh_token']).not.toBe(refreshToken);

    const listed = await rpc(env, body['access_token'] ?? '', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(listed.status).toBe(200);
  });

  it('is refused the second time, and the grant goes with it', async () => {
    const env = makeEnv();
    const granted = await completeGrant(env);

    const rotated = await refresh(env, granted.refreshToken);
    expect(rotated.status).toBe(200);
    const fresh = (await rotated.json()) as Record<string, string>;

    // The library would accept this one more time. We do not.
    const replay = await refresh(env, granted.refreshToken);
    expect(replay.status).toBe(400);
    expect((await replay.json()) as { error: string }).toMatchObject({ error: 'invalid_grant' });

    // And the grant is gone, so the token minted by the honest rotation stops
    // working too — which is the point: we cannot tell which party is the
    // customer, so neither keeps access.
    const after = await rpc(env, fresh['access_token'] ?? '', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(after.status).toBe(401);
    expect((await refresh(env, fresh['refresh_token'] ?? '')).status).toBe(400);
  });

  it('leaves an unrelated grant alone', async () => {
    const env = makeEnv();
    const first = await completeGrant(env);
    const second = await completeGrant(env, { state: 'second' });

    await refresh(env, first.refreshToken);
    expect((await refresh(env, first.refreshToken)).status).toBe(400);

    const alive = await rpc(env, second.accessToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(alive.status).toBe(200);
  });
});
