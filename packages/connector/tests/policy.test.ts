// What the Worker refuses before it looks at a request at all: a host it does
// not answer for, a browser origin it does not serve, and — loudest of the
// three — an environment that is not configured.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGIN, call, makeEnv, stubNetwork, withCompatibilityFlag } from './harness.js';
import { configurationProblem, type Env } from '../src/common.js';

beforeEach(() => {
  withCompatibilityFlag(true);
  stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DISCOVERY = '/.well-known/oauth-authorization-server';

describe('the Host the request arrived on', () => {
  it('serves the configured host', async () => {
    const response = await call(makeEnv(), new Request(`${ORIGIN}${DISCOVERY}`));
    expect(response.status).toBe(200);
  });

  it('refuses any other name, so a token cannot be spent on a second address', async () => {
    const response = await call(makeEnv(), new Request(`https://mcp.example.test${DISCOVERY}`));
    expect(response.status).toBe(421);
    expect(await response.json()).toMatchObject({ error: 'misdirected_request' });
  });

  it('still serves a loopback address, which is what a local run uses', async () => {
    const response = await call(makeEnv(), new Request(`http://127.0.0.1:8787${DISCOVERY}`));
    expect(response.status).toBe(200);
  });
});

describe('the browser origin', () => {
  it('lets a native client with no Origin through, and sets no Allow-Origin', async () => {
    const response = await call(makeEnv(), new Request(`${ORIGIN}${DISCOVERY}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('answers a preflight from an allowed origin with our own headers', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/mcp`, {
        method: 'OPTIONS',
        headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://claude.ai');
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('refuses an origin that is not on the list, rather than reflecting it', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('exposes the challenge on a 401 so a browser client can find the metadata', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { origin: 'https://claude.ai', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://claude.ai');
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
  });
});

describe('an environment that is not configured', () => {
  const cases: [string, Partial<Env>][] = [
    ['a missing signing secret', { CONNECT_SIGNING_SECRET: '' }],
    ['a signing secret under 32 characters', { CONNECT_SIGNING_SECRET: 'too-short' }],
    ['a missing exchange secret', { CONNECT_EXCHANGE_SECRET: '' }],
    [
      'the two secrets being the same value',
      {
        CONNECT_SIGNING_SECRET: 'the-same-value-for-both-of-them!!!!!!',
        CONNECT_EXCHANGE_SECRET: 'the-same-value-for-both-of-them!!!!!!',
      },
    ],
    ['an API base that is plain HTTP', { API_BASE_URL: 'http://htmlradar.com' }],
    ['an API base that is not a URL', { API_BASE_URL: 'htmlradar.com' }],
    ['a missing app base', { APP_BASE_URL: '' }],
  ];

  for (const [what, broken] of cases) {
    it(`fails closed on ${what}`, async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const env = makeEnv(broken);
      const response = await call(env, new Request(`${ORIGIN}${DISCOVERY}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'temporarily_unavailable' });

      // The log names the setting. It never names the value.
      const line = String(logged.mock.calls[0]?.[0] ?? '');
      expect(line).toContain('refusing every request');
      for (const value of Object.values(broken)) {
        if (typeof value === 'string' && value.length > 8) expect(line).not.toContain(value);
      }
    });
  }

  it('is satisfied by a loopback API base, which is what a local run uses', () => {
    expect(configurationProblem(makeEnv({ API_BASE_URL: 'http://127.0.0.1:8788' }))).toBeNull();
  });

  it('lets SERVER_URL be plain http, because a local run answers on http', () => {
    // It is an identifier, not an address anything is sent to, and it has to
    // match the scheme the request arrives on or the audience will not match.
    expect(
      configurationProblem(makeEnv({ SERVER_URL: 'http://mcp.htmlradar.com/mcp' })),
    ).toBeNull();
  });
});
