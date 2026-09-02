import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  consumed: false,
  retryAfter: 0,
  filters: {} as Record<string, unknown>,
}));

vi.mock('@/lib/api-auth', () => ({
  addressRetryAfter: async () => db.retryAfter,
  errorResponse: (err: { status: number; body: unknown; headers?: Record<string, string> }) =>
    Response.json(err.body, { status: err.status, headers: err.headers ?? {} }),
  rateLimited: (seconds: number) => ({
    status: 429,
    body: { error: 'rate_limited', retry_after_seconds: seconds },
    headers: { 'retry-after': String(seconds) },
  }),
  readBodyCapped: (req: Request) => req.text(),
  serviceClient: () => ({
    from: () => {
      const chain = {
        delete: () => chain,
        eq: (column: string, value: unknown) => {
          db.filters[column] = value;
          return chain;
        },
        gt: (column: string, value: unknown) => {
          db.filters[column] = value;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => {
          if (db.consumed) return { data: null, error: null };
          db.consumed = true;
          return {
            data: {
              user_id: 'user-1',
              api_key: `hr_live_${'a'.repeat(40)}`,
              api_key_id: 'key-1',
              scope: 'shares:read',
            },
            error: null,
          };
        },
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

const TX = 'c'.repeat(32);
const CODE = 'A'.repeat(43);

async function exchange() {
  const req = new Request('https://htmlradar.com/api/v1/connect/exchange', {
    method: 'POST',
    headers: {
      authorization: 'Bearer exchange-test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tx: TX, code: CODE }),
  }) as unknown as NextRequest;
  const response = await POST(req);
  return { status: response.status, body: await response.json() };
}

async function exchangeWithAuthorization(authorization: string) {
  const req = new Request('https://htmlradar.com/api/v1/connect/exchange', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ tx: TX, code: CODE }),
  }) as unknown as NextRequest;
  const response = await POST(req);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  process.env['CONNECT_EXCHANGE_SECRET'] = 'exchange-test-secret';
  db.consumed = false;
  db.retryAfter = 0;
  db.filters = {};
});

describe('POST /api/v1/connect/exchange', () => {
  it('rejects a missing or wrong exchange secret', async () => {
    expect(await exchangeWithAuthorization('')).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(await exchangeWithAuthorization('Bearer wrong-secret')).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(db.consumed).toBe(false);
  });

  it('consumes a handle once and rejects the replay', async () => {
    expect(await exchange()).toEqual({
      status: 200,
      body: {
        user_id: 'user-1',
        api_key: `hr_live_${'a'.repeat(40)}`,
        api_key_id: 'key-1',
        scope: 'shares:read',
      },
    });
    expect(db.filters.tx).toBe(TX);
    expect(db.filters.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.filters.expires_at).toEqual(expect.any(String));

    expect(await exchange()).toEqual({ status: 400, body: { error: 'used_or_expired' } });
  });

  it('answers 429 before it even looks at the secret', async () => {
    db.retryAfter = 47;
    expect(await exchangeWithAuthorization('Bearer wrong-secret')).toEqual({
      status: 429,
      body: { error: 'rate_limited', retry_after_seconds: 47 },
    });
    expect(db.consumed).toBe(false);
  });
});
