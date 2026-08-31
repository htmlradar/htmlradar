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
  deletes: [] as string[],
  flags: [] as { documentId: string; score: number }[],
  events: [] as { event: string; properties: Record<string, unknown> }[],
  uploadFails: false,
  // Runs at the moment the bytes reach R2, which is the window between the
  // read at the top of the call and the swap at the end of it.
  onUpload: null as null | (() => void),
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
    // A tick, so two replacements racing in one test interleave the way two
    // requests do: both read, then both try to claim.
    await Promise.resolve();
    db.uploads.push({ key, bytes: bytes.byteLength });
    db.onUpload?.();
  },
  deleteR2Object: async (key: string) => {
    db.deletes.push(key);
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
      const matching = () =>
        db.documents.filter((doc) =>
          Object.entries(filters).every(([column, value]) => doc[column] === value),
        );
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
          return { data: table === 'documents' ? (matching()[0] ?? null) : null, error: null };
        },
        // The write lands on the stored rows, so a compare-and-swap that no
        // longer matches returns no rows here exactly as PostgREST would.
        then: (resolve: (value: { data: unknown; error: null }) => void) => {
          if (op !== 'update' || !values) {
            resolve({ data: null, error: null });
            return;
          }
          db.writes.push({ table, values, filters: { ...filters } });
          const rows = table === 'documents' ? matching() : [];
          for (const row of rows) Object.assign(row, values);
          resolve({ data: rows.map((row) => ({ id: row['id'] })), error: null });
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
  db.deletes = [];
  db.flags = [];
  db.events = [];
  db.uploadFails = false;
  db.onUpload = null;
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
    // The key names the version and then something no other request can guess,
    // so two replacements racing for version 4 never share an object.
    expect(db.uploads).toHaveLength(1);
    expect(db.uploads[0]?.bytes).toBe(21);
    expect(db.uploads[0]?.key).toMatch(new RegExp(`^docs/user-1/${DOC_ID}/v4-[0-9a-f]{8}\\.html$`));
    expect(db.writes[0]).toMatchObject({
      table: 'documents',
      filters: { id: DOC_ID, owner_id: 'user-1' },
      values: { current_version: 4, r2_key: db.uploads[0]?.key },
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

  // The swap is conditional on the version this call read, so of two
  // replacements that both saw version 3 exactly one can land. Without that
  // condition both would write v4, one would silently overwrite the other, and
  // the stored screening score would describe bytes nobody is being served.
  it('lets exactly one of two racing replacements win, and cleans up after the other', async () => {
    const [first, second] = await Promise.all([
      replace(DOC_ID, { html: '<h1>Four from A</h1>' }),
      replace(DOC_ID, { html: '<h1>Four from B</h1>' }),
    ]);

    const statuses = [first?.status, second?.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Both uploaded, to different keys, and the loser's object is deleted at
    // the moment it is known to belong to nothing.
    expect(db.uploads).toHaveLength(2);
    expect(db.uploads[0]?.key).not.toBe(db.uploads[1]?.key);
    expect(db.deletes).toHaveLength(1);

    // The document moved exactly one version, and it points at the object that
    // was not deleted.
    const document = db.documents[0];
    expect(document?.['current_version']).toBe(4);
    expect(db.deletes).not.toContain(document?.['r2_key']);
    expect(db.uploads.map((upload) => upload.key)).toContain(document?.['r2_key']);

    // One winner, one history row.
    expect(db.inserts.filter((insert) => insert.table === 'document_versions')).toHaveLength(1);
    expect(db.events.map((event) => event.event)).toEqual(['document.replaced']);
  });

  it('answers the loser with a 409 that says nothing was replaced', async () => {
    const [first, second] = await Promise.all([
      replace(DOC_ID, { html: '<h1>Four from A</h1>' }),
      replace(DOC_ID, { html: '<h1>Four from B</h1>' }),
    ]);
    const loser = first?.status === 409 ? first : second;
    expect(loser?.body).toEqual({
      error: 'conflict',
      message:
        'This document changed while the replacement was being uploaded, so nothing was ' +
        'replaced. Read the current version before trying again.',
    });
  });

  // The same condition covers a delete that lands while the bytes are on their
  // way up: the row the swap is looking for is no longer there.
  it('refuses to replace a document that was deleted mid-upload', async () => {
    const document = db.documents[0];
    // The delete lands after the read at the top of the call and before the
    // swap at the end of it.
    db.onUpload = () => {
      if (document) document['deleted_at'] = '2026-08-31T10:00:00Z';
    };

    const res = await replace(DOC_ID, { html: '<h1>Four</h1>' });
    expect(res.status).toBe(409);
    expect(document?.['current_version']).toBe(3);
    expect(db.deletes).toHaveLength(1);
    expect(db.inserts).toEqual([]);
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
