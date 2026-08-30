import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// The route reads document_shares, viewers and sessions through the service
// client; the tests hand it a table of shares and nobody has read any of
// them, so every 200 is the "not opened" shape and the lookup is the whole
// subject.
const db = vi.hoisted(() => ({
  shares: [] as Record<string, unknown>[],
  lastFilters: {} as Record<string, unknown>,
}));

// error-log imports Next's `server-only`, which resolves inside the Next
// build and nowhere else (same stub as api-auth.test.ts).
vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro' } }),
  serviceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          db.lastFilters = filters;
          const row = db.shares.find((share) =>
            Object.entries(filters).every(([column, value]) => share[column] === value),
          );
          return { data: table === 'document_shares' ? (row ?? null) : null };
        },
        // viewers / sessions: awaited directly, and always empty here.
        then: (resolve: (value: { data: unknown[] }) => void) => resolve({ data: [] }),
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const OWN_ID = '11111111-2222-4333-8444-555555555555';
const THEIRS_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

beforeEach(() => {
  db.shares = [
    { id: OWN_ID, slug: 'qa-smoke-deck', owner_id: 'user-1', recipient_label: 'QA' },
    { id: THEIRS_ID, slug: 'their-deck', owner_id: 'user-2', recipient_label: null },
  ];
  db.lastFilters = {};
});

async function activity(id: string) {
  const req = new Request('https://htmlradar.com/api/v1/shares/x/activity', {
    headers: { authorization: 'Bearer hr_live_' + 'a'.repeat(40) },
  }) as unknown as NextRequest;
  const res = await GET(req, { params: { id } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const OWN = {
  status: 200,
  body: {
    share_id: OWN_ID,
    url: 'https://htmlradar.com/r/qa-smoke-deck',
    opened: false,
    viewers: [],
  },
};
const NOT_FOUND = { status: 404, body: { error: 'not_found' } };

describe('GET /api/v1/shares/{id}/activity — finding the share', () => {
  it('by the id share_html returned', async () => {
    expect(await activity(OWN_ID)).toEqual(OWN);
    expect(db.lastFilters).toEqual({ id: OWN_ID });
  });

  it('by the slug the dashboard and the link show', async () => {
    expect(await activity('qa-smoke-deck')).toEqual(OWN);
    // Scoped to the caller in the query itself, not filtered afterwards.
    expect(db.lastFilters).toEqual({ owner_id: 'user-1', slug: 'qa-smoke-deck' });
  });

  it('by the link itself, or its /r/ path', async () => {
    expect(await activity('https://htmlradar.com/r/qa-smoke-deck')).toEqual(OWN);
    expect(await activity('htmlradar.com/r/qa-smoke-deck')).toEqual(OWN);
    expect(await activity('/r/qa-smoke-deck')).toEqual(OWN);
  });

  it("does not find another account's share by id or by slug", async () => {
    expect(await activity(THEIRS_ID)).toEqual(NOT_FOUND);
    expect(await activity('their-deck')).toEqual(NOT_FOUND);
    expect(await activity('https://htmlradar.com/r/their-deck')).toEqual(NOT_FOUND);
  });

  it('treats anything that is neither an id nor a well-formed slug as not found', async () => {
    for (const id of [
      'ab', // too short
      'QA-Smoke-Deck', // not lowercase
      '-qa-smoke-deck', // leading hyphen
      'qa smoke deck',
      'a'.repeat(61),
      'https://htmlradar.com/r/qa-smoke-deck/auth',
      'https://htmlradar.com/r/qa-smoke-deck?x=1',
      'https://evil.example/r/qa-smoke-deck',
      'r/qa-smoke-deck',
      '',
    ]) {
      expect(await activity(id), id).toEqual(NOT_FOUND);
    }
    // None of those reached the database.
    expect(db.lastFilters).toEqual({});
  });
});
