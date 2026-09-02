import { describe, expect, it, vi } from 'vitest';
import { hmacSign } from '@/lib/connect';

const state = vi.hoisted(() => ({ redirect: '' }));

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    state.redirect = target;
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/supabase-server', () => ({
  serverClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  requireUser: vi.fn(),
}));
import ConnectPage from './page';

describe('GET /connect while signed out', () => {
  it('redirects to sign-in with the complete consent request preserved', async () => {
    process.env['CONNECT_SIGNING_SECRET'] = 'page-test-secret';
    const searchParams = {
      tx: 'b'.repeat(32),
      client_id: 'https://claude.ai/.well-known/oauth-client',
      client_host: 'claude.ai',
      scope: 'shares:read shares:write',
      exp: '2000000000',
      sig: '',
    };
    searchParams.sig = await hmacSign(
      `${searchParams.tx}\n${searchParams.client_id}\n${searchParams.client_host}\n${searchParams.scope}\n${searchParams.exp}`,
      process.env['CONNECT_SIGNING_SECRET'],
    );

    await expect(ConnectPage({ searchParams })).rejects.toThrow('NEXT_REDIRECT');
    expect(state.redirect).toBe(
      `/sign-in?next=${encodeURIComponent(`/connect?${new URLSearchParams(searchParams)}`)}`,
    );
  });
});
