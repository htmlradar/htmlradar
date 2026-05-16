'use client';

// Interactive form for the /new page. Client-side validation for file
// size + type + URL format — server still revalidates (defense in
// depth), but failing fast in the browser saves the user from
// uploading a 28 MB file over slow 3G only to be rejected.
//
// The mode toggle is real radio state under the hood (carried via a
// hidden input), so server reads it from formData consistently.

import { useRef, useState, useTransition } from 'react';
import { AlertCircle, ArrowRight, FileText, Link2, Upload } from 'lucide-react';
import { cn } from '@/lib/cn';

type Mode = 'upload' | 'url';

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const HTML_MIME_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/x-html',
  '', // some browsers omit the MIME for .html files
]);

interface NewDocumentFormProps {
  action: (formData: FormData) => Promise<void>;
}

export function NewDocumentForm({ action }: NewDocumentFormProps) {
  const [mode, setMode] = useState<Mode>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  // Track in-flight submission so the button shows "Uploading…" / "Saving…"
  // and ignores second clicks. Without this a user on slow 3G can click
  // upload, see no visible response for 10 seconds, click again, and end
  // up with two documents (and two R2 uploads worth of bandwidth).
  const [isPending, startTransition] = useTransition();

  const canSubmit =
    !isPending &&
    (mode === 'upload'
      ? fileName !== null && fileError === null
      : urlValue.trim().length > 0 && urlError === null);

  const validateUrl = (v: string): string | null => {
    const trimmed = v.trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) {
      return 'URL must start with http:// or https://';
    }
    try {
      const u = new URL(trimmed);
      if (!u.hostname.includes('.')) {
        return "That doesn't look like a valid hostname.";
      }
    } catch {
      return 'Not a valid URL.';
    }
    return null;
  };

  return (
    <form
      action={(fd) => startTransition(() => action(fd))}
      className="space-y-8 rounded-2xl border border-line bg-paper p-8 shadow-[0_18px_40px_-30px_rgba(31,17,8,0.18)] md:p-10"
    >
      <div>
        <label
          htmlFor="title"
          className="block font-mono text-[11px] uppercase tracking-[0.16em] text-graphite"
        >
          Title
        </label>
        <input
          id="title"
          name="title"
          placeholder="Q2 Investor Brief"
          required
          maxLength={120}
          className="mt-3 w-full rounded-md border border-line bg-paper px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
        />
      </div>

      <div>
        <label className="block font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Source
        </label>

        <div className="relative mt-3 grid grid-cols-2 gap-1 rounded-lg border border-line bg-paper-2/40 p-1">
          <SegmentButton
            label="Upload HTML"
            icon={<Upload className="size-3.5" />}
            active={mode === 'upload'}
            onClick={() => setMode('upload')}
          />
          <SegmentButton
            label="Use a URL"
            icon={<Link2 className="size-3.5" />}
            active={mode === 'url'}
            onClick={() => setMode('url')}
          />
        </div>

        <input type="hidden" name="source_type" value={mode} />

        <div className="mt-6">
          {mode === 'upload' ? (
            <UploadPanel
              fileName={fileName}
              fileError={fileError}
              onFileChange={(file) => {
                if (!file) {
                  setFileName(null);
                  setFileError(null);
                  return;
                }
                if (file.size > MAX_UPLOAD_BYTES) {
                  setFileName(file.name);
                  setFileError(
                    `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 30 MB.`,
                  );
                  return;
                }
                if (!HTML_MIME_TYPES.has(file.type) && !/\.html?$/i.test(file.name)) {
                  setFileName(file.name);
                  setFileError(
                    'Only single-file HTML uploads are supported. Rename it to .html if you already exported.',
                  );
                  return;
                }
                setFileName(file.name);
                setFileError(null);
              }}
            />
          ) : (
            <UrlPanel
              value={urlValue}
              error={urlError}
              onValueChange={(v) => {
                setUrlValue(v);
                setUrlError(validateUrl(v));
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-signal"
        >
          {isPending ? (mode === 'upload' ? 'Uploading…' : 'Saving…') : 'Create document'}
          {!isPending && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />}
        </button>
        {isPending && (
          <p className="text-[13px] text-graphite">
            {mode === 'upload'
              ? 'Uploading and creating the document — usually a few seconds.'
              : 'Saving the URL — usually a few seconds.'}
          </p>
        )}
        {!isPending && !canSubmit && fileError === null && urlError === null && (
          <p className="text-[13px] text-graphite">
            {mode === 'upload' ? 'Pick an HTML file first.' : 'Paste a URL first.'}
          </p>
        )}
      </div>
    </form>
  );
}

function SegmentButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13.5px] font-medium transition',
        active
          ? 'bg-paper text-ink shadow-[0_1px_0_rgba(31,17,8,0.08)]'
          : 'text-graphite hover:text-ink',
      )}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

function UploadPanel({
  fileName,
  fileError,
  onFileChange,
}: {
  fileName: string | null;
  fileError: string | null;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const openPicker = () => inputRef.current?.click();
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const onDragLeave = () => setIsDragOver(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // Mirror the file picker's onChange by attaching the file to the
    // hidden input so the form submission includes it.
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
    onFileChange(file);
  };

  const hasError = !!fileError;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose an HTML file to upload"
        onClick={openPicker}
        onKeyDown={onKey}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-paper-2/40 px-6 py-10 text-center outline-none transition hover:bg-paper-2/70 focus-visible:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]',
          hasError
            ? 'border-alert/60'
            : isDragOver
              ? 'border-signal bg-signal/[0.04]'
              : 'border-line hover:border-signal focus-visible:border-signal',
        )}
      >
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full transition group-hover:bg-signal/15',
            hasError ? 'bg-alert/15 text-alert' : 'bg-paper-3 text-signal-dark',
          )}
        >
          <FileText aria-hidden className="size-4" />
        </span>
        {fileName ? (
          <>
            <span className="text-[14px] font-medium text-ink">{fileName}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              {hasError ? 'Pick a different file' : 'Click to replace'}
            </span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-medium text-ink">
              {isDragOver ? 'Drop the file here' : 'Click to browse for an HTML file'}
            </span>
            <span className="text-[12.5px] text-graphite">
              Or drag and drop here. Single-file HTML, up to 30 MB.
            </span>
          </>
        )}
        <input
          ref={inputRef}
          id="file"
          name="file"
          type="file"
          accept=".html,.htm,text/html"
          required
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            onFileChange(f ?? null);
          }}
        />
      </div>
      {fileError && (
        <p className="mt-3 inline-flex items-start gap-2 text-[13px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {fileError}
        </p>
      )}
    </>
  );
}

function UrlPanel({
  value,
  error,
  onValueChange,
}: {
  value: string;
  error: string | null;
  onValueChange: (v: string) => void;
}) {
  return (
    <div>
      <input
        name="source_url"
        type="url"
        required
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="https://yourdomain.com/deck.html"
        className={cn(
          'w-full rounded-md border bg-paper px-4 py-3 font-mono text-[14px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]',
          error ? 'border-alert/60 focus:border-alert' : 'border-line focus:border-signal',
        )}
      />
      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 text-[13px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-graphite">
          HTMLRadar fetches from this URL on each view. Useful if you host on GitHub Pages, Vercel,
          S3, or your own server.
        </p>
      )}
    </div>
  );
}
