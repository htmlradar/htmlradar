import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  emailRetryAfter: 0,
  ipRetryAfter: 0,
  otpError: null as { message: string } | null,
  otpCalls: [] as Array<{ email: string; emailRedirectTo: string }>,
}));

vi.mock('@/lib/api-auth', () => ({
  addressRetryAfter: async () => state.ipRetryAfter,
  addressRetryAfterFor: async () => state.emailRetryAfter,
  errorResponse: (err: { status: number; body: unknown; headers?: Record<string, string> }) =>
    Response.json(err.body, { status: err.status, headers: err.headers ?? {} }),
  rateLimited: (seconds: number) => ({
    status: 429,
    body: { error: 'rate_limited', retry_after_seconds: seconds },
    headers: { 'retry-after': String(seconds) },
  }),
  validationError: (message: string) => ({
    status: 422,
    body: { error: 'validation', message },
  }),
  jsonResponse: (status: number, body: unknown) => Response.json(body, { status }),
  readBodyCapped: (req: Request) => req.text(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async ({
        email,
        options,
      }: {
        email: string;
        options: { emailRedirectTo: string };
      }) => {
        state.otpCalls.push({ email, emailRedirectTo: options.emailRedirectTo });
        return { error: state.otpError };
      },
    },
  }),
}));

import { POST } from './route';

async function post(body: unknown) {
  const req = new Request('https://htmlradar.com/api/auth/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  const response = await POST(req);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  state.emailRetryAfter = 0;
  state.ipRetryAfter = 0;
  state.otpError = null;
  state.otpCalls = [];
});

describe('POST /api/auth/magic-link', () => {
  it('sends the link and redirects through /auth/callback', async () => {
    expect(await post({ email: 'reader@example.com', next: '/docs/abc' })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(state.otpCalls).toEqual([
      {
        email: 'reader@example.com',
        emailRedirectTo: 'https://htmlradar.com/auth/callback?next=%2Fdocs%2Fabc',
      },
    ]);
  });

  it('rejects a missing or malformed email without calling Supabase', async () => {
    expect(await post({ email: '' })).toEqual({
      status: 422,
      body: { error: 'validation', message: 'A valid email address is required.' },
    });
    expect(await post({ email: 'not-an-email' })).toEqual({
      status: 422,
      body: { error: 'validation', message: 'A valid email address is required.' },
    });
    expect(state.otpCalls).toEqual([]);
  });

  it('rejects a disposable email without calling Supabase', async () => {
    expect(await post({ email: 'x@mailinator.com' })).toEqual({
      status: 422,
      body: {
        error: 'validation',
        message: "Disposable email addresses aren't accepted for signup.",
      },
    });
    expect(state.otpCalls).toEqual([]);
  });

  it('answers 429 on the per-address budget before Supabase is called', async () => {
    state.emailRetryAfter = 900;
    expect(await post({ email: 'reader@example.com' })).toEqual({
      status: 429,
      body: { error: 'rate_limited', retry_after_seconds: 900 },
    });
    expect(state.otpCalls).toEqual([]);
  });

  it('answers 429 on the per-IP budget when the address budget is clear', async () => {
    state.ipRetryAfter = 120;
    expect(await post({ email: 'reader@example.com' })).toEqual({
      status: 429,
      body: { error: 'rate_limited', retry_after_seconds: 120 },
    });
    expect(state.otpCalls).toEqual([]);
  });

  it('surfaces a Supabase error as 400', async () => {
    state.otpError = { message: 'signups not allowed for otp' };
    expect(await post({ email: 'reader@example.com' })).toEqual({
      status: 400,
      body: { error: 'otp_error', message: 'signups not allowed for otp' },
    });
  });
});
