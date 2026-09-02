// The hostile half of the consent hand-off: every way a caller can try to make
// the Worker mint a grant it was not asked for.
//
// Each test names one attack. The assertion is always the same shape — the
// Worker refuses, and nothing reached the application or the OAuth store.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  CLIENT_REDIRECT,
  CONNECTOR_API_KEY,
  EXCHANGE_SECRET,
  ORIGIN,
  SIGNING_SECRET,
  approve,
  call,
  completeGrant,
  makeEnv,
  stubNetwork,
  withCompatibilityFlag,
  type NetworkStub,
} from './harness.js';
import { CALLBACK_PATH } from '../src/consent.js';
import { nowSeconds, sign, type Env } from '../src/common.js';

let network: NetworkStub;

beforeEach(() => {
  withCompatibilityFlag(true);
  network = stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** /authorize, stopping at the consent URL so a test can answer it by hand. */
async function handoff(env: Env, requested = 'shares:read shares:write'): Promise<URL> {
  const authorize = new URL(`${ORIGIN}/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set('redirect_uri', CLIENT_REDIRECT);
  authorize.searchParams.set('scope', requested);
  authorize.searchParams.set('state', 'state-value');
  authorize.searchParams.set('code_challenge', 'x'.repeat(43));
  authorize.searchParams.set('code_challenge_method', 'S256');
  const response = await call(env, new Request(authorize.toString()));
  return new URL(response.headers.get('location') ?? '');
}

/** A consent answer with every field under the test's control. */
async function answer(
  env: Env,
  fields: { tx: string; code: string; scope: string; exp: string; sig?: string },
): Promise<Response> {
  const url = new URL(`${ORIGIN}${CALLBACK_PATH}`);
  url.searchParams.set('tx', fields.tx);
  url.searchParams.set('code', fields.code);
  url.searchParams.set('scope', fields.scope);
  url.searchParams.set('exp', fields.exp);
  url.searchParams.set(
    'sig',
    fields.sig ?? (await sign(SIGNING_SECRET, [fields.tx, fields.code, fields.scope, fields.exp])),
  );
  return call(env, new Request(url.toString()));
}

describe('a forged consent answer', () => {
  it('is refused when the signature is wrong', async () => {
    const env = makeEnv();
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const response = await answer(env, {
      tx,
      code: 'handle',
      scope: 'shares:read shares:write',
      exp: String(nowSeconds() + 60),
      sig: 'not-the-right-signature',
    });
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });

  it('is refused when the signature is right but signed with another key', async () => {
    const env = makeEnv();
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const exp = String(nowSeconds() + 60);
    const response = await answer(env, {
      tx,
      code: 'handle',
      scope: 'shares:read',
      exp,
      sig: await sign('some-other-secret-entirely-32-bytes!', [tx, 'handle', 'shares:read', exp]),
    });
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });
});

describe('an expiry outside the window', () => {
  it('is refused when it has already passed', async () => {
    const env = makeEnv();
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const response = await answer(env, {
      tx,
      code: 'handle',
      scope: 'shares:read',
      exp: String(nowSeconds() - 1),
    });
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });

  it('is refused when it reaches further ahead than the contract allows', async () => {
    const env = makeEnv();
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    // Correctly signed, and a year in the future. A signing key that leaked
    // once must not become an answer that is good forever.
    const response = await answer(env, {
      tx,
      code: 'handle',
      scope: 'shares:read',
      exp: String(nowSeconds() + 365 * 24 * 3600),
    });
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });
});

describe('a replayed answer', () => {
  it('cannot be used a second time, because the transaction is gone', async () => {
    const env = makeEnv();
    const consent = await handoff(env);
    const tx = consent.searchParams.get('tx') ?? '';

    const first = await approve(env, tx, 'shares:read shares:write');
    expect(first.status).toBe(302);

    const second = await approve(env, tx, 'shares:read shares:write');
    expect(second.status).toBe(400);
    // The application was asked exactly once.
    const exchanges = network.calls.filter((entry) => entry.url.endsWith('/connect/exchange'));
    expect(exchanges).toHaveLength(1);
  });

  it('fails closed when the application refuses a handle it has already spent', async () => {
    const env = makeEnv();
    let spent = false;
    network.exchange = () => {
      if (spent) return Response.json({ error: 'used_or_expired' }, { status: 400 });
      spent = true;
      return Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read shares:write',
      });
    };
    await completeGrant(env);

    // A second transaction presenting the same handle: the application is the
    // authority on single use, and its refusal ends the connection.
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const replay = await approve(env, tx, 'shares:read shares:write');
    expect(replay.status).toBe(502);
  });
});

describe('a swapped transaction', () => {
  it('is refused when a handle signed for one transaction is presented under another', async () => {
    const env = makeEnv();
    const first = (await handoff(env)).searchParams.get('tx') ?? '';
    const second = (await handoff(env)).searchParams.get('tx') ?? '';
    expect(first).not.toBe(second);

    const exp = String(nowSeconds() + 60);
    const scope = 'shares:read shares:write';
    // The signature covers the first transaction; the query names the second.
    const url = new URL(`${ORIGIN}${CALLBACK_PATH}`);
    url.searchParams.set('tx', second);
    url.searchParams.set('code', `handle-${first}`);
    url.searchParams.set('scope', scope);
    url.searchParams.set('exp', exp);
    url.searchParams.set('sig', await sign(SIGNING_SECRET, [first, `handle-${first}`, scope, exp]));

    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });

  it('is refused by the application when the handle belongs to another transaction', async () => {
    const env = makeEnv();
    // The application binds the handle to its transaction, so a correctly
    // signed answer carrying somebody else's handle is still refused there.
    network.exchange = () => Response.json({ error: 'used_or_expired' }, { status: 400 });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const response = await approve(env, tx, 'shares:read');
    expect(response.status).toBe(502);
  });
});

describe('scope escalation', () => {
  it('is refused when the application grants more than it signed into the browser', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        // Wider than the `scope` the browser leg carries below.
        scope: 'shares:read shares:write',
      });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const response = await approve(env, tx, 'shares:read');
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('does not match');
  });

  it('is refused when the signed answer is wider than the client ever asked for', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read shares:write',
      });
    // The client asked for read only, so the parked request is read only.
    const tx = (await handoff(env, 'shares:read')).searchParams.get('tx') ?? '';
    const response = await approve(env, tx, 'shares:read shares:write');
    expect(response.status).toBe(400);
  });

  it('accepts a grant narrower than the request', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    const response = await approve(env, tx, 'shares:read');
    expect(response.status).toBe(302);
  });
});

describe('what the application returns', () => {
  it('is refused when the key is not an HTMLRadar key', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user-1',
        api_key: 'sk-some-other-service-key',
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    expect((await approve(env, tx, 'shares:read')).status).toBe(502);
  });

  it('is refused when the answer is larger than the cap, without buffering it', async () => {
    const env = makeEnv();
    network.exchange = () =>
      new Response('x'.repeat(64 * 1024), { headers: { 'content-type': 'application/json' } });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    expect((await approve(env, tx, 'shares:read')).status).toBe(502);
  });

  it('is refused when the answer is not JSON at all', async () => {
    const env = makeEnv();
    network.exchange = () => new Response('<html>a proxy error page</html>');
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    expect((await approve(env, tx, 'shares:read')).status).toBe(502);
  });

  it('is refused when an identifier is not usable', async () => {
    const env = makeEnv();
    network.exchange = () =>
      Response.json({
        user_id: 'user one\nwith a newline',
        api_key: CONNECTOR_API_KEY,
        api_key_id: 'key-row-1',
        scope: 'shares:read',
      });
    const tx = (await handoff(env)).searchParams.get('tx') ?? '';
    expect((await approve(env, tx, 'shares:read')).status).toBe(502);
  });
});

describe('the token the grant issues', () => {
  it('is refused at /mcp when another grant is bearing it', async () => {
    const env = makeEnv();
    const first = await completeGrant(env);
    const second = await completeGrant(env, { state: 'second' });
    expect(first.accessToken).not.toBe(second.accessToken);

    // A token cut in half, or one grant's identifier with another's secret:
    // neither authenticates.
    const [firstUser, firstGrant] = first.accessToken.split(':');
    const secretOfSecond = second.accessToken.split(':')[2] ?? '';
    const spliced = `${firstUser}:${firstGrant}:${secretOfSecond}`;
    const response = await call(
      env,
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${spliced}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe('/connect/revoke', () => {
  it('refuses a wrong bearer, a missing bearer, and a non-POST', async () => {
    const env = makeEnv();
    const body = JSON.stringify({ user_id: 'user-1', api_key_id: 'key-row-1' });

    const wrong = await call(
      env,
      new Request(`${ORIGIN}/connect/revoke`, {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
        body,
      }),
    );
    expect(wrong.status).toBe(401);

    const missing = await call(
      env,
      new Request(`${ORIGIN}/connect/revoke`, { method: 'POST', body }),
    );
    expect(missing.status).toBe(401);

    const wrongMethod = await call(
      env,
      new Request(`${ORIGIN}/connect/revoke`, {
        headers: { authorization: `Bearer ${EXCHANGE_SECRET}` },
      }),
    );
    expect(wrongMethod.status).toBe(405);
  });
});
