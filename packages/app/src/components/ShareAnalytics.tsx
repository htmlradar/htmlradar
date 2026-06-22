// ShareAnalytics — renders the per-share analytics block inline. Used
// both on /docs/[id] (expanded share rows, variant='panel-mini') and
// on /dashboard/[slug] (the standalone per-share view, default variant).
//
// The variant prop drives visual treatment only — data sources and the
// hideStatRow / hidesections gates are identical. Switching variants
// must NEVER change which metrics are computed or how.
//
// Two render states regardless of variant:
//   - hasSessions: render stat cards + sessions list + section roll-up
//   - no sessions: render a "Waiting for first read" panel with the
//     live share URL highlighted (NOT a sample dashboard — that would
//     confuse a sender who has a real share that nobody has opened yet).

import { cn } from '@/lib/cn';
import { CopySlugButton } from '@/components/CopySlugButton';
import { countDistinctViewers } from '@/lib/viewer-metrics';
import { SessionsList } from '@/components/SessionsList';
import type { Viewer, Session } from '@/lib/types';

interface SectionRow {
  id: string;
  title: string;
  totalSeconds: number;
  viewers: number;
  // DOM ordinal at first observation. Null for legacy rows captured
  // before the ordinal column existed. Used purely for deck-order sort.
  ordinal?: number | null;
}

export interface ShareAnalyticsProps {
  shareSlug: string;
  recipientLabel: string | null;
  viewers: Viewer[];
  sessions: Session[];
  sections: SectionRow[];
  // Hide the top 4-stat row when the caller already shows the same
  // numbers above (e.g. on /docs/[id] for a single-share doc where the
  // ViewerInsights strip is the canonical rollup). Default = false
  // (the standalone /dashboard/[slug] page wants the stats).
  hideStatRow?: boolean;
  // Hide the sessions list when the caller renders a richer
  // viewer-grouped table elsewhere on the page. On /docs/[id] with a
  // single share, ViewerInsights below already shows all the same
  // session data grouped by viewer with a drill-down — repeating
  // the flat sessions list here is just clutter.
  hideSessions?: boolean;
  // Visual variant. 'default' keeps the cream cards used on
  // /dashboard/[slug]; 'panel-mini' uses the pop-accented mini-grid
  // tuned for the SharePane on /docs/[id]. Pure styling difference.
  variant?: 'default' | 'panel-mini';
}

function formatDuration(seconds: number): string {
  // Sub-1s "glanced" sections render as em-dash (matches ViewerInsights).
  // Sections-v2 may emit qualifiedMs=0 for sections the reader scrolled
  // past too fast to qualify; surfacing them honestly beats a misleading
  // "0s" or rounded-up "1s".
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function ShareAnalytics({
  shareSlug,
  recipientLabel,
  viewers,
  sessions,
  sections,
  hideStatRow = false,
  hideSessions = false,
  variant = 'default',
}: ShareAnalyticsProps) {
  if (sessions.length === 0) {
    return <WaitingState shareSlug={shareSlug} recipientLabel={recipientLabel} />;
  }

  const avgActiveSeconds =
    sessions.reduce((a, s) => a + s.active_time_seconds, 0) / sessions.length;
  const maxScroll = sessions.reduce((m, s) => Math.max(m, s.max_scroll_depth), 0);

  const isPanel = variant === 'panel-mini';

  return (
    <div className="space-y-7">
      {!hideStatRow && (
        <div
          className={cn(
            'grid gap-2.5',
            isPanel ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-4',
          )}
        >
          <Stat
            label="Avg tab-open"
            value={formatDuration(avgActiveSeconds)}
            pop={isPanel}
            variant={variant}
          />
          <Stat label="Viewers" value={String(countDistinctViewers(viewers))} variant={variant} />
          <Stat label="Sessions" value={String(sessions.length)} variant={variant} />
          <Stat label="Max scroll" value={`${Math.round(maxScroll * 100)}%`} variant={variant} />
        </div>
      )}

      {!hideSessions && (
        <SessionsList sessions={sessions} viewers={viewers} variant={variant} initialLimit={5} />
      )}

      {/* Sections roll-up is intentionally NOT shown when this lives
          inside the SharePane on /docs[id] — the per-viewer drill in
          ViewerInsights above already covers section dwell with the
          new viewport-coverage algorithm. Showing it twice was the
          old duplicate-stat pattern. /dashboard/[slug] (default
          variant) still shows it because that's the standalone view. */}
      {!isPanel && (
        <section>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            Sections read
          </h3>
          {sections.length > 0 ? (
            <ul className="mt-3 overflow-hidden rounded-xl border border-line bg-paper">
              {sections.map((s) => (
                <li key={s.id} className="border-b border-line px-4 py-3.5 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium text-ink">{s.title}</span>
                    <span className="font-mono text-[12px] text-ink-soft">
                      <span className="text-[13px] font-semibold text-signal-dark">
                        {formatDuration(s.totalSeconds / Math.max(1, s.viewers))}
                      </span>{' '}
                      avg · {s.viewers} viewer{s.viewers === 1 ? '' : 's'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-paper-2/30 px-4 py-3.5 text-[13.5px] leading-relaxed text-ink-soft">
              Section dwell appears here once a recipient reads with the current tracker. We
              auto-detect sections from your HTML — headings, slide containers, or paragraph blocks.
              Reads captured before this update can&rsquo;t be back-filled.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  pop,
  variant,
}: {
  label: string;
  value: string;
  pop?: boolean;
  variant?: 'default' | 'panel-mini';
}) {
  const isPanel = variant === 'panel-mini';
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3.5',
        isPanel
          ? pop
            ? 'border-transparent bg-pop text-pop-ink'
            : 'border-line bg-paper'
          : 'border-line bg-paper',
      )}
    >
      <div
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.16em]',
          isPanel && pop ? 'text-pop-ink/70' : 'text-graphite',
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'mt-1.5 font-serif tabular-nums leading-none',
          isPanel ? 'text-[28px]' : 'text-[22px]',
          isPanel && pop ? 'text-pop-ink' : 'text-ink',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function WaitingState({
  shareSlug,
  recipientLabel,
}: {
  shareSlug: string;
  recipientLabel: string | null;
}) {
  const fullUrl = `https://htmlradar.com/r/${shareSlug}`;
  const who = recipientLabel ?? 'the recipient';

  return (
    <div className="space-y-5 rounded-xl border border-dashed border-signal/30 bg-paper-2/30 px-5 py-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
          Waiting for first read
        </p>
        <h3 className="mt-2 font-serif text-[20px] leading-snug text-ink md:text-[22px]">
          Send the link to {who}.
        </h3>
        <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          The session list, section dwell, and devices populate here the moment a recipient opens
          the link and dwells past three seconds.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{fullUrl}</span>
        <CopySlugButton slug={shareSlug} />
      </div>
    </div>
  );
}
