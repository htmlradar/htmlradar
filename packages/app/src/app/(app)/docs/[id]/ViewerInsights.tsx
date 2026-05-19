'use client';

// Doc-level analytics: stat strip + per-viewer drill on `/docs/[id]`.
//
// The aggregate (5-card stat strip on top) is intentionally succinct —
// "across all viewers of this doc" snapshot, nothing more. The real
// surface is the per-viewer table, where each row expands to show
// THAT person's section-level dwell. Aggregate section-dwell was the
// wrong default; readers want to know "where did Marc spend his time,"
// not "where did everyone spend their time on average."
//
// Aggregation rule for viewer grouping: by lowercased email when one
// is present; anonymous viewers (no-email gate) each become their own
// "Viewer N" group, numbered by `first_seen`. Same person opening two
// shares with the same email = one merged row.
//
// Each group's section list is built by walking `events`, finding each
// event's session → viewer → group_key, and accumulating time_seconds
// into a per-section bucket. Empty section lists render a short
// non-technical note instead of disappearing — sets expectations for
// docs where sections weren't captured (old reads pre-auto-detection,
// or HTML with no detectable structure).
//
// "Hide internal viewers": migration 012 adds `viewers.is_internal`.
// Auto-flagged for owner-self views and `@htmlradar.com` staff. Hidden
// viewers drop out of the aggregate stat strip AND the default table.
// A `Show hidden (N)` toggle reveals them with muted styling so the
// owner can validate test-mode reads or unhide false positives. Per-row
// `⊘` action toggles is_internal via the server action.

import { useMemo, useState } from 'react';
import { ChevronRight, EyeOff, Eye } from 'lucide-react';
import type { Viewer, Session, SectionEvent } from '@/lib/types';
import { GlanceGrid, sparklineFromSessionStarts } from '@/components/doc-dashboard/Glance';
import { PulsingDot } from '@/components/doc-dashboard/PulsingDot';
import { SectionHead } from '@/components/doc-dashboard/SectionHead';
import { formatTimestamp } from '@/lib/format-timestamp';

interface ViewerInsightsProps {
  viewers: Viewer[];
  sessions: Session[];
  events: SectionEvent[];
  documentId: string;
  // Map of share_id → slug. Lets the viewer row surface the share URL
  // a viewer came through. When a single email opened multiple shares
  // (rare, e.g. forwarded link), we render "N shares" instead.
  shareSlugs?: Record<string, string>;
  // Map of share_id → recipient_label. Surfaces the sender's chosen
  // label under the slug ("Investor list", "Marc at Example Ventures"), so the
  // viewer row ties back to the same share-identity the rail uses.
  shareLabels?: Record<string, string | null>;
  toggleInternal: (formData: FormData) => void | Promise<void>;
}

interface SectionRow {
  id: string;
  title: string;
  totalSeconds: number;
  // Smallest DOM ordinal observed for this section across the viewer's
  // sessions. Used to render the drill in deck order. Null when older
  // section_events rows didn't capture an ordinal.
  ordinal: number | null;
}

