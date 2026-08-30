'use client';

// The interactive half of every /tools page. One component, two modes:
//
//   action supplied  → "link" mode. The file is staged in IndexedDB, the
//                      person signs in, and on return the SAME server action
//                      the /new page uses creates the document.
//   action omitted   → "pdf" mode. Nothing is staged, nothing is uploaded;
//                      the browser's own print dialog writes the PDF.
//
// The file never reaches a server before there is a signed-in account to
// attach it to. That is the whole reason for the IndexedDB detour.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, FileText, Printer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { captureClientEvent } from '@/lib/events-client';
import { HTML_ACCEPT, isHtmlFile } from '@/lib/html-source';
import {
  canResume,
  clearStagedFile,
  readStagedFile,
  stageFile,
  MAX_STAGED_BYTES,
  type StagedFile,
} from '@/lib/staged-file';

// The document title createDocument requires, derived from the filename so
// nobody has to type one before they have seen the product work.
function titleFromFilename(name: string): string {
  const stem = name
    .replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 120);
  return stem || 'Untitled document';
}

export function HtmlToolPanel({
  tool,
  action,
  resumeToken = null,
  signedIn = false,
}: {
  // Which tool page this instance is on. Sent with the analytics events; no
  // file name or file content is ever included in a payload.
  tool: string;
  action?: (formData: FormData) => Promise<void>;
  // Both come from the server render, which already has the session cookie in
  // hand. Asking Supabase from the browser instead would put its whole client
  // in the bundle of three pages whose main job is to load fast for search
  // visitors who never sign in.
  //
  // resumeToken is the raw `?resume=` value. It has to match the token stored
  // with the file for anything to be created, so a crafted link, a refresh, or
  // a second tab lands on the staged file and its sign-in button instead.
  resumeToken?: string | null;
  signedIn?: boolean;
}) {
  const router = useRouter();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // Private-mode browsers and locked-down profiles can refuse IndexedDB.
  // There is no silent fallback that keeps the file off our servers, so we
  // say so plainly and send them to the signed-in upload page instead.
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const isPdfMode = !action;

  const accept = useCallback(async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_STAGED_BYTES) {
      setStaged(null);
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 30 MB.`);
      return;
    }
    if (!isHtmlFile(file.name, file.type)) {
      setStaged(null);
      setError('Only single-file HTML works here. Rename your export to .html and try again.');
      return;
    }
    setError(null);
    setStaged({
      name: file.name,
      type: file.type || 'text/html',
      contents: await file.text(),
      stagedAt: Date.now(),
      // Minted here and carried through sign-in in the `?resume=` value, so
      // only the round-trip this file started can turn it into a document.
      token: crypto.randomUUID(),
    });
  }, []);

  // Coming back from sign-in: pick the staged file up and create the document.
  useEffect(() => {
    const create = action;
    if (!create || !resumeToken) return;

    let cancelled = false;
    void (async () => {
      setBusy(true);
      let waiting: StagedFile | null = null;
      try {
        waiting = await readStagedFile();
      } catch {
        if (!cancelled) {
          setStorageBlocked(true);
          setBusy(false);
        }
        return;
      }
      if (cancelled) return;
      if (!waiting) {
        // Nothing staged, or it aged out after 24 hours. Fall back to the
        // ordinary empty state so they can drop the file again.
        setBusy(false);
        return;
      }
      setStaged(waiting);
      if (!canResume(waiting, resumeToken)) {
        // A crafted link, a refresh after the file was already created, or a
        // second tab. Show the file and its button; create nothing.
        setBusy(false);
        return;
      }
      if (!signedIn) {
        setNeedsSignIn(true);
        setBusy(false);
        return;
      }

      // Delete before create, and wait for it. Whatever happens next — a
      // redirect, a reload, a second tab opening the same URL — there is no
      // longer a record to create a second document from.
      try {
        await clearStagedFile();
      } catch {
        if (!cancelled) {
          setStorageBlocked(true);
          setBusy(false);
        }
        return;
      }

      void captureClientEvent('tools.resume_created', { tool });
      const formData = new FormData();
      formData.set('source_type', 'upload');
      formData.set('title', titleFromFilename(waiting.name));
      formData.set(
        'file',
        new File([waiting.contents], waiting.name, { type: waiting.type || 'text/html' }),
      );
      try {
        await create(formData);
      } catch {
        // Put it back so the button below can retry rather than making them
        // find the file again.
        await stageFile(waiting).catch(() => undefined);
        if (!cancelled) {
          setError('That upload did not go through. Try again, or upload it from the dashboard.');
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [action, resumeToken, signedIn, tool]);

  async function stageAndSignIn() {
    if (!staged) return;
    setBusy(true);
    const record = { ...staged, stagedAt: Date.now(), token: crypto.randomUUID() };
    try {
      await stageFile(record);
    } catch {
      setStorageBlocked(true);
      setBusy(false);
      return;
    }
    setStaged(record);
    void captureClientEvent('tools.file_staged', { tool });
    // Same-origin relative path only — /sign-in and /auth/callback both run it
    // through safeNext() before redirecting. The token is what makes the
    // return load create anything.
    const next = `${window.location.pathname}?resume=${record.token}`;
    router.push(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-[0_18px_40px_-30px_rgba(31,17,8,0.18)] md:p-8">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose an HTML file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          void accept(e.dataTransfer.files[0] ?? null);
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-paper-2/40 px-6 py-9 text-center outline-none transition hover:bg-paper-2/70 focus-visible:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]',
          error
            ? 'border-alert/60'
            : isDragOver
              ? 'border-signal bg-signal/[0.04]'
              : 'border-line hover:border-signal focus-visible:border-signal',
        )}
      >
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full transition group-hover:bg-signal/15',
            error ? 'bg-alert/15 text-alert' : 'bg-paper-3 text-signal-dark',
          )}
        >
          <FileText aria-hidden className="size-4" />
        </span>
        {staged ? (
          <>
            <span className="text-[14px] font-medium text-ink">{staged.name}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Click to replace
            </span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-medium text-ink">
              {isDragOver ? 'Drop the file here' : 'Drop an HTML file, or click to browse'}
            </span>
            <span className="text-[12.5px] text-graphite">
              Single-file .html or .htm, up to 30 MB.{' '}
              {isPdfMode
                ? 'The file is never uploaded to HTMLRadar.'
                : 'The file is not uploaded to HTMLRadar until you sign in.'}
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={HTML_ACCEPT}
          className="sr-only"
          onChange={(e) => void accept(e.target.files?.[0] ?? null)}
        />
      </div>

      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 text-[13px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {storageBlocked ? (
        <p className="mt-3 text-[13px] leading-relaxed text-alert">
          This browser will not let the page hold your file while you sign in. Sign in first, then
          upload the file on the{' '}
          <a href="/new" className="underline underline-offset-4">
            new document page
          </a>
          .
        </p>
      ) : null}

      {staged ? (
        <div className="mt-6">
          <iframe
            ref={frameRef}
            title="Preview of your HTML file"
            srcDoc={staged.contents}
            // No allow-scripts: nothing in the file executes. The PDF tool
            // also needs allow-modals, because a sandboxed document ignores
            // print() without it; that keeps scripts off and lets the
            // browser's print dialog open.
            sandbox={isPdfMode ? 'allow-same-origin allow-modals' : 'allow-same-origin'}
            className="h-[380px] w-full rounded-xl border border-line bg-white md:h-[460px]"
          />
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-graphite">
            Scripts, forms and navigation are blocked in this preview, so an interactive page shows
            its static layout. If the HTML references images, fonts or stylesheets on other
            websites, your browser fetches those to render the preview, exactly as it would on any
            web page.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            {isPdfMode ? (
              <button
                type="button"
                onClick={() => frameRef.current?.contentWindow?.print()}
                className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
              >
                <Printer aria-hidden className="size-4" />
                Save as PDF
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stageAndSignIn()}
                disabled={busy}
                className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-signal"
              >
                {busy ? 'Working…' : 'Get your tracked link'}
                {!busy && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />}
              </button>
            )}
            <p className="text-[13px] leading-relaxed text-graphite">
              {isPdfMode
                ? 'Opens your browser print dialog. Choose "Save as PDF" as the destination.'
                : needsSignIn
                  ? 'Your file is still here. Sign in and it becomes a tracked link.'
                  : 'Your file uploads only after you sign in. First 2 tracked links are free.'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
