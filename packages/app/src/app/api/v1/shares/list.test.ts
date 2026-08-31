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

/**
 * What the database does with the cursor: newest first, then by identifier,
 * keeping only rows strictly before the cursor, capped at the page size.
 * Enough of PostgREST to prove the two-column paging, and no more.
 */
function page(
  rows: Record<string, unknown>[],
  filter: string | null,
  limit: number,
): Record<string, unknown>[] {
  const at = (row: Record<string, unknown>) => new Date(String(row['created_at'])).getTime();
  const sorted = [...rows].sort((a, b) =>
    at(a) === at(b) ? String(b['id']).localeCompare(String(a['id'])) : at(b) - at(a),
  );
  if (!filter) return sorted.slice(0, limit);

  const parsed =
    /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"\)$/.exec(filter);
  if (!parsed) throw new Error(`the route built a filter this stub cannot read: ${filter}`);
  const [, older, same, id] = parsed;
  const cutoff = new Date(String(older)).getTime();
  return sorted
    .filter((row) => {
      const when = at(row);
      if (when < cutoff) return true;
      return when === new Date(String(same)).getTime() && String(row['id']) < String(id);
    })
    .slice(0, limit);
}

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
      let filter: string | null = null;
      let limit = Infinity;
      const chain = {
        select: () => chain,
        eq: record('eq'),
        is: record('is'),
        in: record('in'),
        or: (expression: string) => {
          filter = expression;
          db.filters.push({ table, op: 'or', column: 'created_at,id', value: expression });
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          db.limits.push(n);
          limit = n;
          return chain;
        },
        then: (resolve: (value: { data: unknown; error: null }) => void) =>
          resolve({ data: page(db.rows[table] ?? [], filter, limit), error: null }),
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
      {
        ...SHARE,
        id: 'share-2',
        slug: 'old-deck',
        created_at: '2026-08-29T10:00:00Z',
        expires_at: '2020-01-01T00:00:00Z',
      },
    ];
    const [revoked, expired] = shares((await list()).body);
    expect(revoked).toMatchObject({ revoked: true, revoked_at: '2026-08-31T08:00:00Z' });
    expect(expired).toMatchObject({ revoked: false, expired: true });
  });

  it('has no cursor when the page was not full', async () => {
    expect((await list()).body['next_before']).toBeNull();
  });

  it('pages back through older links with the cursor it was given', async () => {
    await list('?before=2026-08-01T00:00:00Z|share-9');
    expect(db.filters).toContainEqual({
      table: 'document_shares',
      op: 'or',
      column: 'created_at,id',
      value:
        'created_at.lt."2026-08-01T00:00:00.000Z",' +
        'and(created_at.eq."2026-08-01T00:00:00.000Z",id.lt."share-9")',
    });
  });

  it('refuses a cursor that is not one it handed out', async () => {
    const res = await list('?before=last-tuesday');
    expect(res.status).toBe(422);
    expect(db.filters).toEqual([]);
  });

  // The failure this is here to stop: fifty is a page, created_at is not
  // unique, and a bulk run writes many links in the same millisecond. Paging
  // on the timestamp alone drops every row that shares the boundary one.
  it('loses nothing when sixty links share a single timestamp', async () => {
    const created_at = '2026-08-30T10:00:00Z';
    db.rows['document_shares'] = Array.from({ length: 60 }, (_, i) => ({
      ...SHARE,
      id: `share-${String(i).padStart(3, '0')}`,
      slug: `deck-${i}`,
      created_at,
    }));

    const first = await list();
    const firstPage = shares(first.body);
    expect(firstPage).toHaveLength(50);

    const cursor = first.body['next_before'];
    expect(cursor).toBe(`2026-08-30T10:00:00.000Z|${firstPage[49]?.['share_id']}`);

    const second = await list(`?before=${cursor}`);
    const secondPage = shares(second.body);
    expect(secondPage).toHaveLength(10);
    expect(second.body['next_before']).toBeNull();

    // Sixty distinct links across the two pages, which is the whole point.
    const seen = [...firstPage, ...secondPage].map((share) => share['share_id']);
    expect(new Set(seen).size).toBe(60);
  });

  it('says so plainly when the account has no links', async () => {
    db.rows['document_shares'] = [];
    expect((await list()).body).toEqual({ shares: [], next_before: null });
  });
});
