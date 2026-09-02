// The hostile cases on the consent hand-off. Every one of them is a refusal.
//
// This is the sharp end of the design: the Worker mints credentials on the word
// of an answer that arrived through a browser redirect, so the answer has to be
// unforgeable, unrepeatable, and short-lived, and each of those is a separate
// test because each is a separate way to lose somebody's account.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approve,
  call,
  CLIENT_ID,
  CLIENT_REDIRECT,
  makeEnv,
  ORIGIN,
  pkce,
  stubNetwork,
  withCompatibilityFlag,
  SIGNING_SECRET,
  type NetworkStub,
} from './harness.js';
import { nowSeconds, sign } from '../src/common.js';
import type { Env } from '../src/common.js';

let network: NetworkStub;

beforeEach(() => {
  withCompatibilityFlag(true);
  network = stubNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** /authorize as a real client sends it, returning the parked transaction id. */
async function startAuthorization(env: Env, overrides: Record<string, string> = {}) {
  const { challenge } = await pkce();
  const url = new URL(`${ORIGIN}/authorize`);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CLIENT_REDIRECT,
    scope: 'shares:read shares:write',
    state: 'client-state-value',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...overrides,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await call(env, new Request(url.toString()));
  const location = response.headers.get('location');
  const consent = location ? new URL(location) : null;
  return { response, consent, tx: consent?.searchParams.get('tx') ?? '' };
}

describe('/authorize', () => {
  it('refuses a client that is not identified by a metadata document', async () => {
    const env = makeEnv();
    const { response } = await startAuthorization(env, { client_id: 'claude-desktop' });
    expect(response.status).toBe(400);
    // Refused by the library before our own guard sees it: with no registration
    // endpoint there are no stored clients, so a bare name resolves to nothing.
    expect(await response.text()).toContain('Invalid client_id');
  });

  it('refuses a redirect address the client did not publish', async () => {
    const env = makeEnv();
    const { response } = await startAuthorization(env, {
      redirect_uri: 'https://attacker.example/callback',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a request with no response type', async () => {
    const env = makeEnv();
    const url = new URL(`${ORIGIN}/authorize`);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', CLIENT_REDIRECT);
    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(400);
  });
});

describe('the consent answer', () => {
  it('is refused when the signature is wrong', async () => {
    const env = makeEnv();
    const { tx } = await startAuthorization(env);

    const exp = String(nowSeconds() + 120);
    const url = new URL(`${ORIGIN}/connect/callback`);
    url.searchParams.set('tx', tx);
    url.searchParams.set('code', 'handle-1');
    url.searchParams.set('scope', 'shares:read shares:write');
    url.searchParams.set('exp', exp);
    url.searchParams.set('sig', 'not-a-signature');

    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('not signed by HTMLRadar');
    // Nothing was exchanged, so no key was ever asked for.
    expect(network.calls).toHaveLength(0);
  });

  it('is refused when the scope has been widened after signing', async () => {
    const env = makeEnv();
    const { tx } = await startAuthorization(env);

    const exp = String(nowSeconds() + 120);
    const url = new URL(`${ORIGIN}/connect/callback`);
    url.searchParams.set('tx', tx);
    url.searchParams.set('code', 'handle-1');
    url.searchParams.set('exp', exp);
    // Signed for read only...
    url.searchParams.set('sig', await sign(SIGNING_SECRET, [tx, 'handle-1', 'shares:read', exp]));
    // ...presented as read and write.
    url.searchParams.set('scope', 'shares:read shares:write');

    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(400);
  });

  it('is refused once its expiry has passed, however well it is signed', async () => {
    const env = makeEnv();
    const { tx } = await startAuthorization(env);

    const exp = String(nowSeconds() - 1);
    const url = new URL(`${ORIGIN}/connect/callback`);
    url.searchParams.set('tx', tx);
    url.searchParams.set('code', 'handle-1');
    url.searchParams.set('scope', 'shares:read');
    url.searchParams.set('exp', exp);
    url.searchParams.set('sig', await sign(SIGNING_SECRET, [tx, 'handle-1', 'shares:read', exp]));

    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('expired');
  });

  it('is refused when it names a transaction this Worker never started', async () => {
    const env = makeEnv();
    await startAuthorization(env);
    const response = await approve(env, 'f'.repeat(32), 'shares:read');
    expect(response.status).toBe(400);
    expect(network.calls).toHaveLength(0);
  });

  it('cannot be replayed: the second use of a transaction is refused', async () => {
    const env = makeEnv();
    const { tx } = await startAuthorization(env);

    const first = await approve(env, tx, 'shares:read shares:write');
    expect(first.status).toBe(302);

    const second = await approve(env, tx, 'shares:read shares:write');
    expect(second.status).toBe(400);
    expect(await second.text()).toContain('already been used');
  });

  it('sends a denial back to the client as access_denied, with the state intact', async () => {
    const env = makeEnv();
    const { tx } = await startAuthorization(env);

    const exp = String(nowSeconds() + 120);
    const url = new URL(`${ORIGIN}/connect/callback`);
    url.searchParams.set('tx', tx);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('exp', exp);
    url.searchParams.set('sig', await sign(SIGNING_SECRET, [tx, 'access_denied', exp]));

    const response = await call(env, new Request(url.toString()));
    expect(response.status).toBe(302);
    const back = new URL(response.headers.get('location') ?? '');
    expect(back.origin + back.pathname).toBe(CLIENT_REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('client-state-value');
    expect(network.calls).toHaveLength(0);
  });

  it('does not issue a grant when the application refuses the handle', async () => {
    const env = makeEnv();
    network.exchange = () => new Response('used or expired', { status: 400 });
    const { tx } = await startAuthorization(env);

    const response = await approve(env, tx, 'shares:read');
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('Could not finish the connection');
  });
});

describe('the shared HMAC vector', () => {
  // Fixed secret, fixed fields, fixed expected signature. The same vector is
  // asserted in packages/app/src/lib/connect.test.ts against that package's
  // own hmacSign() — if the two ever compute a different signature for these
  // inputs, one of these two tests catches it before the app and the Worker
  // do.
  it('signs the consent leg the same way the app does', async () => {
    const tx = 'f'.repeat(32);
    const clientId = 'https://claude.ai/.well-known/oauth-client';
    const clientHost = 'claude.ai';
    const scope = 'shares:read shares:write';
    const exp = '1893456000';
    const secret = 'connector-contract-fixture-secret';
    const expected = 'O6khTth_bVYGR8vqxQ6vErAJYar-Cm1vt9DNqUNG-wc';

    expect(await sign(secret, [tx, clientId, clientHost, scope, exp])).toBe(expected);
  });
});

describe('/connect/revoke', () => {
  it('answers 405 to anything but a POST', async () => {
    const response = await call(makeEnv(), new Request(`${ORIGIN}/connect/revoke`));
    expect(response.status).toBe(405);
  });

  it('needs both identifiers', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/connect/revoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-exchange-secret-value-32-byte!!',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ user_id: 'user-1' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('an unknown path', () => {
  it('is a plain 404, not a hint about what else is here', async () => {
    const response = await call(makeEnv(), new Request(`${ORIGIN}/admin`));
    expect(response.status).toBe(404);
  });
});
