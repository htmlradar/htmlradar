// What a client sees before it has anything: the two discovery documents, and
// the refusal that tells it where to sign in.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, makeEnv, ORIGIN, withCompatibilityFlag } from './harness.js';

beforeEach(() => withCompatibilityFlag(true));
afterEach(() => withCompatibilityFlag(true));

describe('authorization server metadata', () => {
  it('advertises metadata documents, S256 only, and no registration endpoint', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body['issuer']).toBe(ORIGIN);
    expect(body['authorization_endpoint']).toBe(`${ORIGIN}/authorize`);
    expect(body['token_endpoint']).toBe(`${ORIGIN}/token`);
    // Revocation is the token endpoint. There is no separate /revoke, and a
    // client looking for one should find this instead of nothing.
    expect(body['revocation_endpoint']).toBe(`${ORIGIN}/token`);
    expect(body['registration_endpoint']).toBeUndefined();
    expect(body['code_challenge_methods_supported']).toEqual(['S256']);
    expect(body['token_endpoint_auth_methods_supported']).toContain('none');
    expect(body['scopes_supported']).toEqual(['shares:read', 'shares:write']);
    expect(body['client_id_metadata_document_supported']).toBe(true);
  });

  it('stops advertising metadata documents when the compatibility flag is gone', async () => {
    // The trap the wrangler.toml comment exists for: drop the flag and the
    // library disables the only client-identification scheme we support,
    // without an error anywhere.
    withCompatibilityFlag(false);
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['client_id_metadata_document_supported']).toBe(false);
  });
});

describe('protected resource metadata', () => {
  it('answers on the path-suffixed route with the pinned resource', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['resource']).toBe(`${ORIGIN}/mcp`);
    expect(body['authorization_servers']).toEqual([ORIGIN]);
    // The baseline only. The write scope is asked for by the 403, at the moment
    // a write is attempted.
    expect(body['scopes_supported']).toEqual(['shares:read']);
    expect(body['resource_name']).toBe('HTMLRadar');
  });

  it('answers on the bare route too, for clients that probe the origin', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
    );
    expect(response.status).toBe(200);
  });
});

describe('the unauthenticated call', () => {
  it('is a transport-level 401 naming the resource metadata document', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(challenge).toContain('scope="shares:read"');
  });

  it('refuses a token that was never issued, and says which error it was', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer not-a-real-token', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});

describe('the version header', () => {
  it('is stamped on every answer, so a deploy can be proved from outside', async () => {
    const response = await call(
      makeEnv(),
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
    );
    expect(response.headers.get('x-htmlradar-version')).toBe('testsha');
  });
});
