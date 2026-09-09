'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearStagedFile,
  readStagedFile,
  reserveStagedFile,
  releaseStagedReservation,
  stageFile,
  MAX_STAGED_BYTES,
  type StagedFile,
} from './staged-file';

export const HANDOFF_MESSAGES = {
  uncertain: 'We couldn’t confirm the upload; check Documents before uploading again.',
  missing: 'The saved file is no longer available; check Documents, or choose the PDF again.',
  storage:
    'This browser couldn’t keep the file for sign-in; download the HTML, then sign in and upload it.',
} as const;

export type HandoffUploadResult =
  | { ok: true; documentId: string }
  | { ok: false; reason: 'auth' | 'invalid_file' | 'upload_failed' };
export type HandoffAction = (formData: FormData) => Promise<HandoffUploadResult>;
export type HandoffResult =
  | HandoffUploadResult
  | { ok: false; reason: 'missing' | 'storage' | 'cancelled' };

// Shared by both panels and tested independently of React. Nothing can reach
// the server until the token-checked reservation transaction has committed.
export async function uploadStagedFile(
  token: string,
  action: HandoffAction,
  onReserved: (file: StagedFile) => void = () => {},
  isCurrent: () => boolean = () => true,
): Promise<HandoffResult> {
  let file: StagedFile | null;
  try {
    file = await reserveStagedFile(token);
  } catch {
    return { ok: false, reason: 'storage' };
  }
  if (!file) return { ok: false, reason: 'missing' };
  if (!isCurrent()) return { ok: false, reason: 'cancelled' };
  onReserved(file);
  const form = new FormData();
  form.set('source_type', 'upload');
  form.set('creation_id', file.creationId!);
  form.set(
    'title',
    file.name
      .replace(/\.html?$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .slice(0, 120) || 'Untitled document',
  );
  form.set('file', new File([file.contents], file.name, { type: 'text/html' }));
  let result: HandoffUploadResult;
  try {
    result = await action(form);
  } catch {
    return { ok: false, reason: 'upload_failed' };
  }
  if (result.ok) {
    // A replacement belongs to a different attempt and must survive this
    // older upload's completion. A cleanup failure cannot undo server success.
    await clearStagedFile(file.token).catch(() => undefined);
  }
  return result;
}

export function useStagedHandoff({
  path,
  action,
  resumeToken,
  signedIn,
}: {
  path: string;
  action?: HandoffAction | undefined;
  resumeToken?: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<StagedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const current = useRef<StagedFile | null>(null);
  const stored = useRef(false);
  const revision = useRef(0);
  const locked = useRef(false);
  const resumeAttempted = useRef(false);

  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );

  const remember = useCallback((record: StagedFile) => {
    current.current = record;
    setFile(record);
  }, []);

  const upload = useCallback(
    async (record: StagedFile, generation: number) => {
      if (!action) return;
      const isCurrent = () => revision.current === generation;
      const result = await uploadStagedFile(record.token, action, remember, isCurrent);
      if (!isCurrent()) return;
      locked.current = false;
      setBusy(false);
      if (result.ok) {
        current.current = null;
        router.push(`/docs/${encodeURIComponent(result.documentId)}`);
      } else if (result.reason === 'auth' && current.current) {
        locked.current = true;
        setBusy(true);
        // Authentication failed before creation. Preserve the same creation id
        // and authorize only this file's sign-in round-trip.
        const ready = await releaseStagedReservation(current.current.token).catch(() => null);
        if (!isCurrent()) return;
        locked.current = false;
        setBusy(false);
        if (!ready) {
          setMessage(HANDOFF_MESSAGES.storage);
          return;
        }
        remember(ready);
        router.push(`/sign-in?next=${encodeURIComponent(`${path}?resume=${ready.token}`)}`);
      } else {
        setMessage(
          result.reason === 'storage'
            ? HANDOFF_MESSAGES.storage
            : result.reason === 'missing'
              ? HANDOFF_MESSAGES.missing
              : HANDOFF_MESSAGES.uncertain,
        );
      }
    },
    [action, path, remember, router],
  );

  useEffect(() => {
    let cancelled = false;
    const generation = revision.current;
    void readStagedFile()
      .then(async (waiting) => {
        if (cancelled || generation !== revision.current) return;
        if (!waiting || (waiting.path && waiting.path !== path)) {
          if (resumeToken) setMessage(HANDOFF_MESSAGES.missing);
          return;
        }
        // Older tool records without a path are never restored by /convert.
        if (path === '/convert' && waiting.path !== path) {
          if (resumeToken) setMessage(HANDOFF_MESSAGES.missing);
          return;
        }
        remember(waiting);
        stored.current = true;
        setRestored(true);
        if (waiting.reserved) {
          setMessage(HANDOFF_MESSAGES.uncertain);
          return;
        }
        if (!resumeToken) return; // A plain visit only restores the preview.
        if (waiting.token !== resumeToken) {
          setMessage(HANDOFF_MESSAGES.missing);
          return;
        }
        if (!signedIn || !action || resumeAttempted.current) return;
        resumeAttempted.current = true;
        locked.current = true;
        setBusy(true);
        await upload(waiting, generation);
      })
      .catch(() => {
        if (!cancelled && generation === revision.current && resumeToken)
          setMessage(HANDOFF_MESSAGES.storage);
      });
    return () => {
      cancelled = true;
    };
  }, [action, path, remember, resumeToken, signedIn, upload]);

  // Invalidate synchronously, before reading a replacement's contents. Late
  // reads, worker callbacks and old upload responses cannot restore old UI.
  const replaceFile = useCallback(
    async (next: File | null) => {
      const generation = ++revision.current;
      const previous = current.current;
      current.current = null;
      stored.current = false;
      locked.current = false;
      setBusy(false);
      setFile(null);
      setMessage(null);
      setRestored(false);
      if (previous) void clearStagedFile(previous.token).catch(() => undefined);
      if (!next) return;
      if (next.size > MAX_STAGED_BYTES) throw new Error('File exceeds 30 MB');
      let contents: string;
      try {
        contents = await next.text();
      } catch (error) {
        if (generation === revision.current) throw error;
        return;
      }
      if (generation !== revision.current) return;
      remember({
        name: next.name,
        type: 'text/html',
        contents,
        stagedAt: Date.now(),
        token: crypto.randomUUID(),
        creationId: crypto.randomUUID(),
        path,
      });
    },
    [path, remember],
  );

  const start = async () => {
    const record = current.current;
    if (!record || !action || locked.current) return;
    const generation = revision.current;
    locked.current = true;
    setBusy(true);
    setMessage(null);
    if (!stored.current) {
      try {
        await stageFile(record);
      } catch {
        if (generation === revision.current) {
          locked.current = false;
          setBusy(false);
          setMessage(HANDOFF_MESSAGES.storage);
        }
        return;
      }
      if (generation !== revision.current) {
        await clearStagedFile(record.token).catch(() => undefined);
        return;
      }
      stored.current = true;
    }
    if (signedIn) await upload(record, generation);
    else {
      router.push(`/sign-in?next=${encodeURIComponent(`${path}?resume=${record.token}`)}`);
      locked.current = false;
      setBusy(false);
    }
  };

  return { file, busy, message, restored, replaceFile, start };
}
