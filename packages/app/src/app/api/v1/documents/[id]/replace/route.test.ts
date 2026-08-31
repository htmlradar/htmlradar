// POST /api/v1/documents/{id}/replace — new contents, same links.
//
// The subjects: the document must be the caller's own and an upload rather
// than a URL source; the new HTML goes through the phishing screen before it
// takes over links that have already been sent, and a flagged replacement
// still goes through, because the screen informs an operator rather than
// gating the product; and nothing touches document_shares, because "every
// link unchanged" is the whole promise of the endpoint.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const DOC_ID = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  documents: [] as Record<string, unknown>[],
  lookupFilters: {} as Record<string, unknown>,
  writes: [] as {
    table: string;
    values: Record<string, unknown>;
    filters: Record<string, unknown>;
  }[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  uploads: [] as { key: string; bytes: number }[],
  flags: [] as { documentId: string; score: number }[],
  events: [] as { event: string; properties: Record<string, unknown> }[],
  uploadFails: false,
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({
  captureServerEvent: async (e: { event: string; properties: Record<string, unknown> }) => {
    db.events.push(e);
  },
}));
vi.mock('@/lib/r2', () => ({
  r2Key: (userId: string, docId: string, version: number) =>
    `docs/${userId}/${docId}/v${version}.html`,
  uploadHtml: async (key: string, bytes: Uint8Array) => {
    if (db.uploadFails) throw new Error('R2 is down');
    db.uploads.push({ key, bytes: bytes.byteLength });
  },
}));
// The screen itself has its own tests (lib/screen-html.test.ts). What this
// route owes it is the caller's bytes, before the swap, and the queue write
// when it scores high.
vi.mock('@/lib/create-document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/create-document')>()),
  flagIfHighScore: async (documentId: string, _userId: string, screen: { score: number }) => {
    db.flags.push({ documentId, score: screen.score });
  },
}));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      let op: 'update' | 'insert' | '' = '';
      const chain = {
        select: () => chain,
        update: (v: Record<string, unknown>) => {
          op = 'update';
          values = v;
          return chain;
        },
        insert: (v: Record<string, unknown>) => {
          op = 'insert';
          values = v;
          db.inserts.push({ table, values: v });
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
          db.lookupFilters = { ...filters };
          const row = db.documents.find((doc) =>
            Object.entries(filters).every(([column, value]) => doc[column] === value),
          );
          return { data: table === 'documents' ? (row ?? null) : null, error: null };
        },
        then: (resolve: (value: { error: null }) => void) => {
          if (op === 'update' && values) {
            db.writes.push({ table, values, filters: { ...filters } });
          }
          resolve({ error: null });
        },
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

// A password box plus a brand's sign-in wording: 60, over the flag threshold.
const PHISHING = '<form><input type="password"><p>Sign in to your Microsoft account</p></form>';

beforeEach(() => {
  db.documents = [
    { id: DOC_ID, owner_id: 'user-1', deleted_at: null, source_type: 'upload', current_version: 3 },
  ];
  db.lookupFilters = {};
  db.writes = [];
  db.inserts = [];
  db.uploads = [];
  db.flags = [];
  db.events = [];
  db.uploadFails = false;
});

async function replace(id: string, body: Record<string, unknown>) {
  const req = new Request(`https://htmlradar.com/api/v1/documents/${id}/replace`, {
    method: 'POST',
    headers: {
      authorization: `Bearer hr_live_${'a'.repeat(40)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  const res = await POST(req, { params: { id } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/v1/documents/{id}/replace', () => {
  it('uploads the next version, points the document at it, and records the history', async () => {
    const res = await replace(DOC_ID, { html: '<h1>Version four</h1>' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ document_id: DOC_ID, version: 4, links_unchanged: true });
    expect(db.uploads).toEqual([{ key: `docs/user-1/${DOC_ID}/v4.html`, bytes: 21 }]);
    expect(db.writes[0]).toMatchObject({
      table: 'documents',
      filters: { id: DOC_ID, owner_id: 'user-1' },
      values: { current_version: 4, r2_key: `docs/user-1/${DOC_ID}/v4.html` },
    });
    expect(db.inserts[0]).toMatchObject({
      table: 'document_versions',
      values: { document_id: DOC_ID, version: 4, replaced_by: 'user-1' },
    });
    expect(db.events.map((e) => e.event)).toEqual(['document.replaced']);
  });

  // The promise of the endpoint, written as a test: the links are not read,
  // not updated, not touched.
  it('never goes near document_shares', async () => {
    await replace(DOC_ID, { html: '<h1>Version four</h1>' });
    expect(db.writes.some((w) => w.table === 'document_shares')).toBe(false);
    expect(db.inserts.some((i) => i.table === 'document_shares')).toBe(false);
  });

  it('looks the document up by id, owner and not-deleted together', async () => {
    await replace(DOC_ID, { html: '<h1>Four</h1>' });
    expect(db.lookupFilters).toEqual({ id: DOC_ID, owner_id: 'user-1', deleted_at: null });
  });

  it("is a 404 for somebody else's document, and uploads nothing", async () => {
    db.documents = [{ id: DOC_ID, owner_id: 'user-2', deleted_at: null, source_type: 'upload' }];
    expect((await replace(DOC_ID, { html: '<h1>Four</h1>' })).status).toBe(404);
    expect(db.uploads).toEqual([]);
  });

  it('refuses a document that is served from its own address', async () => {
    db.documents = [{ id: DOC_ID, owner_id: 'user-1', deleted_at: null, source_type: 'url' }];
    const res = await replace(DOC_ID, { html: '<h1>Four</h1>' });
    expect(res.status).toBe(422);
    expect(String(res.body['message'])).toMatch(/nothing to replace/);
    expect(db.uploads).toEqual([]);
  });

  // Screen and flag, never block — the same line every other upload path
  // takes. Blocking would cost a paying customer their document over a
  // heuristic; flagging costs an operator one glance.
  it('flags a high-scoring replacement and still replaces the document', async () => {
    const res = await replace(DOC_ID, { html: PHISHING });
    expect(res.status).toBe(200);
    expect(db.flags).toEqual([{ documentId: DOC_ID, score: 60 }]);
    expect(db.writes[0]?.values).toMatchObject({ screen_score: 60 });
  });

  it('writes the screen verdict of ordinary HTML as the zero it is', async () => {
    await replace(DOC_ID, { html: '<h1>Version four</h1>' });
    expect(db.writes[0]?.values).toMatchObject({ screen_score: 0, screen_signals: [] });
    expect(db.flags).toEqual([{ documentId: DOC_ID, score: 0 }]);
  });

  it('refuses a body with no html, one that is not HTML, and one over 5 MB', async () => {
    expect((await replace(DOC_ID, {})).status).toBe(422);
    expect((await replace(DOC_ID, { html: 'just some words' })).status).toBe(422);
    expect((await replace(DOC_ID, { html: `<p>${'x'.repeat(5 * 1024 * 1024)}</p>` })).status).toBe(
      413,
    );
    expect(db.uploads).toEqual([]);
  });

  it('is a 404 for a document id that is not an id, before anything is read', async () => {
    expect((await replace('not-a-uuid', { html: '<h1>Four</h1>' })).status).toBe(404);
    expect(db.lookupFilters).toEqual({});
  });

  // Upload first: a failed upload leaves every recipient reading the version
  // they already had.
  it('leaves the document where it was when the upload fails', async () => {
    db.uploadFails = true;
    expect((await replace(DOC_ID, { html: '<h1>Four</h1>' })).status).toBe(500);
    expect(db.writes).toEqual([]);
    expect(db.inserts).toEqual([]);
  });
});
