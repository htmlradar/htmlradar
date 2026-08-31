// POST /api/v1/shares — the `lock_deck` setting.
//
// Locking a deck blocks save and print and paints the tiled watermark. It is
// on by default, in the database (schema/015) and in the browser form, and
// until now the API had no way to turn it off: a customer working through an
// AI tool had to open the dashboard to change a setting the dashboard offers
// (2026-08-30 flight check, defect 4).
//
// create_share_as does not take the flag — the browser does not pass it to
// create_share either — so, exactly as the browser does, the link is created
// with the column default and the toggle is a follow-up write.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const SHARE_ID = '11111111-1111-4111-8111-111111111111';

interface TableCall {
  table: string;
  op: 'update' | 'delete' | '';
  values?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

const db = vi.hoisted(() => ({
  rpcArgs: null as Record<string, unknown> | null,
  calls: [] as TableCall[],
  updateError: null as { message: string } | null,
  documentSource: null as { type: string; bytes?: Uint8Array } | null,
}));

// These three reach the network or Next's server-only runtime; the route's
// own logic is the subject here.
vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/r2', () => ({ deleteR2Object: vi.fn(), r2Key: () => 'key' }));
// Records the source so the screening chain can be asserted: the phishing
// screen runs inside createDocumentForUser (lib/create-document.test.ts covers
// what it does with what it is given), so what this route owes it is the
// caller's own bytes, unmodified.
vi.mock('@/lib/create-document', () => ({
  createDocumentForUser: async (
    _client: unknown,
    _userId: string,
    _title: string,
    source: { type: string; bytes?: Uint8Array },
  ) => {
    db.documentSource = source;
    return 'doc-1';
  },
}));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 0 }) }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro' } }),
  serviceClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      db.rpcArgs = args;
      return { data: { id: SHARE_ID, slug: 'quick-glass' }, error: null };
    },
    from: (table: string) => {
      const call: TableCall = { table, op: '', filters: {} };
      const chain = {
        update(values: Record<string, unknown>) {
          call.op = 'update';
          call.values = values;
          return chain;
        },
        delete() {
          call.op = 'delete';
          return chain;
        },
        eq(column: string, value: unknown) {
          call.filters[column] = value;
          return chain;
        },
        then(resolve: (value: { error: unknown }) => void) {
          db.calls.push(call);
          const failing = call.table === 'document_shares' && call.op === 'update';
          resolve({ error: failing ? db.updateError : null });
        },
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  db.rpcArgs = null;
  db.calls = [];
  db.updateError = null;
  db.documentSource = null;
});

async function post(body: Record<string, unknown>) {
  const req = new Request('https://htmlradar.com/api/v1/shares', {
    method: 'POST',
    headers: {
      authorization: `Bearer hr_live_${'a'.repeat(40)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HTML = { html: '<h1>Deck</h1>' };

function lockUpdates() {
  return db.calls.filter((call) => call.table === 'document_shares' && call.op === 'update');
}

describe('POST /api/v1/shares — lock_deck', () => {
  it('leaves the deck locked when the field is absent, as it always was', async () => {
    const res = await post(HTML);
    expect(res.status).toBe(201);
    expect(db.rpcArgs).not.toBeNull();
    // Nothing is written: true is already the column default.
    expect(lockUpdates()).toEqual([]);
  });

  it('leaves the deck locked when the caller asks for true', async () => {
    expect((await post({ ...HTML, lock_deck: true })).status).toBe(201);
    expect(lockUpdates()).toEqual([]);
  });

  it('unlocks the deck when the caller asks for false, on that row only', async () => {
    const res = await post({ ...HTML, lock_deck: false });
    expect(res.status).toBe(201);
    expect(res.body['share_id']).toBe(SHARE_ID);
    expect(lockUpdates()).toEqual([
      {
        table: 'document_shares',
        op: 'update',
        values: { lock_deck: false },
        filters: { id: SHARE_ID, owner_id: 'user-1' },
      },
    ]);
  });

  it('refuses anything that is not a boolean, before creating anything', async () => {
    for (const value of ['false', 0, null, {}]) {
      const res = await post({ ...HTML, lock_deck: value });
      expect(res.status, JSON.stringify(value)).toBe(422);
      expect(res.body).toEqual({ error: 'validation', message: '"lock_deck" must be a boolean.' });
    }
    expect(db.rpcArgs).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('hands the HTML the caller sent, unmodified, to the screened create path', async () => {
    expect((await post({ html: '<h1>Deck</h1><p>Nothing to see.</p>' })).status).toBe(201);
    expect(db.documentSource?.type).toBe('upload');
    expect(new TextDecoder().decode(db.documentSource?.bytes)).toBe(
      '<h1>Deck</h1><p>Nothing to see.</p>',
    );
  });

  it('takes the whole link back when the setting cannot be written', async () => {
    // A link that quietly ignores the setting the caller asked for is not the
    // link they asked for, so the document goes with it and the share
    // cascades from the document.
    db.updateError = { message: 'connection lost' };
    const res = await post({ ...HTML, lock_deck: false });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal' });
    expect(db.calls.some((call) => call.table === 'documents' && call.op === 'delete')).toBe(true);
  });
});
