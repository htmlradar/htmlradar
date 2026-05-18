'use client';

// SessionsList — the per-share session table that lives inside the
// SharePane (variant='panel-mini') and on /dashboard/[slug]
// (variant='default'). Extracted out of ShareAnalytics so it can be a
// client component with a "show more" expand toggle without making
// the whole ShareAnalytics tree client-side.
//
// Capped at 5 by default; user clicks "Show N more" to reveal the
// rest, and "Show recent" to collapse back. Stateless beyond that.

import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTimestamp } from '@/lib/format-timestamp';
import type { Session, Viewer } from '@/lib/types';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

interface Props {
  sessions: Session[];
  viewers: Viewer[];
  variant: 'default' | 'panel-mini';
  // How many rows to show in the collapsed state. Default 5.
  initialLimit?: number;
}

export function SessionsList({ sessions, viewers, variant, initialLimit = 5 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isPanel = variant === 'panel-mini';
  const visible = expanded ? sessions : sessions.slice(0, initialLimit);
  const hiddenCount = Math.max(0, sessions.length - initialLimit);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Sessions
        </h3>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
          {sessions.length} total
        </span>
      </div>
      <ul
        className={cn(
          'mt-3 overflow-hidden rounded-xl border border-line bg-paper',
          isPanel ? 'divide-y divide-line/70' : 'divide-y divide-line',
        )}
      >
        {visible.map((s) => {
          const v = viewers.find((x) => x.id === s.viewer_id);
          const ts = formatTimestamp(s.started_at, 'auto');
          return (
            <li
              key={s.id}
              className="grid items-center gap-3 px-4 py-3.5 text-[13.5px] sm:grid-cols-[2fr_1fr_auto_1.2fr_auto]"
            >
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-ink">
                  {v?.email ?? 'Anonymous'}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-[0.1em] text-graphite">
                  {[v?.city ?? v?.country_code, v?.device_type, v?.os, v?.browser]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </div>
              </div>
              <div className="font-mono text-[11.5px] text-graphite" title={ts.full}>
                {ts.display}
              </div>
              <div className="font-mono text-[12.5px] font-semibold tabular-nums text-signal-dark">
                {formatDuration(s.active_time_seconds)}
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2/70 sm:max-w-[120px]"
                  aria-label={`${Math.round(s.max_scroll_depth * 100)}% scroll`}
                >
                  <div
                    className="h-full rounded-full bg-ink"
                    style={{ width: `${Math.round(s.max_scroll_depth * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] tabular-nums text-graphite">
                  {Math.round(s.max_scroll_depth * 100)}%
                </span>
              </div>
              <ChevronRight aria-hidden className="size-4 text-graphite/60" />
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="link-slide mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:text-signal-dark"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp aria-hidden className="size-3.5" />
              Show recent
            </>
          ) : (
            <>
              <ChevronDown aria-hidden className="size-3.5" />
              Show {hiddenCount} more
            </>
          )}
        </button>
      )}
    </section>
  );
}
