import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  create: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@/lib/supabase-server', () => ({
  serverClient: () => ({ auth: { getUser: mocks.getUser } }),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/create-document', () => ({
  createDocumentForUser: mocks.create,
  MAX_UPLOAD_BYTES: 30 * 1024 * 1024,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn() }));
import { captureServerEvent } from '@/lib/events';
import { createStagedDocument } from './actions';
const id = '00000000-0000-4000-8000-000000000001';
function form() {
  const result = new FormData();
  result.set('creation_id', id);
  result.set('title', 'Deck');
  result.set('file', new File(['<h2>Deck</h2>'], 'deck.html', { type: 'text/html' }));
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner-a' } } });
  mocks.create.mockResolvedValue('document-1');
});
it('returns the document without a redirect and forwards the authenticated owner and creation id', async () => {
  expect(await createStagedDocument(form())).toEqual({ ok: true, documentId: 'document-1' });
  expect(mocks.create).toHaveBeenCalledWith(
    expect.anything(),
    'owner-a',
    'Deck',
    expect.objectContaining({ type: 'upload', filename: 'deck.html' }),
    id,
  );
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it('returns structured authentication, validation and uncertain-upload failures', async () => {
  const invalid = form();
  invalid.set('creation_id', 'bad');
  expect(await createStagedDocument(invalid)).toEqual({ ok: false, reason: 'invalid_file' });
  mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
  expect(await createStagedDocument(form())).toEqual({ ok: false, reason: 'auth' });
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.create.mockRejectedValueOnce(new Error('Sensitive filename and PDF text'));
  expect(await createStagedDocument(form())).toEqual({ ok: false, reason: 'upload_failed' });
  expect(vi.mocked(captureServerEvent).mock.calls).toEqual([
    [
      {
        event: 'document.upload_failed',
        distinctId: 'owner-a',
        userId: 'owner-a',
        properties: { source_type: 'upload', reason: 'invalid_file' },
      },
    ],
    [
      {
        event: 'document.upload_failed',
        distinctId: 'owner-a',
        userId: 'owner-a',
        properties: { source_type: 'upload', reason: 'upload_failed' },
      },
    ],
  ]);
});
it('rejects a wrong format or oversized HTML before reading or creating', async () => {
  const invalid = form();
  invalid.set('file', new File(['pdf'], 'deck.pdf', { type: 'application/pdf' }));
  expect(await createStagedDocument(invalid)).toEqual({ ok: false, reason: 'invalid_file' });
  const huge = form();
  huge.set('file', new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'deck.html'));
  expect(await createStagedDocument(huge)).toEqual({ ok: false, reason: 'invalid_file' });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('accepts converter HTML at 20 MiB through the browser action above the separate API cap', async () => {
  const large = form();
  large.set(
    'file',
    new File(
      ['<!doctype html><html><body><!--'.padEnd(20 * 1024 * 1024 - 17, ' ') + '--></body></html>'],
      'deck.html',
      { type: 'text/html' },
    ),
  );
  expect(await createStagedDocument(large)).toEqual({ ok: true, documentId: 'document-1' });
  expect(mocks.create.mock.calls[0]![3].bytes.byteLength).toBe(20 * 1024 * 1024);
});
