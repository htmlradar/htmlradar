// GET /api/v1/documents — the account's documents.
//
// The owner filter and the soft-delete filter are the subject, for the same
// reason as the share listing: no session, no listing RPC, so what is written
// in the route is the whole of it. The share count is the other half — it is
// what tells an assistant a deck has already been sent to five people.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  filters: [] as { table: string; op: string; column: string; value: unknown }[],
  limits: [] as number[],
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'free', scope: 'full' } }),
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

beforeEach(() => {
  db.rows = {
    documents: [
      { id: 'doc-1', title: 'Q3 proposal', created_at: '2026-08-30T10:00:00Z' },
      { id: 'doc-2', title: 'Nothing sent yet', created_at: '2026-08-29T10:00:00Z' },
    ],
    document_shares: [{ document_id: 'doc-1' }, { document_id: 'doc-1' }],
  };
  db.filters = [];
  db.limits = [];
});

async function list(query = '') {
  const req = new Request(`https://htmlradar.com/api/v1/documents${query}`, {
    headers: { authorization: `Bearer hr_live_${'a'.repeat(40)}` },
  }) as unknown as NextRequest;
  const res = await GET(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('GET /api/v1/documents', () => {
  it('returns the id, the title, when it was made and how many links point at it', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body['documents']).toEqual([
      {
        document_id: 'doc-1',
        title: 'Q3 proposal',
        created_at: '2026-08-30T10:00:00Z',
        share_count: 2,
      },
      {
        document_id: 'doc-2',
        title: 'Nothing sent yet',
        created_at: '2026-08-29T10:00:00Z',
        share_count: 0,
      },
    ]);
  });

  it('asks only for this account, only for what is not deleted, fifty at a time', async () => {
    await list();
    expect(db.filters).toContainEqual({
      table: 'documents',
      op: 'eq',
      column: 'owner_id',
      value: 'user-1',
    });
    expect(db.filters).toContainEqual({
      table: 'documents',
      op: 'is',
      column: 'deleted_at',
      value: null,
    });
    expect(db.limits).toEqual([50]);
  });

  // The screen's verdict is an operator's evidence, and telling a customer
  // their own score is telling them what the screen looks for.
  it('never returns the phishing screen columns', async () => {
    db.rows['documents'] = [
      {
        id: 'doc-1',
        title: 'Q3 proposal',
        created_at: '2026-08-30T10:00:00Z',
        screen_score: 60,
        screen_signals: ['password-input'],
      },
    ];
    const [document] = (await list()).body['documents'] as Record<string, unknown>[];
    expect(Object.keys(document ?? {})).toEqual([
      'document_id',
      'title',
      'created_at',
      'share_count',
    ]);
  });

  it('pages back with the cursor it was given, and refuses one that is not a timestamp', async () => {
    await list('?before=2026-08-01T00:00:00Z');
    expect(db.filters).toContainEqual({
      table: 'documents',
      op: 'lt',
      column: 'created_at',
      value: '2026-08-01T00:00:00.000Z',
    });

    db.filters = [];
    expect((await list('?before=nonsense')).status).toBe(422);
    expect(db.filters).toEqual([]);
  });

  it('is an empty list, not an error, on a new account', async () => {
    db.rows['documents'] = [];
    expect((await list()).body).toEqual({ documents: [], next_before: null });
  });
});
