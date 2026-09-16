import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { uploadStagedFile } from './staged-handoff';
import {
  canResume,
  clearStagedFile,
  readStagedFile,
  reserveStagedFile,
  stageFile,
  STAGE_MAX_AGE_MS,
  type StagedFile,
} from './staged-file';

const file = (): StagedFile => ({
  name: 'deck.html',
  type: 'text/html',
  contents: '<h2>Deck</h2>',
  stagedAt: Date.now(),
  token: crypto.randomUUID(),
  creationId: crypto.randomUUID(),
  path: '/convert',
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('atomic staged hand-off', () => {
  it('allows only one of two tab reservations, and retains the file', async () => {
    const original = file();
    await stageFile(original);
    const results = await Promise.all([
      reserveStagedFile(original.token),
      reserveStagedFile(original.token),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const reserved = results.find(Boolean)!;
    expect(reserved.creationId).toBe(original.creationId);
    expect(reserved.token).not.toBe(original.token);
    expect(await readStagedFile()).toEqual(reserved);
  });

  it('expires and removes a file on access without authorizing upload', async () => {
    const original = file();
    await stageFile(original);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(original.stagedAt + STAGE_MAX_AGE_MS + 1);
    expect(await reserveStagedFile(original.token)).toBeNull();
    vi.setSystemTime(original.stagedAt);
    expect(await readStagedFile()).toBeNull();
  });

  it('a refresh or old resume URL cannot replay a consumed reservation', async () => {
    const original = file();
    await stageFile(original);
    const action = vi.fn(async () => ({ ok: false as const, reason: 'upload_failed' as const }));
    await uploadStagedFile(original.token, action);
    const restored = await readStagedFile();
    expect(restored?.contents).toBe(original.contents);
    expect(restored?.reserved).toBe(true);
    expect(canResume(restored, original.token)).toBe(false);
    expect(canResume(restored, null)).toBe(false);
    expect(await uploadStagedFile(original.token, action)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it('retains one creation identifier after a lost response and only retries on request', async () => {
    const original = file();
    await stageFile(original);
    const documents = new Map<string, string>();
    const action = vi.fn(async (form: FormData) => {
      const id = String(form.get('creation_id'));
      if (!documents.has(id)) {
        documents.set(id, crypto.randomUUID());
        throw new Error('Response lost after successful creation');
      }
      return { ok: true as const, documentId: documents.get(id)! };
    });
    expect(await uploadStagedFile(original.token, action)).toEqual({
      ok: false,
      reason: 'upload_failed',
    });
    const retained = await readStagedFile();
    expect(retained?.contents).toBe(original.contents);
    expect(action).toHaveBeenCalledOnce();
    const retry = await uploadStagedFile(retained!.token, action);
    expect(retry).toEqual({ ok: true, documentId: documents.get(original.creationId!) });
    expect(documents.size).toBe(1);
    expect(await readStagedFile()).toBeNull();
  });

  it('waits for commit: a transaction aborted after put succeeds never uploads', async () => {
    const original = file();
    await stageFile(original);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    const action = vi.fn();
    expect(await uploadStagedFile(original.token, action)).toEqual({
      ok: false,
      reason: 'storage',
    });
    expect(action).not.toHaveBeenCalled();
    expect((await readStagedFile())?.token).toBe(original.token);
  });

  it('never clears a replacement when an old response or discard arrives', async () => {
    const original = file();
    const replacement = file();
    await stageFile(original);
    const result = await uploadStagedFile(original.token, async () => {
      await stageFile(replacement);
      return { ok: true, documentId: 'document-1' };
    });
    expect(result.ok).toBe(true);
    await clearStagedFile(original.token);
    expect(await readStagedFile()).toEqual(replacement);
  });

  it('does not upload after a panel replacement during reservation', async () => {
    const original = file();
    await stageFile(original);
    const action = vi.fn();
    expect(
      await uploadStagedFile(
        original.token,
        action,
        () => {},
        () => false,
      ),
    ).toEqual({ ok: false, reason: 'cancelled' });
    expect(action).not.toHaveBeenCalled();
  });

  it('returns a structured storage failure and rejects mismatched tokens', async () => {
    const original = file();
    await stageFile(original);
    expect(await reserveStagedFile('wrong-token')).toBeNull();
    expect(await readStagedFile()).toEqual(original);
    vi.stubGlobal('indexedDB', undefined);
    expect(await uploadStagedFile(original.token, vi.fn())).toEqual({
      ok: false,
      reason: 'storage',
    });
  });
});
