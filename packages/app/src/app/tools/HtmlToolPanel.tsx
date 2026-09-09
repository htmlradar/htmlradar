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

import { useCallback, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, Printer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { captureClientEvent } from '@/lib/events-client';
import { HTML_ACCEPT, isHtmlFile } from '@/lib/html-source';
import { MAX_STAGED_BYTES } from '@/lib/staged-file';
import { useStagedHandoff, type HandoffAction } from '@/lib/staged-handoff';

export function HtmlToolPanel({
  tool,
  action,
  resumeToken = null,
  signedIn = false,
}: {
  // Which tool page this instance is on. Sent with the analytics events; no
  // file name or file content is ever included in a payload.
  tool: string;
  action?: HandoffAction;
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
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handoff = useStagedHandoff({ path: `/tools/${tool}`, action, resumeToken, signedIn });
  const { file: staged, busy, restored, replaceFile } = handoff;
  const [error, setError] = useState<string | null>(null);
  const [pdfRejected, setPdfRejected] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const isPdfMode = !action;

  const accept = useCallback(
    async (file: File | null) => {
      if (!file || busy) return;
      setError(null);
      setPdfRejected(false);
      if (file.size > MAX_STAGED_BYTES) {
        await replaceFile(null);
        setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 30 MB.`);
        return;
      }
      if (!isHtmlFile(file.name, file.type)) {
        await replaceFile(null);
        setPdfRejected(/\.pdf$/i.test(file.name) || file.type === 'application/pdf');
        setError('Only single-file HTML works here. Rename your export to .html and try again.');
        return;
      }
      try {
        await replaceFile(file);
      } catch {
        setError('We couldn’t read this file. Choose it again.');
      }
    },
    [busy, replaceFile],
  );

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
          onChange={(e) => {
            void accept(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>

      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 text-[13px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {pdfRejected ? (
        <p className="mt-3 text-[13px] text-signal-dark">
          <a href="/convert" className="underline underline-offset-4">
            Have a PDF? Turn it into a web page first.
          </a>
        </p>
      ) : null}
      {handoff.message ? (
        <p role="alert" className="mt-3 text-[13px] text-alert">
          {handoff.message}
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
                onClick={() => {
                  void captureClientEvent('tools.file_staged', { tool });
                  void handoff.start();
                }}
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
                : !signedIn && restored
                  ? 'Your file is still here. Sign in and it becomes a tracked link.'
                  : 'Your file uploads only after you sign in. First 2 tracked links are free.'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