interface ViewerGroup {
  key: string;
  viewerIds: string[]; // every viewer row that maps to this group (for hide action)
  primary: string; // email or "Viewer N"
  isInternal: boolean; // true iff every viewer in the group is internal
  // Reading time = section dwell sum. This is the honest "engaged with
  // content" number and the one we show prominently. It's bounded above
  // by activeSeconds — you can't read more than the tab was open.
  totalSeconds: number;
  // Tab-open time (sum of session.active_time_seconds). Inflates on
  // mobile when a session stays foregrounded but the user isn't
  // looking (no visibilitychange fires when a user app-switches on
  // some Android/iOS versions). Shown as a secondary footnote.
  activeSeconds: number;
  maxScroll: number; // 0..1
  visits: number;
  firstSeen: string;
  lastSeen: string;
  // Distinct share_ids touched by this viewer group. Common case is 1;
  // multiple means the same email opened multiple shares of this doc
  // (forwarded link, sender re-shared with a new slug).
  shareIds: string[];
  country: string | null;
  device: string | null;
  referrer: string | null;
  // Most-recent session's last_heartbeat_at (ms epoch). Drives the live
  // status pulse on the row: < 60s ago = "actively reading right now".
  lastHeartbeatMs: number;
  sections: SectionRow[]; // per-viewer section dwell, sorted desc
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// Split a duration into (display value, unit) so the feature stat card
// can render the number big and the unit small. Picks the largest
// natural unit that keeps the value readable:
//   <60s   → "47" / "s"
//   <60m   → "12" / "m"
//   >=1h   → "1.2" / "h"
function formatDurationParts(seconds: number): { value: string; unit: string } {
  if (!seconds || seconds < 1) return { value: '0', unit: 's' };
  if (seconds < 60) return { value: String(Math.round(seconds)), unit: 's' };
  if (seconds < 3600) return { value: String(Math.floor(seconds / 60)), unit: 'm' };
  // Hours with one decimal; trim ".0" so a clean hour renders bare.
  const hours = seconds / 3600;
  const v = hours >= 10 ? hours.toFixed(0) : hours.toFixed(1);
  return { value: v.endsWith('.0') ? v.slice(0, -2) : v, unit: 'h' };
}

// (formatRelative removed 2026-05-18 — superseded by formatTimestamp
// from @/lib/format-timestamp. Both call sites now use the shared
// formatter so the hybrid recency/absolute display + hover tooltip
// is consistent across ViewerInsights and ShareAnalytics.)

function buildGroups(
  viewers: Viewer[],
  sessions: Session[],
  events: SectionEvent[],
): ViewerGroup[] {
  // Stable group order from first_seen.
  const sortedViewers = [...viewers].sort((a, b) =>
    (a.first_seen ?? '').localeCompare(b.first_seen ?? ''),
  );

  const keyForViewer = new Map<string, string>();
  let anonCounter = 0;
  const anonLabelFor = new Map<string, string>();
  for (const v of sortedViewers) {
    if (v.email && v.email.trim()) {
      keyForViewer.set(v.id, v.email.trim().toLowerCase());
    } else {
      const key = `__anon_${v.id}`;
      keyForViewer.set(v.id, key);
      anonCounter += 1;
      anonLabelFor.set(key, `Viewer ${anonCounter}`);
    }
  }

  const groupViewers = new Map<string, Viewer[]>();
  for (const v of sortedViewers) {
    const k = keyForViewer.get(v.id)!;
    const list = groupViewers.get(k) ?? [];
    list.push(v);
    groupViewers.set(k, list);
  }

  const sessionToGroup = new Map<string, string>();
  const groupSessions = new Map<string, Session[]>();
  for (const s of sessions) {
    const k = keyForViewer.get(s.viewer_id);
    if (!k) continue;
    sessionToGroup.set(s.id, k);
    const list = groupSessions.get(k) ?? [];
    list.push(s);
    groupSessions.set(k, list);
  }

  const groupSections = new Map<string, Map<string, SectionRow>>();
  for (const e of events) {
    const gKey = sessionToGroup.get(e.session_id);
    if (!gKey) continue;
    const map = groupSections.get(gKey) ?? new Map<string, SectionRow>();
    const cur = map.get(e.section_id) ?? {
      id: e.section_id,
      title: e.section_title ?? e.section_id,
      totalSeconds: 0,
      ordinal: null as number | null,
    };
    cur.totalSeconds += e.time_seconds;
    // Smallest observed ordinal wins so the deck-order sort is stable
    // even if a section's DOM position drifts mid-fundraise.
    if (typeof e.ordinal === 'number') {
      cur.ordinal = cur.ordinal == null ? e.ordinal : Math.min(cur.ordinal, e.ordinal);
    }
    map.set(e.section_id, cur);
    groupSections.set(gKey, map);
  }

  const groups: ViewerGroup[] = [];
  for (const [key, vList] of groupViewers.entries()) {
    const sList = groupSessions.get(key) ?? [];
    const activeSeconds = sList.reduce((acc, s) => acc + (s.active_time_seconds ?? 0), 0);
    const sectionsMapForReadingTime = groupSections.get(key);
    const sectionsForReadingTime = sectionsMapForReadingTime
      ? [...sectionsMapForReadingTime.values()]
      : [];
    // Reading time = section dwell sum, capped by active time. If no
    // sections were captured (older sessions pre-IO tracker, or docs
    // without detectable structure) we fall back to active time so
    // the cell isn't blank.
    const dwellSum = sectionsForReadingTime.reduce((acc, s) => acc + s.totalSeconds, 0);
    const totalSeconds = dwellSum > 0 ? Math.min(dwellSum, activeSeconds) : activeSeconds;
    const maxScroll = sList.reduce((acc, s) => Math.max(acc, s.max_scroll_depth ?? 0), 0);
    const visits =
      sList.length > 0 ? sList.length : vList.reduce((acc, v) => acc + (v.visit_count ?? 1), 0);
    const firstSeen = vList.reduce(
      (acc, v) => (acc === '' || (v.first_seen ?? '') < acc ? (v.first_seen ?? acc) : acc),
      '' as string,
    );
    const lastSeen = vList.reduce(
      (acc, v) => ((v.last_seen ?? '') > acc ? (v.last_seen ?? acc) : acc),
      '' as string,
    );
    const recent = [...vList].sort((a, b) =>
      (b.last_seen ?? '').localeCompare(a.last_seen ?? ''),
    )[0];

    const sectionsMap = groupSections.get(key);
    const sections = sectionsMap
      ? [...sectionsMap.values()].sort((a, b) => {
          // Deck order — narrative reads top-to-bottom the way the
          // sender wrote the deck, not by time-spent desc. Sections
          // missing an ordinal (older sessions before the column was
          // captured) fall to the end.
          if (a.ordinal == null && b.ordinal == null) return 0;
          if (a.ordinal == null) return 1;
          if (b.ordinal == null) return -1;
          return a.ordinal - b.ordinal;
        })
      : [];

    // A group is "internal" only if every viewer row backing it is
    // flagged. Mixed groups (rare; same email across two shares where
    // only one is flagged) stay visible — better to over-show than
    // accidentally hide a real read.
    const isInternal = vList.every((v) => v.is_internal === true);

    // Distinct share ids this viewer touched. Order doesn't matter for
    // rendering ("3 shares" vs slug), so a Set→Array is fine.
    const shareIds = Array.from(new Set(vList.map((v) => v.share_id)));

    // Latest heartbeat across all sessions in this group. Drives the
    // "live" pulse on the row when < 60s ago.
    const lastHeartbeatMs = sList.reduce((acc, s) => {
      const t = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
      return t > acc ? t : acc;
    }, 0);

    groups.push({
      key,
      viewerIds: vList.map((v) => v.id),
      primary: key.startsWith('__anon_') ? anonLabelFor.get(key)! : vList[0]!.email!,
      isInternal,
      totalSeconds,
      activeSeconds,
      maxScroll,
      visits,
      firstSeen,
      lastSeen,
      shareIds,
      country: recent?.country_code ?? null,
      device: recent?.device_type ?? null,
      referrer: prettifyReferrer(recent?.referrer ?? null),
      lastHeartbeatMs,
      sections,
    });
  }

  groups.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
  return groups;
}

function prettifyReferrer(raw: string | null): string | null {
  if (!raw || !raw.trim()) return 'Direct link';
  try {
    return new URL(raw).host || 'Direct link';
  } catch {
    return raw.length > 32 ? `${raw.slice(0, 30)}…` : raw;
  }
}

export function ViewerInsights({
  viewers,
  sessions,
  events,
  documentId,
  shareSlugs,
  shareLabels,
  toggleInternal,
}: ViewerInsightsProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showAllViewers, setShowAllViewers] = useState(false);

