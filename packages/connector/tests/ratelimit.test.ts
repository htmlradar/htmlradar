// The budgets on /authorize, /token and /mcp, and the 429 they answer with.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  CLIENT_REDIRECT,
  ORIGIN,
  call,
  completeGrant,
  makeEnv,
  stubNetwork,
  withCompatibilityFlag,
} from './harness.js';
import type { Env } from '../src/common.js';

// The limiter's window is real wall-clock seconds (`nowSeconds()` in
// src/common.ts). Left alone, a slow CI runner can carry a loop across a
// 60-second window boundary mid-test, resetting the count and making the
// assertion below flake. Freezing the clock removes that: every request in a
// test lands in the same window no matter how long the runner actually takes.
const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  withCompatibilityFlag(true);
  stubNetwork();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

// These three tests each drive 240+ requests through the real worker (crypto,
// KV) sequentially or concurrently. That's genuine CPU/IO work, not
// clock-dependent — the frozen clock above only stops the window from rolling
// over mid-test, it doesn't make the loop itself faster — so a slow CI runner
// still needs more than vitest's 5s default.
const MANY_REQUESTS_TIMEOUT_MS = 20_000;

describe('the /mcp budget', () => {
  /** One protocol call from a chosen address, with a chosen bearer token. */
  function mcp(env: Env, token: string, address: string): Promise<Response> {
    return call(
      env,
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'cf-connecting-ip': address,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
  }

  it(
    'cannot be escaped by choosing a different token each time',
    async () => {
      const env = makeEnv();
      // Every request carries a token nobody issued, and a fresh one each time.
      // If the budget were keyed on anything out of the token, this would buy an
      // unlimited number of buckets and never be refused.
      for (let i = 0; i < 240; i += 1) {
        expect((await mcp(env, `user-${i}:grant-${i}:secret`, '198.51.100.9')).status).not.toBe(
          429,
        );
      }
      expect((await mcp(env, 'user-999:grant-999:secret', '198.51.100.9')).status).toBe(429);
    },
    MANY_REQUESTS_TIMEOUT_MS,
  );

  it(
    'cannot be spent on somebody else, because the token is not the identity',
    async () => {
      const env = makeEnv();
      const victim = await completeGrant(env);

      // An attacker at their own address, naming the victim's connection in the
      // bearer token, exhausts their own budget and nobody else's.
      for (let i = 0; i < 241; i += 1) await mcp(env, victim.accessToken, '203.0.113.99');
      expect((await mcp(env, victim.accessToken, '203.0.113.99')).status).toBe(429);

      // The victim, at their own address, is unaffected.
      expect((await mcp(env, victim.accessToken, '198.51.100.1')).status).toBe(200);
    },
    MANY_REQUESTS_TIMEOUT_MS,
  );

  it(
    'does not lose parallel requests, so a concurrent caller cannot hold it still',
    async () => {
      const env = makeEnv();
      // All at once. A read-then-write counter loses these: every request reads
      // the same value and writes the same value back, so the budget never moves
      // and the ceiling is never reached.
      await Promise.all(
        Array.from({ length: 241 }, () => mcp(env, 'user-x:grant-x:secret', '192.0.2.50')),
      );
      expect((await mcp(env, 'user-x:grant-x:secret', '192.0.2.50')).status).toBe(429);
    },
    MANY_REQUESTS_TIMEOUT_MS,
  );
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
