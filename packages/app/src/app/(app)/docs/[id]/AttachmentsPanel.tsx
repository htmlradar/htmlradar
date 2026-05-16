'use client';

// Supporting materials panel on /docs/[id]. Visually demoted vs the main
// HTML deck (smaller header, paper-2 background) so the deck stays the
// page's identity. The mental model the user (Abhinandan) is solving for:
// "HTML deck is the cover; attachments are supplementary."
//
// Sender-side only. Recipient view comes via the proxy's injected
// materials footer (when allow_download is true on their share).

import { useRef, useState, useTransition } from 'react';
import {
  FileText,
  FileSpreadsheet,
  FileArchive,
  FileImage,
  File as FileGeneric,
  Trash2,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_DOC,
  MAX_TOTAL_BYTES_PER_DOC,
  formatBytes,
  getExtension,
  validateFile,
  isValidationError,
} from '@/lib/attachments';

export interface AttachmentRow {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface AttachmentsPanelProps {
  documentId: string;
  attachments: AttachmentRow[];
  uploadAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}

const ACCEPT_ATTR = Object.keys(ALLOWED_EXTENSIONS).join(',');

// One canonical icon per family. Lucide doesn't ship dedicated mime icons,
// so we map by extension. Unknown → generic File.
function iconFor(mime: string, filename: string): typeof FileText {
  const ext = getExtension(filename);
  if (mime.startsWith('image/')) return FileImage;
  if (ext === '.zip') return FileArchive;
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return FileSpreadsheet;
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.md', '.rtf'].includes(ext))
    return FileText;
  return FileGeneric;
}

export function AttachmentsPanel({
  documentId,
  attachments,
  uploadAction,
  deleteAction,
}: AttachmentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);

  const existingCount = attachments.length;
  const existingBytes = attachments.reduce((acc, a) => acc + a.size_bytes, 0);

  // Client-side validation gate. The server re-validates everything,
  // so even if a user bypasses this with devtools they hit the same
  // checks again — this is purely a UX courtesy to avoid uploading a
  // doomed file.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (existingCount + files.length > MAX_ATTACHMENTS_PER_DOC) {
      setClientError(
        `Limit ${MAX_ATTACHMENTS_PER_DOC} files per document — you have ${existingCount}.`,
      );
      e.target.value = '';
      return;
    }

    let addedBytes = 0;
    for (const f of files) {
      const v = validateFile(f);
      if (isValidationError(v)) {
        setClientError(`${v.filename}: ${v.reason}`);
        e.target.value = '';
        return;
      }
      addedBytes += v.size;
    }
    if (existingBytes + addedBytes > MAX_TOTAL_BYTES_PER_DOC) {
      setClientError(`Total size would exceed ${formatBytes(MAX_TOTAL_BYTES_PER_DOC)}.`);
      e.target.value = '';
      return;
    }

    // Validation OK — submit the form programmatically.
    setClientError(null);
    const form = e.target.form;
    if (form) {
      startTransition(() => {
        form.requestSubmit();
      });
    }
  };

  return (
    <section
      aria-label="Supporting materials"
      className="rounded-2xl border border-line bg-paper-2/30 p-5 md:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">
            Supporting materials
          </h2>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
            Optional files recipients can download (PDFs, financial models, images, ZIPs). The HTML
            deck stays the primary tracked artefact — these are supplementary.{' '}
            <strong className="font-medium text-ink-soft">
              Downloads are off by default per share.
            </strong>{' '}
            Toggle &quot;Allow downloads&quot; on a share to share them.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite">
          {existingCount}/{MAX_ATTACHMENTS_PER_DOC} · {formatBytes(existingBytes)}/
          {formatBytes(MAX_TOTAL_BYTES_PER_DOC)}
        </span>
      </header>

      {attachments.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {attachments.map((a) => {
            const Icon = iconFor(a.mime_type, a.filename);
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Icon aria-hidden className="size-4 shrink-0 text-graphite" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-ink">{a.filename}</div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                    {formatBytes(a.size_bytes)} ·{' '}
                    {getExtension(a.filename).replace('.', '') || 'file'}
                  </div>
                </div>
                <form action={deleteAction} className="shrink-0">
                  <input type="hidden" name="attachment_id" value={a.id} />
                  <input type="hidden" name="document_id" value={documentId} />
                  <button
                    type="submit"
                    aria-label={`Delete ${a.filename}`}
                    className="inline-flex size-7 items-center justify-center rounded-md text-graphite transition hover:bg-paper-3/50 hover:text-alert"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <form
        action={uploadAction}
        encType="multipart/form-data"
        className={cn('mt-4 flex flex-wrap items-center gap-3', isPending && 'opacity-60')}
      >
        <input type="hidden" name="document_id" value={documentId} />
        <input
          ref={fileInputRef}
          type="file"
          name="files"
          multiple
          accept={ACCEPT_ATTR}
          onChange={handleFileChange}
          className="hidden"
          disabled={isPending}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending || existingCount >= MAX_ATTACHMENTS_PER_DOC}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-paper px-4 py-2 text-[13.5px] font-medium text-ink transition hover:border-signal hover:text-signal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload aria-hidden className="size-3.5" />
          {isPending ? 'Uploading…' : 'Add files'}
        </button>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
          Up to {formatBytes(MAX_ATTACHMENT_BYTES)} each · PDF, Office, images, CSV, MD, ZIP
        </span>
      </form>

      {clientError && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-alert/40 bg-alert/5 px-3 py-2 text-[13px] leading-snug text-alert"
        >
          {clientError}
        </p>
      )}
    </section>
  );
}
