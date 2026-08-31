import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShareBySlug } from '../src/supabase.js';
import type { Env } from '../src/env.js';

// The one read a recipient request makes.
//
// It moved from `document_shares` to `share_lookup`, the private view added by
// schema/043, for two reasons the trust layer's design gives: the share's
// stored hostname has to be known BEFORE the gate cookies are checked, because
// "a handle host that does not match this share's stored hostname is not found"
// answers before anything else does; and the owner's tier arrives in the same
// row, so the document route now makes one database call where it made two.
//
// This file replaces profile-tier.test.ts. The property that file guarded
// still matters and is guarded here instead: the tier decides whether a
// recipient sees the "Powered by HTMLRadar" badge, and every degraded case has
// to land on 'free'. The other direction would silently give the paid feature
// away with nothing in the logs to say so.

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
} as unknown as Env;

const row = {
  id: 'share-1',
  slug: 'acme-proposal',
  document_id: 'doc-1',
  owner_id: 'owner-1',
  recipient_label: null,
  require_email: false,
  require_password: false,
  allowed_email_domains: null,
  allowed_emails: null,
  lock_deck: false,
  expires_at: null,
  revoked_at: null,
  host_handle: null,
  owner_handle: null,
  owner_tier: 'free',
};

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('getShareBySlug reads the private view', () => {
  it('queries share_lookup, scoped to the one slug', async () => {
    const spy = mockFetch(200, [row]);
    await getShareBySlug(env, 'acme-proposal');
    const requested = new URL(spy.mock.calls[0]![0] as string);
    expect(requested.pathname).toBe('/rest/v1/share_lookup');
    expect(requested.searchParams.get('slug')).toBe('eq.acme-proposal');
    expect(requested.searchParams.get('limit')).toBe('1');
  });

  it('names its columns instead of asking for everything', async () => {
    // The view carries the document's storage key and every customer's handle.
    // A wildcard would put both in a response body on every recipient request
    // for no reason at all.
    const spy = mockFetch(200, [row]);
    await getShareBySlug(env, 'acme-proposal');
    const select = new URL(spy.mock.calls[0]![0] as string).searchParams.get('select') ?? '';
    expect(select).not.toBe('*');
    expect(select.split(',')).toEqual(
      expect.arrayContaining(['host_handle', 'owner_handle', 'owner_tier', 'lock_deck', 'slug']),
    );
    expect(select).not.toContain('r2_key');
  });

  it('returns the stored hostname and the tier with the share', async () => {
    mockFetch(200, [{ ...row, host_handle: 'acme', owner_handle: 'acme', owner_tier: 'pro' }]);
    const share = await getShareBySlug(env, 'acme-proposal');
    expect(share?.host_handle).toBe('acme');
    expect(share?.owner_tier).toBe('pro');
  });

  it('returns null when no share carries that slug', async () => {
    mockFetch(200, []);
    await expect(getShareBySlug(env, 'ghost')).resolves.toBeNull();
  });

  it('throws upstream rather than reading as "deleted" when the view errors', async () => {
    // The difference the recipient sees: a "try again in a moment" page rather
    // than "this link doesn't open anything", which would be a lie about a
    // live share on a transient Supabase blip.
    mockFetch(500, { message: 'upstream exploded' });
    await expect(getShareBySlug(env, 'acme-proposal')).rejects.toThrow(/share_lookup/);
  });
});

describe('the tier fails toward free', () => {
  it('reads pro when the row says pro', async () => {
    mockFetch(200, [{ ...row, owner_tier: 'pro' }]);
    expect((await getShareBySlug(env, 'acme-proposal'))?.owner_tier).toBe('pro');
  });

  it('leaves the tier null when the profile row is missing, which reads as free', async () => {
    // share_lookup left-joins profiles, because document_shares.owner_id points
    // at auth.users and no foreign key guarantees the profile row. The call
    // site turns null into 'free'.
    mockFetch(200, [{ ...row, owner_tier: null }]);
    const share = await getShareBySlug(env, 'acme-proposal');
    expect(share?.owner_tier ?? 'free').toBe('free');
  });
});
