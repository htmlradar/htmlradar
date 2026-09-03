// GET /api/v1/me — the whoami tool's data source. Its one job is to be
// truthful and plan-aware: a paid plan reports no free-link cap (null means
// unlimited, never a number to count against), and a free plan's used count
// never exceeds its own allowance, even if the account has more shares than
// that from a legacy or comped state.

import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const quota = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro', used: 0, cap: 2 }));

vi.mock('@/lib/quota', () => ({ readQuota: async () => quota }));
vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({}),
}));

import { GET } from './route';

async function me() {
  const req = new Request('https://htmlradar.com/api/v1/me', {
    headers: { authorization: `Bearer hr_live_${'a'.repeat(40)}` },
  }) as unknown as NextRequest;
  const res = await GET(req);
  return (await res.json()) as Record<string, unknown>;
}

describe('GET /api/v1/me', () => {
  it('reports a free account as N of its real cap', async () => {
    Object.assign(quota, { tier: 'free', used: 1, cap: 2 });
    expect(await me()).toMatchObject({ tier: 'free', free_links_used: 1, free_links_cap: 2 });
  });

  it('never claims more used than the free cap allows', async () => {
    // A legacy or comped account can have more shares than the free cap.
    Object.assign(quota, { tier: 'free', used: 12, cap: 2 });
    expect(await me()).toMatchObject({ tier: 'free', free_links_used: 2, free_links_cap: 2 });
  });

  it('reports a paid plan as having no cap, not a number to count against', async () => {
    Object.assign(quota, { tier: 'pro', used: 12, cap: 2 });
    expect(await me()).toMatchObject({ tier: 'pro', free_links_cap: null });
  });
});
