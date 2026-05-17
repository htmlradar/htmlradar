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

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Viewer, Session, SectionEvent } from '@/lib/types';

interface ViewerInsightsProps {
  viewers: Viewer[];
  sessions: Session[];
  events: SectionEvent[];
}

interface SectionRow {
  id: string;
  title: string;
  totalSeconds: number;
}

interface ViewerGroup {
  key: string;
  primary: string; // email or "Viewer N"
  totalSeconds: number;
  maxScroll: number; // 0..1
  visits: number;
  firstSeen: string;
  lastSeen: string;
  country: string | null;
  device: string | null;
  referrer: string | null;
  sections: SectionRow[]; // per-viewer section dwell, sorted desc
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

  // Sessions: bucket by group + build session_id → group_key for event roll-up.
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

  // Section events per group → per section → time accumulator.
  // Same section_id may appear across multiple sessions for the same
  // viewer (re-reads) — we sum them, matching the AT A GLANCE semantic
  // of "total time this person spent in this section."
  const groupSections = new Map<string, Map<string, SectionRow>>();
  for (const e of events) {
    const gKey = sessionToGroup.get(e.session_id);
    if (!gKey) continue;
    const map = groupSections.get(gKey) ?? new Map<string, SectionRow>();
    const cur = map.get(e.section_id) ?? {
      id: e.section_id,
      title: e.section_title ?? e.section_id,
      totalSeconds: 0,
    };
    cur.totalSeconds += e.time_seconds;
    map.set(e.section_id, cur);
    groupSections.set(gKey, map);
  }

  const groups: ViewerGroup[] = [];
  for (const [key, vList] of groupViewers.entries()) {
    const sList = groupSessions.get(key) ?? [];
    const totalSeconds = sList.reduce((acc, s) => acc + (s.active_time_seconds ?? 0), 0);
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
      ? [...sectionsMap.values()].sort((a, b) => b.totalSeconds - a.totalSeconds)
      : [];

    groups.push({
      key,
      primary: key.startsWith('__anon_') ? anonLabelFor.get(key)! : vList[0]!.email!,
      totalSeconds,
      maxScroll,
      visits,
      firstSeen,
      lastSeen,
      country: recent?.country_code ?? null,
      device: recent?.device_type ?? null,
      referrer: prettifyReferrer(recent?.referrer ?? null),
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

export function ViewerInsights({ viewers, sessions, events }: ViewerInsightsProps) {
  // Hooks must always run; the empty-render below is guarded after.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (viewers.length === 0) return null;

  const groups = buildGroups(viewers, sessions, events);

  const totalViewers = groups.length;
  const totalSessions = sessions.length;
  const avgActive =
    sessions.length > 0
      ? sessions.reduce((a, s) => a + (s.active_time_seconds ?? 0), 0) / sessions.length
      : 0;
  const avgScroll =
    sessions.length > 0
      ? sessions.reduce((a, s) => a + (s.max_scroll_depth ?? 0), 0) / sessions.length
      : 0;

  const dayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentKeys = new Set<string>();
  for (const s of sessions) {
    const started = new Date(s.started_at).getTime();
    if (started >= dayCutoff) {
      const group = groups.find((g) => g.firstSeen <= s.started_at && g.lastSeen >= s.started_at);
      if (group) recentKeys.add(group.key);
    }
  }
  const viewersToday = recentKeys.size;

  const toggle = (key: string) => setExpandedKey((prev) => (prev === key ? null : key));

  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 className="font-serif text-[22px] leading-tight text-ink md:text-[26px]">Viewers</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Click a viewer to see their section-level dwell
        </p>
      </div>

      {/* Aggregate — kept succinct on top. Real surface is the per-viewer table below. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total viewers" value={String(totalViewers)} />
        <Stat label="Total sessions" value={String(totalSessions)} />
        <Stat label="Avg read time" value={formatDuration(avgActive)} />
        <Stat label="Avg scroll" value={`${Math.round(avgScroll * 100)}%`} />
        <Stat label="Viewers today" value={String(viewersToday)} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
              <th className="px-4 py-3 font-normal">Viewer</th>
              <th className="px-4 py-3 text-right font-normal">Total time</th>
              <th className="px-4 py-3 font-normal">Scroll depth</th>
              <th className="hidden px-4 py-3 text-right font-normal md:table-cell">Visits</th>
              <th className="hidden px-4 py-3 text-right font-normal md:table-cell">First seen</th>
              <th className="px-4 py-3 text-right font-normal">Last seen</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const isOpen = expandedKey === g.key;
            return (
              <tbody key={g.key} className="border-b border-line last:border-b-0">
                <tr
                  onClick={() => toggle(g.key)}
                  className={
                    'cursor-pointer text-[13.5px] transition ' +
                    (isOpen ? 'bg-paper-2/50' : 'hover:bg-paper-2/30')
                  }
                  aria-expanded={isOpen}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <ChevronRight
                        aria-hidden
                        className={
                          'mt-0.5 size-3.5 shrink-0 text-graphite transition ' +
                          (isOpen ? 'rotate-90' : '')
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-ink">{g.primary}</div>
                        {(g.country || g.device || g.referrer) && (
                          <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.12em] text-graphite">
                            {[g.country, g.device, g.referrer].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {formatDuration(g.totalSeconds)}
                  </td>
                  <td className="px-4 py-3">
                    <ScrollBar pct={g.maxScroll} />
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono tabular-nums text-ink-soft md:table-cell">
                    {g.visits}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono text-[12px] text-graphite md:table-cell">
                    {formatRelative(g.firstSeen)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-graphite">
                    {formatRelative(g.lastSeen)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-paper-2/30">
                    <td colSpan={6} className="px-4 py-5">
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
      </div>
    </section>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">{label}</div>
      <div className="mt-1.5 font-serif text-[24px] tabular-nums leading-none text-ink">
        {value}
      </div>
    </div>
  );
}

function ScrollBar({ pct }: { pct: number }) {
  const safe = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0));
  const widthPct = Math.round(safe * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-1.5 w-20 overflow-hidden rounded-full bg-paper-3 sm:w-32"
        aria-label={`Scroll depth ${widthPct}%`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-signal"
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-ink-soft">{widthPct}%</span>
    </div>
  );
}
