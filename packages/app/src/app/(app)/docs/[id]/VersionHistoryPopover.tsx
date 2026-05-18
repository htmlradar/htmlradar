'use client';

// Version-history popover triggered from the "v{n}" chip in the doc
// hero. Lists every saved upload/replace with original filename,
// timestamp, and size. The latest version is badged "Current" — the
// row that's actually being served to recipients.
//
// Origin: user ask 2026-05-19 — "I need a log somewhere of what upload
// I've actually got. What is the latest version's actual file name."
// Prior to schema 018 the documents.current_version int was bumped on
// replace but the prior filenames were thrown away.

import { useEffect, useRef, useState } from 'react';
import { Clock, FileText, Globe, X } from 'lucide-react';

export interface DocumentVersionRow {
  id: string;
  version: number;
  filename: string | null;
  bytes: number | null;
  source_type: 'upload' | 'url';
  source_url: string | null;
  replaced_at: string;
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function VersionHistoryPopover({
  currentVersion,
  versions,
}: {
  currentVersion: number;
  versions: DocumentVersionRow[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Sort newest first; the current version (max) bubbles to the top.
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const total = sorted.length;

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          total > 1 ? `${total} versions · click to see history` : 'Version history (click to view)'
        }
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite transition hover:border-signal/40 hover:text-signal-dark"
      >
        v{currentVersion}
        {total > 1 ? (
          <span aria-hidden className="inline-flex size-1.5 rounded-full bg-signal/70" />
        ) : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Version history"
          // Position: anchor to the chip's left on mobile (chip lives
          // near the left edge of the hero chip row, so the popover
          // grows rightward and fits on a 375px screen). On sm+ where
          // the chip can sit deeper in a flex row, also pin the left
          // edge — but cap the panel at the viewport width so we never
          // overflow horizontally regardless of chip position.
          className="absolute left-0 top-[calc(100%+10px)] z-40 w-[min(92vw,420px)] max-w-[calc(100vw-32px)] origin-top-left rounded-2xl border border-line bg-paper shadow-[0_30px_60px_-30px_rgba(31,17,8,0.35)]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-graphite">
                Version history
              </p>
              <h3 className="mt-1 font-serif text-[18px] leading-tight text-ink">
                {total} {total === 1 ? 'version' : 'versions'} on file
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-md text-graphite transition hover:bg-paper-2/60 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <ol className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {sorted.length === 0 ? (
              <li className="px-5 py-6 text-[13px] text-graphite">No versions recorded yet.</li>
            ) : (
              sorted.map((v) => {
                const isCurrent = v.version === currentVersion;
                return (
                  <li key={v.id} className="px-5 py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                          v{v.version}
                        </span>
                        {isCurrent ? (
                          <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-signal-dark">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                        <Clock aria-hidden className="size-3 opacity-70" />
                        {formatWhen(v.replaced_at)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-start gap-2">
                      {v.source_type === 'upload' ? (
                        <FileText
                          aria-hidden
                          className="mt-0.5 size-3.5 shrink-0 text-signal-dark"
                        />
                      ) : (
                        <Globe aria-hidden className="mt-0.5 size-3.5 shrink-0 text-signal-dark" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate font-mono text-[12.5px] text-ink"
                          title={v.filename ?? v.source_url ?? '—'}
                        >
                          {v.filename ?? v.source_url ?? '—'}
                        </p>
                        <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                          {v.source_type === 'upload'
                            ? `Upload · ${formatBytes(v.bytes)}`
                            : 'URL source'}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ol>
          <div className="border-t border-line bg-paper-2/40 px-5 py-3">
            <p className="text-[12px] leading-relaxed text-graphite">
              All existing share links automatically serve the current version. Earlier versions are
              kept for reference only.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
