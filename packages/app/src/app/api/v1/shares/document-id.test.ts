// POST /api/v1/shares with `document_id` — another link on a document that
// already exists.
//
// The two things that must hold: nothing is created (no document write, no
// upload, no screen), and a document the key's account does not own is a 404
// rather than a link on somebody else's deck. The third is the one that would
// be expensive to get wrong: a refused link on an existing document must not
// take the document away, because the browser flow's rollback deletes a
// document and every link on it cascades with it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const SHARE_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  rpcArgs: null as Record<string, unknown> | null,
  rpcError: null as { message: string } | null,
  documents: [] as Record<string, unknown>[],
  documentFilters: {} as Record<string, unknown>,
  deletes: [] as string[],
  createdDocuments: 0,
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/r2', () => ({ deleteR2Object: vi.fn(), r2Key: () => 'key' }));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 3 }) }));
vi.mock('@/lib/create-document', () => ({
  createDocumentForUser: async () => {
    db.createdDocuments += 1;
    return 'a-fresh-document';
  },
}));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      db.rpcArgs = args;
      return db.rpcError
        ? { data: null, error: db.rpcError }
        : { data: { id: SHARE_ID, slug: 'acme-deck' }, error: null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        update: () => chain,
        delete: () => {
          db.deletes.push(table);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        is: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          db.documentFilters = filters;
          const row = db.documents.find((doc) =>
            Object.entries(filters).every(([column, value]) => doc[column] === value),
          );
          return { data: table === 'documents' ? (row ?? null) : null, error: null };
        },
        then: (resolve: (value: { error: unknown }) => void) => resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  db.rpcArgs = null;
  db.rpcError = null;
  db.documents = [{ id: DOC_ID, owner_id: 'user-1', deleted_at: null }];
  db.documentFilters = {};
  db.deletes = [];
  db.createdDocuments = 0;
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

describe('POST /api/v1/shares — document_id', () => {
  it('makes a link on the existing document and creates nothing', async () => {
    const res = await post({ document_id: DOC_ID, recipient_label: 'Acme' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      share_id: SHARE_ID,
      document_id: DOC_ID,
      url: 'https://htmlradar.page/r/acme-deck',
      dashboard_url: `https://htmlradar.com/docs/${DOC_ID}`,
    });
    expect(db.createdDocuments).toBe(0);
    expect(db.rpcArgs).toMatchObject({ p_user_id: 'user-1', p_document_id: DOC_ID });
    expect(db.rpcArgs).toMatchObject({ p_recipient_label: 'Acme' });
  });

  // Ownership and the soft delete are both in the query, so the answer to
  // "is this document mine?" is one round trip and cannot be forgotten.
  it('looks the document up by id, owner and not-deleted together', async () => {
    await post({ document_id: DOC_ID });
    expect(db.documentFilters).toEqual({ id: DOC_ID, owner_id: 'user-1', deleted_at: null });
  });

  it("is a 404 for somebody else's document, and for one that was deleted", async () => {
    db.documents = [
      { id: DOC_ID, owner_id: 'user-2', deleted_at: null },
      { id: '33333333-3333-4333-8333-333333333333', owner_id: 'user-1', deleted_at: 'yesterday' },
    ];
    expect((await post({ document_id: DOC_ID })).status).toBe(404);
    expect((await post({ document_id: '33333333-3333-4333-8333-333333333333' })).status).toBe(404);
    expect(db.rpcArgs).toBeNull();
  });

  it('is a 404 for a value that is not an id at all, without a query', async () => {
    const res = await post({ document_id: 'not-a-uuid' });
    expect(res.status).toBe(404);
    expect(db.documentFilters).toEqual({});
  });

  // The rollback that follows a refused link deletes the document. On an
  // existing document that would take the deck and every other link to it.
  it('leaves the document alone when the link is refused', async () => {
    db.rpcError = { message: 'free_tier_share_cap_reached' };
    const res = await post({ document_id: DOC_ID });
    expect(res.status).toBe(402);
    expect(db.deletes).toEqual([]);
  });

  it('refuses html and document_id in the same call', async () => {
    const res = await post({ document_id: DOC_ID, html: '<h1>Deck</h1>' });
    expect(res.status).toBe(422);
    expect(String(res.body['message'])).toMatch(/only one of/i);
    expect(db.createdDocuments).toBe(0);
  });

  it('still refuses a call with nothing to track', async () => {
    const res = await post({ recipient_label: 'Acme' });
    expect(res.status).toBe(422);
    expect(String(res.body['message'])).toMatch(/"html", "url" or "document_id"/);
  });
});
