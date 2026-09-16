import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// The auth return path has two doors: a PKCE `code` from Google, and a
// `token_hash` from an e-mail link. The second door is the fix for the
// 4 to 16 Sep 2026 outage where every e-mail sign-in landed signed out,
// so these tests hold that a token_hash is verified server-side, that a
// bad one is reported as expired, and that the code door is unchanged.

const state = vi.hoisted(() => ({
  verifyCalls: [] as Array<{ type: string; token_hash: string }>,
  exchangeCalls: [] as string[],
  verifyError: null as { message: string } | null,
  events: [] as string[],
}));

vi.mock('@/lib/supabase-server', () => ({
  serverClient: () => ({
    auth: {
      verifyOtp: async (args: { type: string; token_hash: string }) => {
        state.verifyCalls.push(args);
        return state.verifyError
          ? { data: { user: null }, error: state.verifyError }
          : {
              data: {
                user: {
                  id: 'u1',
                  created_at: new Date().toISOString(),
                  app_metadata: { provider: 'email' },
                  email: 'x@y.z',
                },
              },
              error: null,
            };
      },
      exchangeCodeForSession: async (code: string) => {
        state.exchangeCalls.push(code);
        return {
          data: {
            user: {
              id: 'u1',
              created_at: '2026-01-01T00:00:00Z',
              app_metadata: { provider: 'google' },
              email: 'x@y.z',
            },
          },
          error: null,
        };
      },
    },
  }),
}));

vi.mock('@/lib/events', () => ({
  captureServerEvent: async ({ event }: { event: string }) => {
    state.events.push(event);
  },
}));

import { GET } from './route';

function get(query: string) {
  const req = new Request(`https://htmlradar.com/auth/callback?${query}`) as unknown as NextRequest;
  // NextRequest carries a cookie store; a plain Request does not.
  Object.assign(req, { cookies: { get: () => undefined } });
  return GET(req);
}

beforeEach(() => {
  state.verifyCalls = [];
  state.exchangeCalls = [];
  state.verifyError = null;
  state.events = [];
});

describe('the e-mail link door', () => {
  it('verifies the token hash server-side and sends the person on to next', async () => {
    const res = await get('next=%2Fconvert%3Fresume%3Dabc&token_hash=h1&type=email');
    expect(state.verifyCalls).toEqual([{ type: 'email', token_hash: 'h1' }]);
    expect(state.exchangeCalls).toEqual([]);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://htmlradar.com/convert?resume=abc');
    expect(state.events).toContain('user.signed_in');
  });

  it('reports a used or expired link as expired, keeping the destination', async () => {
    state.verifyError = { message: 'Token has expired or is invalid' };
    const res = await get('next=%2Fconvert&token_hash=h1&type=email');
    const dest = new URL(res.headers.get('location')!);
    expect(dest.pathname).toBe('/sign-in');
    expect(dest.searchParams.get('error')).toBe('expired');
    expect(dest.searchParams.get('next')).toBe('/convert');
    expect(state.events).toContain('auth.callback_failed');
  });
});

describe('the Google door is unchanged', () => {
  it('exchanges the code and redirects to next', async () => {
    const res = await get('code=c1&next=%2Fdocs');
    expect(state.exchangeCalls).toEqual(['c1']);
    expect(state.verifyCalls).toEqual([]);
    expect(res.headers.get('location')).toBe('https://htmlradar.com/docs');
  });

  it('with neither code nor token hash just goes to next', async () => {
    const res = await get('next=%2Fpricing');
    expect(res.headers.get('location')).toBe('https://htmlradar.com/pricing');
    expect(state.exchangeCalls).toEqual([]);
  });
});
