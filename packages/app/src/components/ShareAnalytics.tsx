// ShareAnalytics — renders the per-share analytics block inline. Used
// both on /docs/[id] (expanded share rows) and on /dashboard/[slug]
// (the standalone per-share view).
//
// Two states:
//   - hasSessions: render stat cards + sessions list + section roll-up
//   - no sessions: render a "Waiting for first read" panel with the
//     live share URL highlighted (NOT a sample dashboard — that would
//     confuse a sender who has a real share that nobody has opened yet).
//
// All data is fetched by the parent and passed in. This component is a
// pure render layer.

import { CopySlugButton } from '@/components/CopySlugButton';
import type { Viewer, Session } from '@/lib/types';

interface SectionRow {
  id: string;
  title: string;
  totalSeconds: number;
  viewers: number;
}

export interface ShareAnalyticsProps {
  shareSlug: string;
  recipientLabel: string | null;
  viewers: Viewer[];
  sessions: Session[];
  sections: SectionRow[];
}

function formatDuration(seconds: number): string {
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
}: ShareAnalyticsProps) {
  if (sessions.length === 0) {
    return <WaitingState shareSlug={shareSlug} recipientLabel={recipientLabel} />;
  }

  const avgActiveSeconds =
    sessions.reduce((a, s) => a + s.active_time_seconds, 0) / sessions.length;
  const maxScroll = sessions.reduce((m, s) => Math.max(m, s.max_scroll_depth), 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Viewers" value={String(viewers.length)} />
        <Stat label="Sessions" value={String(sessions.length)} />
        <Stat label="Avg active time" value={formatDuration(avgActiveSeconds)} />
        <Stat label="Max scroll" value={`${Math.round(maxScroll * 100)}%`} />
      </div>

      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Sessions
        </h3>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {sessions.map((s) => {
            const v = viewers.find((x) => x.id === s.viewer_id);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 text-[13.5px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">
                    {v?.email ?? 'Anonymous'}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11.5px] text-ink-soft/80">
                    {v?.country_code ?? '—'} · {v?.device_type ?? '—'} · {v?.os ?? '—'} ·{' '}
                    {new Date(s.started_at).toLocaleString()}
                  </div>
                </div>
                <div className="text-right font-mono text-[12px] text-ink-soft">
                  <span className="text-[13px] font-semibold text-signal-dark">
                    {formatDuration(s.active_time_seconds)}
                  </span>{' '}
                  · {Math.round(s.max_scroll_depth * 100)}% scroll
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {sections.length > 0 && (
        <section>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            Sections read
          </h3>
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
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">{label}</div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums text-ink">{value}</div>
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