  // All hooks must run before any conditional return.
  const allGroups = useMemo(
    () => buildGroups(viewers, sessions, events),
    [viewers, sessions, events],
  );

  const { visibleGroups, hiddenGroups } = useMemo(() => {
    const visible: ViewerGroup[] = [];
    const hidden: ViewerGroup[] = [];
    for (const g of allGroups) (g.isInternal ? hidden : visible).push(g);
    return { visibleGroups: visible, hiddenGroups: hidden };
  }, [allGroups]);

  // Aggregate stats are computed from VISIBLE viewers only, by design.
  // Toggling "Show hidden" reveals rows in the table — it never changes
  // the headline numbers. That preserves the dashboard as a clean
  // "what real prospects did" view, regardless of how the owner
  // arranges the table below.
  const aggregates = useMemo(() => {
    const visibleViewerIds = new Set<string>();
    for (const g of visibleGroups) for (const id of g.viewerIds) visibleViewerIds.add(id);
    const visibleSessions = sessions.filter((s) => visibleViewerIds.has(s.viewer_id));

    const totalViewers = visibleGroups.length;
    const totalSessions = visibleSessions.length;
    // CRITICAL: total + avg active times BOTH source from per-viewer
    // section dwell (g.totalSeconds), NOT session.active_time_seconds.
    // The latter inflates on idle-but-foregrounded mobile tabs (the
    // idle-foreground-tab incident). Section dwell is the honest
    // "engaged with content" number — what we surface as "Reading time"
    // in the per-row drill.
    const totalActiveSeconds = visibleGroups.reduce((a, g) => a + g.totalSeconds, 0);
    const avgActive = totalViewers > 0 ? totalActiveSeconds / totalViewers : 0;
    // Avg seconds per SESSION (not per viewer) — surfaces as the
    // delta annotation under the Sessions card.
    const avgPerSession = totalSessions > 0 ? totalActiveSeconds / totalSessions : 0;
    // Single best scroll across all visible sessions — a designer's
    // reference shows the headline "max scroll" not "avg scroll"
    // because the average gets pulled down by the inevitable 5%
    // bounce-rate sessions. Max is the more interesting signal:
    // "did anyone actually read to the end?"
    const maxScroll = visibleSessions.reduce((m, s) => Math.max(m, s.max_scroll_depth ?? 0), 0);

    const dayCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentKeys = new Set<string>();
    for (const s of visibleSessions) {
      const started = new Date(s.started_at).getTime();
      if (started >= dayCutoff) {
        const group = visibleGroups.find(
          (g) => g.firstSeen <= s.started_at && g.lastSeen >= s.started_at,
        );
        if (group) recentKeys.add(group.key);
      }
    }

    // Live readers: count UNIQUE viewer groups whose latest session
    // heart-beated in the last 60s. Counting raw sessions over-counts
    // the same person with two tabs open. Grouping by viewer key
    // matches the green dot semantic in the table below — chip and
    // dot now agree on what "one reader" means.
    const liveCutoff = Date.now() - 60_000;
    const liveGroupKeys = new Set<string>();
    for (const g of visibleGroups) {
      if (g.lastHeartbeatMs > liveCutoff) liveGroupKeys.add(g.key);
    }
    const liveReaders = liveGroupKeys.size;

    // 12 buckets x 2h each → 24h sparkline.
    const sparkline = sparklineFromSessionStarts(
      visibleSessions.map((s) => s.started_at),
      12,
      24,
    );

    return {
      totalViewers,
      totalSessions,
      totalActiveSeconds,
      avgActive,
      avgPerSession,
      maxScroll,
      viewersToday: recentKeys.size,
      liveReaders,
      sparkline,
    };
  }, [visibleGroups, sessions]);

