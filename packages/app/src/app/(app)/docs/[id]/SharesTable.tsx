// Per-document at-a-glance table. Sits above the master-detail share
// manager on /docs/[id] and gives the founder a single tabular view
// of every share + its top-line metrics, without having to click each
// share individually.
//
// Feedback driving this: "Consolidated view is needed for a single
// document — a table of all links and time spent — that is the cleanest
// summary."
//
// All data is precomputed by the server component (page.tsx). This
// file is pure render — no state, no fetching. Mobile collapses the
// less-critical columns by hiding them; the core (recipient, sessions,
// avg time) stays visible.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { resolveRecipientIdentity } from '@/lib/recipient-identity';
import { SectionHead } from '@/components/doc-dashboard/SectionHead';
import type { ShareRow, ShareAnalyticsData } from './DocumentShareManager';

type Status = 'active' | 'revoked' | 'expired';

function statusOf(share: ShareRow): Status {
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && new Date(share.expires_at) < new Date()) return 'expired';
  return 'active';
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatRelative(iso: string | undefined | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SharesTable({
  shares,
  analyticsByShareId,
}: {
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
}) {
  // Render only when there's something to compare. A one-row table
  // duplicates the per-doc ViewerInsights strip above AND the share-
  // pane stats below — pure clutter. With 2+ shares the row-by-row
  // comparison is genuinely useful.
  if (shares.length < 2) return null;

  // Sort: active first, then expired, then revoked. Within each group,
  // most-recent activity first (last-opened DESC, then create DESC).
  const sorted = [...shares].sort((a, b) => {
    const sa = statusOf(a);
    const sb = statusOf(b);
    const rank = (s: Status) => (s === 'active' ? 0 : s === 'expired' ? 1 : 2);
    if (rank(sa) !== rank(sb)) return rank(sa) - rank(sb);
    const la = (analyticsByShareId[a.id]?.sessions[0]?.started_at as string | undefined) ?? '';
    const lb = (analyticsByShareId[b.id]?.sessions[0]?.started_at as string | undefined) ?? '';
    return lb.localeCompare(la);
  });

  return (
    <section className="mb-8">
      <SectionHead
        title="Share-by-share."
        hint={`${shares.length} ${shares.length === 1 ? 'share' : 'shares'} · click a row to drill in`}
      />
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
              <th className="px-4 py-3 font-normal">Recipient</th>
              <th className="hidden px-4 py-3 font-normal sm:table-cell">Status</th>
              <th className="px-4 py-3 text-right font-normal">Viewers</th>
              <th className="hidden px-4 py-3 text-right font-normal md:table-cell">Sessions</th>
              <th className="px-4 py-3 text-right font-normal">Avg tab-open</th>
              <th className="hidden px-4 py-3 text-right font-normal md:table-cell">Max scroll</th>
              <th className="hidden px-4 py-3 text-right font-normal lg:table-cell">Last open</th>
              <th className="px-4 py-3 font-normal" aria-label="Open dashboard" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((share) => {
              const status = statusOf(share);
              const analytics = analyticsByShareId[share.id];
              const sessions = analytics?.sessions ?? [];
              const viewers = analytics?.viewers ?? [];
              // Dedupe viewers by email (case-insensitive) and drop
              // internal rows so the count matches ViewerInsights' glance
              // grid above. Without this, the same person opening from
              // two devices reads as "2 viewers" here and "1 viewer"
              // there — same page, contradicting numbers.
              const visibleViewers = viewers.filter((v) => !v.is_internal);
              const dedupedViewerCount = new Set(
                visibleViewers.map((v) => v.email?.trim().toLowerCase() || v.id),
              ).size;
              const sessionCount = sessions.length;
              const avgActive =
                sessionCount > 0
                  ? sessions.reduce((acc, s) => acc + (s.active_time_seconds ?? 0), 0) /
                    sessionCount
                  : 0;
              const maxScroll = sessions.reduce(
                (acc, s) => Math.max(acc, s.max_scroll_depth ?? 0),
                0,
              );
              const lastOpenedAt = sessions[0]?.started_at as string | undefined;

              const identity = resolveRecipientIdentity(share, viewers);
              return (
                <tr
                  key={share.id}
                  className="border-b border-line text-[13.5px] last:border-b-0 hover:bg-paper-2/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${share.slug}`}
                      className="block truncate font-medium text-ink hover:text-signal-dark"
                      title={
                        identity.secondary
                          ? `${identity.primary} — ${identity.secondary}`
                          : identity.primary
                      }
                    >
                      {identity.primary}
                    </Link>
                    {identity.secondary && (
                      <div className="mt-0.5 truncate text-[11.5px] text-graphite">
                        {identity.secondary}
                      </div>
                    )}
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-graphite">
                      htmlradar.com/r/{share.slug}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <StatusDot status={status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-soft">
                    {dedupedViewerCount}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono tabular-nums text-ink-soft md:table-cell">
                    {sessionCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {formatDuration(avgActive)}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono tabular-nums text-ink-soft md:table-cell">
                    {sessionCount > 0 ? `${Math.round(maxScroll * 100)}%` : '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono text-[12px] text-graphite lg:table-cell">
                    {formatRelative(lastOpenedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/${share.slug}`}
                      aria-label={`Open ${identity.primary} dashboard`}
                      className="inline-flex items-center gap-1 text-signal-dark hover:text-signal"
                    >
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          status === 'active' && 'bg-signal',
          status === 'expired' && 'bg-alert',
          status === 'revoked' && 'bg-graphite/40',
        )}
      />
      {status}
    </span>
  );
}
