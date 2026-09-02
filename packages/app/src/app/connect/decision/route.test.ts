import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createConsentNonce, hmacSign, verifyHmac } from '@/lib/connect';

vi.mock('@/lib/supabase-server', () => ({
  requireUser: async () => ({ id: 'user-1' }),
  serverClient: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  apiKeyPrefix: vi.fn(),
  generateApiKey: vi.fn(),
  hashApiKey: vi.fn(),
}));
vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));

import { POST } from './route';

async function signedValues(overrides: Partial<Record<string, string>> = {}) {
  const secret = process.env['CONNECT_SIGNING_SECRET']!;
  const values = {
    tx: 'd'.repeat(32),
    client_id: 'https://claude.ai/.well-known/oauth-client',
    client_host: 'claude.ai',
    scope: 'shares:read',
    exp: '2000000000',
    sig: '',
    nonce: '',
    decision: 'cancel',
    ...overrides,
  };
  values.sig = await hmacSign(
    `${values.tx}\n${values.client_id}\n${values.client_host}\n${values.scope}\n${values.exp}`,
    secret,
  );
  return values;
}

function postDecision(values: Record<string, string>): Promise<Response> {
  return POST(
    new Request('https://htmlradar.com/connect/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    }) as unknown as NextRequest,
  );
}

describe('POST /connect/decision', () => {
  it('refuses a missing, forged, or another user’s nonce', async () => {
    process.env['CONNECT_SIGNING_SECRET'] = 'decision-test-secret';
    const secret = process.env['CONNECT_SIGNING_SECRET'];

    const missing = await signedValues({ nonce: '' });
    const forged = await signedValues({ nonce: 'not-a-real-nonce.deadbeef' });
    const otherUser = await signedValues();
    otherUser.nonce = await createConsentNonce(otherUser.tx, 'user-2', otherUser.exp, secret);

    for (const values of [missing, forged, otherUser]) {
      const response = await postDecision(values);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('location')!);
      expect(`${location.origin}${location.pathname}`).toBe('https://htmlradar.com/connect');
    }
  });

  it('returns the contract-required 302 and signed denial', async () => {
    process.env['CONNECT_SIGNING_SECRET'] = 'decision-test-secret';
    const values = {
      tx: 'd'.repeat(32),
      client_id: 'https://claude.ai/.well-known/oauth-client',
      client_host: 'claude.ai',
      scope: 'shares:read',
      exp: '2000000000',
      sig: '',
      nonce: '',
      decision: 'cancel',
    };
    values.sig = await hmacSign(
      `${values.tx}\n${values.client_id}\n${values.client_host}\n${values.scope}\n${values.exp}`,
      process.env['CONNECT_SIGNING_SECRET'],
    );
    values.nonce = await createConsentNonce(
      values.tx,
      'user-1',
      values.exp,
      process.env['CONNECT_SIGNING_SECRET'],
    );
    const req = new Request('https://htmlradar.com/connect/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    }) as unknown as NextRequest;

    const response = await POST(req);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://mcp.htmlradar.com/connect/callback',
    );
    expect(location.searchParams.get('tx')).toBe(values.tx);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(
      await verifyHmac(
        `${values.tx}\naccess_denied\n${location.searchParams.get('exp')}`,
        location.searchParams.get('sig')!,
        process.env['CONNECT_SIGNING_SECRET'],
      ),
    ).toBe(true);
  });
});