  if (viewers.length === 0) return null;

  const toggle = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));
  const allRows = showHidden ? [...visibleGroups, ...hiddenGroups] : visibleGroups;
  // Cap the viewer table to 5 rows in the collapsed state with a
  // "Show all N" expand toggle below — same pattern as the sessions
  // list. Long lists were dominating the page and the most-recent
  // few are what the sender wants to glance.
  const VIEWER_TABLE_INITIAL_LIMIT = 5;
  const rowsToRender = showAllViewers ? allRows : allRows.slice(0, VIEWER_TABLE_INITIAL_LIMIT);
  const hiddenByCapCount = Math.max(0, allRows.length - VIEWER_TABLE_INITIAL_LIMIT);

  return (
    <section className="mb-8">
      <SectionHead title="Who's reading." hint="Click a viewer for section-level dwell" />

      {/* Glance grid — 1 feature card (dark, big number + sparkline) +
          3 paper cards. Replaces the prior 5-card paper-only strip per
          a designer's 2026-05-18 redesign. Every metric still reflects
          VISIBLE viewers only (hidden viewers stay out of the headline
          numbers regardless of the table's show-hidden toggle).
          Critical: feature value derives from section dwell SUM, NOT
          session.active_time — see comment above on aggregates. */}
      <div className="mt-5">
        <GlanceGrid
          feature={{
            label: 'Total active read time',
            ...formatDurationParts(aggregates.totalActiveSeconds),
            liveReaders: aggregates.liveReaders,
            sparkline: aggregates.sparkline,
          }}
          cards={[
            {
              label: 'Viewers',
              value: String(aggregates.totalViewers),
              delta:
                aggregates.viewersToday > 0
                  ? `↑ ${aggregates.viewersToday} today`
                  : hiddenGroups.length > 0
                    ? `${hiddenGroups.length} hidden`
                    : 'No reads today',
            },
            {
              label: 'Sessions',
              value: String(aggregates.totalSessions),
              delta:
                aggregates.totalSessions > 0
                  ? `Avg ${formatDuration(aggregates.avgPerSession)} per session`
                  : 'No sessions yet',
            },
            {
              label: 'Max scroll',
              value: `${Math.round(aggregates.maxScroll * 100)}`,
              unit: '%',
              delta:
                aggregates.maxScroll >= 0.99
                  ? 'Someone read to the bottom'
                  : aggregates.maxScroll > 0
                    ? `Deepest read this far`
                    : null,
            },
          ]}
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-paper">
        {/* Table header strip: column titles on the left, "Show hidden"
            toggle on the right. The toggle only appears when there's
            something to show — zero state stays uncluttered. */}
        <div className="flex items-center justify-between border-b border-line bg-paper-2/40 px-6 py-3.5">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite">
            {visibleGroups.length} {visibleGroups.length === 1 ? 'viewer' : 'viewers'}
            {hiddenGroups.length > 0 && showHidden && (
              <span className="ml-1.5 text-ink-soft">· {hiddenGroups.length} hidden shown</span>
            )}
          </div>
          {hiddenGroups.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite transition hover:text-signal-dark"
            >
              {showHidden ? (
                <>
                  <Eye aria-hidden className="size-3.5" />
                  Hide internal ({hiddenGroups.length})
                </>
              ) : (
                <>
                  <EyeOff aria-hidden className="size-3.5" />
                  Show hidden ({hiddenGroups.length})
                </>
              )}
            </button>
          )}
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
              <th className="px-6 py-3.5 font-normal">Viewer</th>
              <th className="px-4 py-3.5 text-right font-normal">Reading time</th>
              <th className="px-4 py-3.5 font-normal">Scroll depth</th>
              <th className="hidden px-4 py-3.5 text-right font-normal md:table-cell">Visits</th>
              <th className="hidden px-4 py-3.5 text-right font-normal md:table-cell">
                First seen
              </th>
              <th className="px-4 py-3.5 text-right font-normal">Last seen</th>
              <th className="w-14 px-2 py-3.5 font-normal" aria-label="Hide / expand" />
            </tr>
          </thead>
          {rowsToRender.map((g) => {
            const isOpen = expandedKey === g.key;
            const isHidden = g.isInternal;
            return (
              <tbody
                key={g.key}
                className={
                  'group border-b border-line last:border-b-0 ' +
                  (isHidden ? 'bg-paper-2/15 text-ink-soft' : '')
                }
              >
                <tr
                  onClick={() => toggle(g.key)}
                  className={
                    'cursor-pointer text-[13.5px] transition ' +
                    (isOpen ? 'bg-paper-2/50' : 'hover:bg-paper-2/30')
                  }
                  aria-expanded={isOpen}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-start gap-2.5">
                      <ChevronRight
                        aria-hidden
                        className={
                          'mt-1 size-3.5 shrink-0 text-graphite transition ' +
                          (isOpen ? 'rotate-90' : '')
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={
                            'truncate text-[14.5px] font-medium ' +
                            (isHidden ? 'text-ink-soft' : 'text-ink')
                          }
                        >
                          {g.primary}
                          {isHidden && (
                            <span className="ml-2 rounded border border-line bg-paper px-1.5 py-0.5 align-middle font-mono text-[9.5px] uppercase tracking-[0.16em] text-graphite">
                              Hidden
                            </span>
                          )}
                        </div>
                        {/* Slug URL — surfaces which share this viewer
                            came through. Single-slug viewers (common
                            case) get the URL; multi-share viewers
                            (rare) get "N shares" instead. */}
                        {g.shareIds.length === 1 && shareSlugs?.[g.shareIds[0]!] && (
                          <div className="mt-0.5 space-y-0.5">
                            <div className="truncate font-mono text-[11px] text-graphite">
                              /r/{shareSlugs[g.shareIds[0]!]}
                            </div>
                            {shareLabels?.[g.shareIds[0]!] && (
                              <div className="truncate text-[11.5px] text-ink-soft">
                                {shareLabels[g.shareIds[0]!]}
                              </div>
                            )}
                          </div>
                        )}
                        {g.shareIds.length > 1 && (
                          <div className="mt-0.5 font-mono text-[11px] text-graphite">
                            {g.shareIds.length} shares
                          </div>
                        )}
                        {(g.country || g.device || g.referrer) && (
                          <div className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.12em] text-graphite">
                            {[g.country, g.device, g.referrer].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right font-mono tabular-nums">
                    <div>{formatDuration(g.totalSeconds)}</div>
                    {g.activeSeconds > g.totalSeconds + 30 && (
                      // Show "tab open" only when the gap is meaningful
                      // (>30s). Otherwise it's noise. Larger gap = user
                      // had the tab open without engaging — informative
                      // signal but not the headline number.
                      <div
                        title="Total time the tab was open (active). Reading time above is the portion spent inside a section."
                        className="mt-0.5 text-[10.5px] font-normal text-graphite"
                      >
                        tab: {formatDuration(g.activeSeconds)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <ScrollBar pct={g.maxScroll} muted={isHidden} />
                  </td>
                  <td className="hidden px-4 py-4 text-right font-mono tabular-nums md:table-cell">
                    {g.visits}
                  </td>
                  {/* First seen — "auto" mode: relative under 24h
                      (e.g. "6h ago" when fresh), absolute date once
                      older ("May 17", or "May 17, 2025" if a different
                      calendar year). The entry-into-funnel date is a
                      fact worth pinning, not a moving target. Hover
                      always reveals the full timestamp. */}
                  <td
                    className="hidden px-4 py-4 text-right font-mono text-[12px] text-graphite md:table-cell"
                    title={formatTimestamp(g.firstSeen, 'auto').full}
                  >
                    {formatTimestamp(g.firstSeen, 'auto').display}
                  </td>
                  {/* Last seen — same hybrid "auto" mode as First seen:
                      recent stays relative ("12h ago"), older pins to
                      absolute ("May 17"). Symmetric with First seen so
                      the two columns read consistently on the same row.
                      Hover reveals the full timestamp. */}
                  <td
                    className="px-4 py-4 text-right font-mono text-[12px] text-graphite"
                    title={formatTimestamp(g.lastSeen, 'auto').full}
                  >
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {/* Pulsing dot when this viewer heart-beated in
                          the last 60s — "actively reading right now"
                          signal lives at the row level, not just the
                          hero. */}
                      {g.lastHeartbeatMs > 0 && Date.now() - g.lastHeartbeatMs < 60_000 && (
                        <PulsingDot tone="good" />
                      )}
                      {formatTimestamp(g.lastSeen, 'auto').display}
                    </div>
                  </td>
                  <td className="w-14 px-2 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <HideViewerButton
                      viewerIds={g.viewerIds}
                      documentId={documentId}
                      isHidden={isHidden}
                      action={toggleInternal}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-paper-2/30">
                    <td colSpan={7} className="px-6 py-6">
                      <ViewerSectionDrill
                        primary={g.primary}
                        sections={g.sections}
                        visits={g.visits}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
        {hiddenByCapCount > 0 && (
          <div className="flex items-center justify-center border-t border-line bg-paper-2/30 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowAllViewers((v) => !v)}
              aria-expanded={showAllViewers}
              className="link-slide inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:text-signal-dark"
            >
              {showAllViewers
                ? `Show top ${VIEWER_TABLE_INITIAL_LIMIT}`
                : `Show ${hiddenByCapCount} more viewer${hiddenByCapCount === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// Hide/unhide control. Submits one form per viewer-row in the group
// (a group may merge two viewer rows when the same email visited two
// shares of this doc). Stays terse — icon-only, hover-revealed.
function HideViewerButton({
  viewerIds,
  documentId,
  isHidden,
  action,
}: {
  viewerIds: string[];
  documentId: string;
  isHidden: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  // One viewer-row will be the common case; multi-row groups still get
  // a single click — we render N invisible siblings and submit-then-
  // submit them via a wrapper form, but for the common case we just
  // submit one. Keep it simple: submit the primary row; if the group
  // had two, the second flip can happen on next click. Trade-off
  // acceptable — multi-share viewer hide is rare.
  const primaryId = viewerIds[0]!;
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="viewer_id" value={primaryId} />
      <input type="hidden" name="document_id" value={documentId} />
      <button
        type="submit"
        title={isHidden ? 'Unhide this viewer' : 'Hide from analytics'}
        className={
          'inline-flex size-7 items-center justify-center rounded-md text-graphite opacity-0 transition hover:bg-paper-3 hover:text-signal-dark group-hover:opacity-100 ' +
          (isHidden ? 'opacity-100' : '')
        }
      >
        {isHidden ? (
          <Eye aria-hidden className="size-3.5" />
        ) : (
          <EyeOff aria-hidden className="size-3.5" />
        )}
        <span className="sr-only">{isHidden ? 'Unhide viewer' : 'Hide viewer'}</span>
      </button>
    </form>
  );
}

function ViewerSectionDrill({
  primary,
  sections,
  visits,
}: {
  primary: string;
  sections: SectionRow[];
  visits: number;
}) {
  if (sections.length === 0) {
    return (
      <div className="mx-2 rounded-lg border border-dashed border-line bg-paper px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
        No section dwell captured for <span className="font-medium text-ink">{primary}</span> yet.
        Sections are detected at read time — older sessions from before auto-detection won't show
        here, and docs with no detectable structure won't either.
      </div>
    );
  }

  const longestPossibleBar = sections[0]!.totalSeconds || 1;

  return (
    <div className="mx-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-graphite">
          Sections read by <span className="text-signal-dark">{primary}</span>
        </h3>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
          {sections.length} section{sections.length === 1 ? '' : 's'} · {visits} visit
          {visits === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="space-y-1.5">
        {sections.map((s) => {
          const widthPct = Math.max(8, Math.round((s.totalSeconds / longestPossibleBar) * 100));
          return (
            <li key={s.id} className="flex items-center gap-3 rounded-md bg-paper px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{s.title}</span>
              <div className="flex shrink-0 items-center gap-3">
                <div
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-3 sm:w-40"
                  aria-label={`${formatDuration(s.totalSeconds)} dwell`}
                >
                  <div
                    className="h-full rounded-full bg-signal"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-mono text-[12px] tabular-nums text-ink-soft">
                  {formatDuration(s.totalSeconds)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScrollBar({ pct, muted = false }: { pct: number; muted?: boolean }) {
  const safe = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0));
  const widthPct = Math.round(safe * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-1.5 w-20 overflow-hidden rounded-full bg-paper-3 sm:w-32"
        aria-label={`Scroll depth ${widthPct}%`}
      >
        <div
          className={
            'absolute inset-y-0 left-0 rounded-full ' + (muted ? 'bg-graphite/40' : 'bg-signal')
          }
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-ink-soft">{widthPct}%</span>
    </div>
  );
}
