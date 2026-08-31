// GET /api/v1/shares — the account's links.
//
// Two things are the subject. The owner filter, because there is no listing
// function in the database and no session to scope to, so the filter written
// in the route is the whole of the security. And "opened", because it has to
// mean what the dashboard and the activity endpoint mean by it: the owner's
// own test reads do not count, and neither do phantom sessions that bounced
// with no active time and no scroll.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  filters: [] as { table: string; op: string; column: string; value: unknown }[],
  limits: [] as number[],
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/r2', () => ({ deleteR2Object: vi.fn(), r2Key: () => 'key' }));
vi.mock('@/lib/create-document', () => ({ createDocumentForUser: vi.fn() }));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 0 }) }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({
    from: (table: string) => {
      const record = (op: string) => (column: string, value: unknown) => {
        db.filters.push({ table, op, column, value });
        return chain;
      };
      const chain = {
        select: () => chain,
        eq: record('eq'),
        is: record('is'),
        lt: record('lt'),
        in: record('in'),
        order: () => chain,
        limit: (n: number) => {
          db.limits.push(n);
          return chain;
        },
        then: (resolve: (value: { data: unknown; error: null }) => void) =>
          resolve({ data: db.rows[table] ?? [], error: null }),
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const SHARE = {
  id: 'share-1',
  slug: 'acme-deck',
  document_id: 'doc-1',
  recipient_label: 'Acme',
  created_at: '2026-08-30T10:00:00Z',
  revoked_at: null,
  expires_at: null,
};

beforeEach(() => {
  db.rows = {
    document_shares: [SHARE],
    documents: [{ id: 'doc-1', title: 'Q3 proposal' }],
    sessions: [],
    viewers: [],
  };
  db.filters = [];
  db.limits = [];
});

async function list(query = '') {
  const req = new Request(`https://htmlradar.com/api/v1/shares${query}`, {
    headers: { authorization: `Bearer hr_live_${'a'.repeat(40)}` },
  }) as unknown as NextRequest;
  const res = await GET(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function shares(body: Record<string, unknown>) {
  return body['shares'] as Record<string, unknown>[];
}

describe('GET /api/v1/shares', () => {
  it('returns one row per link, with what the other endpoints take as arguments', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(shares(res.body)[0]).toEqual({
      share_id: 'share-1',
      slug: 'acme-deck',
      url: 'https://htmlradar.page/r/acme-deck',
      recipient_label: 'Acme',
      document_id: 'doc-1',
      document_title: 'Q3 proposal',
      created_at: '2026-08-30T10:00:00Z',
      revoked: false,
      revoked_at: null,
      expires_at: null,
      expired: false,
      opened: false,
      last_open: null,
    });
  });

  it('asks the database only for this account, fifty at a time', async () => {
    await list();
    expect(db.filters).toContainEqual({
      table: 'document_shares',
      op: 'eq',
      column: 'owner_id',
      value: 'user-1',
    });
    expect(db.limits).toEqual([50]);
  });

  it('counts a real read as opened and keeps the most recent one', async () => {
    db.rows['sessions'] = [
      { share_id: 'share-1', viewer_id: 'v-1', started_at: '2026-08-30T11:00:00Z' },
      { share_id: 'share-1', viewer_id: 'v-1', started_at: '2026-08-31T09:00:00Z' },
    ];
    const [share] = shares((await list()).body);
    expect(share?.['opened']).toBe(true);
    expect(share?.['last_open']).toBe('2026-08-31T09:00:00Z');
  });

  // The same two filters the activity endpoint applies, so the list and the
  // report cannot disagree about whether something was read.
  it("does not count the owner's own test reads, or a phantom session", async () => {
    db.rows['viewers'] = [{ id: 'v-internal' }];
    db.rows['sessions'] = [
      { share_id: 'share-1', viewer_id: 'v-internal', started_at: '2026-08-31T09:00:00Z' },
      {
        share_id: 'share-1',
        viewer_id: 'v-2',
        started_at: '2026-08-31T10:00:00Z',
        bounced: true,
        active_time_seconds: 0,
        max_scroll_depth: 0,
      },
    ];
    const [share] = shares((await list()).body);
    expect(share?.['opened']).toBe(false);
    expect(share?.['last_open']).toBeNull();
  });

  it('reports a revoked link and an expired one as such', async () => {
    db.rows['document_shares'] = [
      { ...SHARE, revoked_at: '2026-08-31T08:00:00Z' },
      { ...SHARE, id: 'share-2', slug: 'old-deck', expires_at: '2020-01-01T00:00:00Z' },
    ];
    const [revoked, expired] = shares((await list()).body);
    expect(revoked).toMatchObject({ revoked: true, revoked_at: '2026-08-31T08:00:00Z' });
    expect(expired).toMatchObject({ revoked: false, expired: true });
  });

  it('has no cursor when the page was not full', async () => {
    expect((await list()).body['next_before']).toBeNull();
  });

  it('pages back through older links with the cursor it was given', async () => {
    await list('?before=2026-08-01T00:00:00Z');
    expect(db.filters).toContainEqual({
      table: 'document_shares',
      op: 'lt',
      column: 'created_at',
      value: '2026-08-01T00:00:00.000Z',
    });
  });

  it('refuses a cursor that is not a timestamp', async () => {
    const res = await list('?before=last-tuesday');
    expect(res.status).toBe(422);
    expect(db.filters).toEqual([]);
  });

  it('says so plainly when the account has no links', async () => {
    db.rows['document_shares'] = [];
    expect((await list()).body).toEqual({ shares: [], next_before: null });
  });
});
