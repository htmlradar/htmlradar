// Staging for the /tools upload flow.
//
// The tools pages let someone drop an HTML file BEFORE they sign in, so the
// file must never leave the browser until there is an account to attach it
// to (no anonymous server-side storage, ever). It waits here in IndexedDB
// across the OAuth round-trip and is read back when the page reloads with
// `?resume=<token>`.
//
// One slot, one key: staging a second file replaces the first. There is no
// use for a queue.
//
// The token is what ties a resume load to the sign-in that started it. A
// visit with the wrong token (a crafted link, a refresh, a second tab) never
// creates anything, and the record is deleted before the document is created
// so a repeat load finds nothing.

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
  // Random, minted when the file is staged and echoed back in the resume URL.
  token: string;
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
  };
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

async function run<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = request(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function stageFile(file: StagedFile): Promise<IDBValidKey> {
  return run('readwrite', (store) => store.put(file, KEY));
}

export function clearStagedFile(): Promise<undefined> {
  return run('readwrite', (store) => store.delete(KEY));
}

export async function readStagedFile(): Promise<StagedFile | null> {
  const row = await run<unknown>('readonly', (store) => store.get(KEY));
  if (row === undefined) return null;
  const valid = validateStagedFile(row);
  // Present but expired or malformed: drop it rather than leave it to be
  // re-read on every future visit.
  if (!valid) {
    await clearStagedFile();
    return null;
  }
  return valid;
}
