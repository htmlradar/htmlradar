import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('./r2', () => ({
  r2Key: (owner: string, id: string) => `${owner}/${id}`,
  uploadHtml: vi.fn(async () => {}),
}));
vi.mock('./events', () => ({ captureServerEvent: vi.fn(async () => {}) }));
import { createDocumentForUser } from './create-document';
import { uploadHtml } from './r2';
import { captureServerEvent } from './events';

const rows = new Map<string, Record<string, unknown>>();
const source = {
  type: 'upload' as const,
  bytes: new TextEncoder().encode('<h2>Deck</h2>'),
  filename: 'deck.html',
};
const creationId = '00000000-0000-4000-8000-000000000001';
const supabase = {
  from(table: string) {
    return {
      insert: async (row: Record<string, unknown>) => {
        if (table !== 'documents') return { error: null };
        const key = `${row.owner_id}/${row.client_creation_id}`;
        if (rows.has(key)) return { error: { code: '23505' } };
        rows.set(key, row);
        return { error: null };
      },
      select: () => ({
        eq: (_: string, owner: string) => ({
          eq: (_: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.get(`${owner}/${id}`), error: null }),
          }),
        }),
      }),
      update: (changes: Record<string, unknown>) => ({
        eq: (_: string, id: string) => ({
          eq: async (_: string, owner: string) => {
            const row = [...rows.values()].find((r) => r.id === id && r.owner_id === owner);
            Object.assign(row!, changes);
            return { error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_: string, id: string) => {
          for (const [key, row] of rows) if (row.id === id) rows.delete(key);
          return { error: null };
        },
      }),
    };
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  rows.clear();
  vi.mocked(captureServerEvent).mockClear();
  vi.mocked(uploadHtml).mockClear();
});
describe('owner-scoped document creation identifiers', () => {
  it('returns the same completed document after a lost response without re-uploading', async () => {
    const first = await createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId);
    const retry = await createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId);
    expect(retry).toBe(first);
    expect(rows.size).toBe(1);
    expect(uploadHtml).toHaveBeenCalledOnce();
    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      event: 'document.created',
      distinctId: 'owner-a',
      userId: 'owner-a',
      properties: { source_type: 'upload', doc_id: first },
    });
  });
  it('does not return success for another request still uploading', async () => {
    let finish!: () => void;
    vi.mocked(uploadHtml).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(
      createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId),
    ).rejects.toThrow('Upload not confirmed');
    expect(uploadHtml).toHaveBeenCalledOnce();
    finish();
    const id = await first;
    expect(await createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId)).toBe(id);
  });
  it('scopes identifiers to the owner', async () => {
    const a = await createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId);
    const b = await createDocumentForUser(supabase, 'owner-b', 'Deck', source, creationId);
    expect(a).not.toBe(b);
    expect(rows.size).toBe(2);
  });
  it('rolls back a failed upload and allows a deliberate retry with the same identifier', async () => {
    vi.mocked(uploadHtml).mockRejectedValueOnce(new Error('Storage failure'));
    await expect(
      createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId),
    ).rejects.toThrow('Storage failure');
    expect(rows.size).toBe(0);
    await createDocumentForUser(supabase, 'owner-a', 'Deck', source, creationId);
    expect(rows.size).toBe(1);
  });
  it('rejects a malformed creation identifier before writing', async () => {
    await expect(
      createDocumentForUser(supabase, 'owner-a', 'Deck', source, 'not-a-uuid'),
    ).rejects.toThrow('Invalid creation identifier');
    expect(rows.size).toBe(0);
  });
});
