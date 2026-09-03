import { describe, expect, it, vi } from 'vitest';
import { hmacSign } from '@/lib/connect';

const state = vi.hoisted(() => ({
  redirect: '',
  wait: 0,
  user: null as { id: string } | null,
}));

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    state.redirect = target;
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/supabase-server', () => ({
  serverClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  requireUser: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('@/lib/api-auth', () => ({ addressRetryAfterFor: async () => state.wait }));
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

  it('says so, rather than redirecting, when the address is over its budget', async () => {
    state.wait = 30;
    const page = await ConnectPage({ searchParams: {} });
    state.wait = 0;
    expect(JSON.stringify(page)).toContain('Too many connection attempts');
  });
});

describe('GET /connect while signed in', () => {
  async function renderFor(scope: string) {
    process.env['CONNECT_SIGNING_SECRET'] = 'page-test-secret';
    state.user = { id: 'user-1' };
    const searchParams = {
      tx: 'c'.repeat(32),
      client_id: 'https://claude.ai/.well-known/oauth-client',
      client_host: 'claude.ai',
      scope,
      exp: '2000000000',
      sig: '',
    };
    searchParams.sig = await hmacSign(
      `${searchParams.tx}\n${searchParams.client_id}\n${searchParams.client_host}\n${searchParams.scope}\n${searchParams.exp}`,
      process.env['CONNECT_SIGNING_SECRET'],
    );
    const page = await ConnectPage({ searchParams });
    state.user = null;
    return JSON.stringify(page);
  }

  it('pre-selects Read and publish when write was requested alongside read', async () => {
    const html = await renderFor('shares:read shares:write');
    expect(html).toContain('"value":"shares:read shares:write","defaultChecked":true');
    expect(html).toContain('"value":"shares:read","defaultChecked":false');
    expect(html).toContain('Claude asked for read and publish access for this action.');
  });

  it('pre-selects Read-only when only read was requested', async () => {
    const html = await renderFor('shares:read');
    expect(html).toContain('"value":"shares:read","defaultChecked":true');
    expect(html).not.toContain('Claude asked for read and publish access for this action.');
  });
});
