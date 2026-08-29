import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProfileTier } from '../src/supabase.js';
import type { Env } from '../src/supabase.js';

// getProfileTier decides whether a recipient sees the "Powered by HTMLRadar"
// badge — the single thing separating a free view from a Pro one on the
// document itself. injectTracker's own behaviour for each tier is covered in
// inject.test.ts; this file guards the lookup that chooses which tier goes in.
//
// The direction of failure matters more than the happy path. If a network
// blip or a malformed row made this return 'pro', every free user would
// silently stop showing the badge and we would be giving away the paid
// feature with nothing in the logs to say so. Every degraded case below must
// therefore land on 'free'.

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
} as unknown as Env;

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('getProfileTier', () => {
  it('returns pro when the profile row says pro', async () => {
    mockFetch(200, [{ tier: 'pro' }]);
    await expect(getProfileTier(env, 'owner-1')).resolves.toBe('pro');
  });

  it('returns free when the profile row says free', async () => {
    mockFetch(200, [{ tier: 'free' }]);
    await expect(getProfileTier(env, 'owner-1')).resolves.toBe('free');
  });

  it('falls back to free when the profile row is missing', async () => {
    mockFetch(200, []);
    await expect(getProfileTier(env, 'ghost')).resolves.toBe('free');
  });

  it('falls back to free when the row has no tier column', async () => {
    mockFetch(200, [{}]);
    await expect(getProfileTier(env, 'owner-1')).resolves.toBe('free');
  });

  it('falls back to free when Supabase returns an error status', async () => {
    mockFetch(500, { message: 'upstream exploded' });
    await expect(getProfileTier(env, 'owner-1')).resolves.toBe('free');
  });

  it('scopes the query to the one owner and asks only for the tier column', async () => {
    const spy = mockFetch(200, [{ tier: 'pro' }]);
    await getProfileTier(env, 'owner-42');
    const requested = new URL(spy.mock.calls[0]![0] as string);
    expect(requested.pathname).toBe('/rest/v1/profiles');
    expect(requested.searchParams.get('id')).toBe('eq.owner-42');
    expect(requested.searchParams.get('select')).toBe('tier');
    expect(requested.searchParams.get('limit')).toBe('1');
  });
});
