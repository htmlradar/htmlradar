// One local file survives sign-in. A reservation rotates its token atomically,
// retaining the contents and creation identifier until success is confirmed.

const DB_NAME = 'htmlradar-tools';
const STORE = 'staged';
const KEY = 'file';

// Anything older than this is someone else's abandoned session (or a tab
// reopened days later); discard rather than upload a file they've forgotten.
export const STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Same ceiling the signed-in upload enforces (MAX_UPLOAD_BYTES in
// app/(app)/new/actions.ts). Accepting more here would only get the file
// rejected server-side after the sign-in round-trip.
export const MAX_STAGED_BYTES = 30 * 1024 * 1024;

export interface StagedFile {
  name: string;
  type: string;
  contents: string;
  stagedAt: number;
  // Authorizes one reservation. Echoed in the resume URL, then rotated on use.
  token: string;
  creationId?: string;
  reserved?: boolean;
  path?: string;
}

// Kept pure so the expiry rule is testable without a browser.
export function isStale(stagedAt: number, now: number = Date.now()): boolean {
  return now - stagedAt > STAGE_MAX_AGE_MS;
}

// IndexedDB hands back whatever was put in it, from any version of this code
// and from anything else running on the origin. Nothing downstream may assume
// the shape, so every field is checked before the record is used to build a
// File. Pure, for the same reason isStale is.
export function validateStagedFile(row: unknown, now: number = Date.now()): StagedFile | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.name !== 'string' || !/^.+\.html?$/i.test(r.name)) return null;
  if (typeof r.contents !== 'string') return null;
  if (typeof r.token !== 'string' || r.token === '') return null;
  if (typeof r.stagedAt !== 'number' || !Number.isFinite(r.stagedAt)) return null;
  if (isStale(r.stagedAt, now)) return null;
  if (new TextEncoder().encode(r.contents).byteLength > MAX_STAGED_BYTES) return null;
  return {
    name: r.name,
    type: typeof r.type === 'string' && r.type ? r.type : 'text/html',
    contents: r.contents,
    stagedAt: r.stagedAt,
    token: r.token,
    ...(typeof r.creationId === 'string' ? { creationId: r.creationId } : {}),
    ...(r.reserved === true ? { reserved: true } : {}),
    ...(typeof r.path === 'string' ? { path: r.path } : {}),
  };
}

// The panel's restore-on-mount question — "is there still a file to put back
// on screen?" — is this same rule, under the name of the caller that asks it.
export const restorableStagedFile = validateStagedFile;

// Which failures are ours to clean up. An expired record is: nobody is coming
// back for it. A record we simply don't recognise is not — throwing away
// someone's file because a field check we may have got wrong said no is worse
// than ignoring it and reading it again on the next visit.
export function shouldDiscardStagedRow(row: unknown, now: number = Date.now()): boolean {
  const stagedAt = (row as { stagedAt?: unknown } | null | undefined)?.stagedAt;
  return typeof stagedAt === 'number' && isStale(stagedAt, now);
}

// The resume rule, in one place: a staged file is only turned into a document
// when the URL carries the exact token that was minted when it was staged.
export function canResume(file: StagedFile | null, urlToken: string | null | undefined): boolean {
  return Boolean(file && urlToken && file.token === urlToken);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

// All decisions and writes happen synchronously inside one transaction. A
// request succeeding is not a commit: aborts can still happen afterwards.
async function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
    tx.onerror = () => {}; // The transaction's abort is the failure boundary.
    try {
      operation(tx.objectStore(STORE), (result) => {
        value = result;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}

export function stageFile(file: StagedFile): Promise<void> {
  const valid = validateStagedFile(file);
  if (!valid) return Promise.reject(new Error('Invalid staged file'));
  return run('readwrite', (store, result) => {
    store.put({ ...valid, creationId: valid.creationId ?? crypto.randomUUID() }, KEY);
    result(undefined);
  });
}

export function clearStagedFile(token: string): Promise<void> {
  return run('readwrite', (store, result) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      if (request.result?.token === token) store.delete(KEY);
      result(undefined);
    };
  });
}

export function readStagedFile(): Promise<StagedFile | null> {
  return run('readwrite', (store, result) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const row: unknown = request.result;
      if (shouldDiscardStagedRow(row)) store.delete(KEY);
      result(validateStagedFile(row));
    };
  });
}

export function reserveStagedFile(token: string): Promise<StagedFile | null> {
  return run('readwrite', (store, result) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const row: unknown = request.result;
      const file = validateStagedFile(row);
      if (shouldDiscardStagedRow(row)) store.delete(KEY);
      if (!canResume(file, token)) {
        result(null);
        return;
      }
      // Delete the matching authorization, not the file. Even an explicit
      // retry must present the current token; two tabs cannot both win.
      const reserved = {
        ...file!,
        token: crypto.randomUUID(),
        reserved: true,
        creationId: file!.creationId ?? crypto.randomUUID(),
      };
      store.put(reserved, KEY);
      result(reserved);
    };
  });
}

// Only an explicit server auth failure can re-arm a reservation for sign-in.
// An uncertain upload must stay consumed and can only be retried by a click.
export function releaseStagedReservation(token: string): Promise<StagedFile | null> {
  return run('readwrite', (store, result) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const file = validateStagedFile(request.result);
      if (shouldDiscardStagedRow(request.result)) store.delete(KEY);
      if (!file || file.token !== token) {
        result(null);
        return;
      }
      const ready = { ...file };
      delete ready.reserved;
      store.put(ready, KEY);
      result(ready);
    };
  });
}
