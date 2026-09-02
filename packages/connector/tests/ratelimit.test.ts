// The budgets on /authorize, /token and /mcp, and the 429 they answer with.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  CLIENT_REDIRECT,
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

const FROM = { 'cf-connecting-ip': '198.51.100.7' };

function authorize(env: Env, headers: Record<string, string> = FROM): Promise<Response> {
  const url = new URL(`${ORIGIN}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', CLIENT_REDIRECT);
  url.searchParams.set('scope', 'shares:read');
  url.searchParams.set('code_challenge', 'x'.repeat(43));
  url.searchParams.set('code_challenge_method', 'S256');
  return call(env, new Request(url.toString(), { headers }));
}

describe('the /authorize budget', () => {
  it('answers 429 with a Retry-After once the address has spent it', async () => {
    const env = makeEnv();
    for (let i = 0; i < 20; i += 1) expect((await authorize(env)).status).toBe(302);

    const refused = await authorize(env);
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(await refused.json()).toMatchObject({
      error: 'rate_limited',
      retry_after_seconds: wait,
    });
  });

  it('is counted per address, so one caller cannot spend what another has left', async () => {
    const env = makeEnv();
    for (let i = 0; i < 21; i += 1) await authorize(env);
    expect((await authorize(env, { 'cf-connecting-ip': '203.0.113.4' })).status).toBe(302);
  });
});

describe('the /token budget', () => {
  it('refuses the sixty-first attempt from one address', async () => {
    const env = makeEnv();
    const spend = () =>
      call(
        env,
        new Request(`${ORIGIN}/token`, {
          method: 'POST',
          headers: { ...FROM, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'nope',
            client_id: CLIENT_ID,
            redirect_uri: CLIENT_REDIRECT,
          }),
        }),
      );

    for (let i = 0; i < 60; i += 1) expect((await spend()).status).not.toBe(429);
    expect((await spend()).status).toBe(429);
  });
});

describe('the /mcp budget', () => {
  it('is counted per connection, not per address', async () => {
    const env = makeEnv();
    const first = await completeGrant(env);
    const second = await completeGrant(env, { state: 'second' });

    for (let i = 0; i < 240; i += 1) {
      const answer = await rpc(env, first.accessToken, {
        jsonrpc: '2.0',
        id: i,
        method: 'tools/list',
      });
      expect(answer.status).not.toBe(429);
    }
    expect(
      (await rpc(env, first.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status,
    ).toBe(429);

    // The other connection is untouched.
    expect(
      (await rpc(env, second.accessToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status,
    ).toBe(200);
  });
});

describe('a counter that cannot be read', () => {
  it('lets the request through rather than closing the connector', async () => {
    const env = makeEnv({
      OAUTH_KV: new Proxy(makeEnv().OAUTH_KV, {
        get(target, property) {
          if (property === 'get' || property === 'put') {
            return async (key: string, ...rest: unknown[]) => {
              if (String(key).startsWith('rl:')) throw new Error('key-value unavailable');
              return (target[property as 'get'] as (...args: unknown[]) => unknown)(key, ...rest);
            };
          }
          return target[property as keyof KVNamespace];
        },
      }),
    });
    expect((await authorize(env)).status).toBe(302);
  });
});
