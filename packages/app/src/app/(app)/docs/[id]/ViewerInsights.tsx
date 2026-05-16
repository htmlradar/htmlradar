// Doc-level analytics: stat strip + per-viewer table aggregated across
// all shares of this document. This is the surface the user (Abhi) had
// in his old product — viewers (people), not shares (URLs), as the unit
// of analysis. Per-share rollup stays below in SharesTable.
//
// Aggregation rule: viewers are grouped by email (lowercased) when one
// is present. Anonymous viewers (no_email gate) are each their own
// group, identified by viewer_id, and rendered as "Viewer N" using a
// stable order on first_seen. Same person opening two different shares
// = one merged row when they entered the same email; two rows otherwise.
//
// Pure render — all data is precomputed by page.tsx and passed in. No
// state, no client component, no Supabase queries here.

import type { Viewer, Session } from '@/lib/types';

interface ViewerInsightsProps {
  viewers: Viewer[];
  sessions: Session[];
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

function buildGroups(viewers: Viewer[], sessions: Session[]): ViewerGroup[] {
  // First-seen ordered list of viewers so anonymous "Viewer N" indices
  // are stable across renders.
  const sortedViewers = [...viewers].sort((a, b) =>
    (a.first_seen ?? '').localeCompare(b.first_seen ?? ''),
  );

  // Map viewer_id -> group key (email lowercased, or `__anon_<viewer_id>`).
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

  // Bucket viewer rows by group key.
  const groupViewers = new Map<string, Viewer[]>();
  for (const v of sortedViewers) {
    const k = keyForViewer.get(v.id)!;
    const list = groupViewers.get(k) ?? [];
    list.push(v);
    groupViewers.set(k, list);
  }

  // Sessions are indexed by viewer_id; roll them into groups.
  const groupSessions = new Map<string, Session[]>();
  for (const s of sessions) {
    const k = keyForViewer.get(s.viewer_id);
    if (!k) continue;
    const list = groupSessions.get(k) ?? [];
    list.push(s);
    groupSessions.set(k, list);
  }

  const groups: ViewerGroup[] = [];
  for (const [key, vList] of groupViewers.entries()) {
    const sList = groupSessions.get(key) ?? [];
    const totalSeconds = sList.reduce((acc, s) => acc + (s.active_time_seconds ?? 0), 0);
    const maxScroll = sList.reduce((acc, s) => Math.max(acc, s.max_scroll_depth ?? 0), 0);
    // Visits = sessions count for this group. Old product used the same
    // semantic (every open == one visit). Falls back to summing viewer-row
    // visit_count if there are no sessions yet (shouldn't happen — the
    // trigger fires off sessions inserts — but defensive).
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
    // Pick the most-recent viewer's country + device + referrer as the
    // row's metadata. Referrer is prettified down to just the host (no
    // path / query) — see prettifyReferrer().
    const recent = [...vList].sort((a, b) =>
      (b.last_seen ?? '').localeCompare(a.last_seen ?? ''),
    )[0];
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
    });
  }

  // Sort: most recently active first.
  groups.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
  return groups;
}

export function ViewerInsights({ viewers, sessions }: ViewerInsightsProps) {
  if (viewers.length === 0) return null;

  const groups = buildGroups(viewers, sessions);

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

  // Viewers today = unique groups whose any session.started_at is within
  // the last 24h. Uses the same group key as the table — so a viewer
  // counted once across multiple shares.
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

  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 className="font-serif text-[22px] leading-tight text-ink md:text-[26px]">Viewers</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Aggregated across all shares of this document
        </p>
      </div>

      {/* Stat strip — 2-col on phone, 3-col on small tablet (5 was
          ~150px each at 768px — too tight), 5-col on desktop. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total viewers" value={String(totalViewers)} />
        <Stat label="Total sessions" value={String(totalSessions)} />
        <Stat label="Avg read time" value={formatDuration(avgActive)} />
        <Stat label="Avg scroll" value={`${Math.round(avgScroll * 100)}%`} />
        <Stat label="Viewers today" value={String(viewersToday)} />
      </div>

      {/* Per-viewer table */}
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
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.key}
                className="border-b border-line text-[13.5px] last:border-b-0 hover:bg-paper-2/30"
              >
                <td className="px-4 py-3">
                  <div className="truncate font-medium text-ink">{g.primary}</div>
                  {(g.country || g.device || g.referrer) && (
                    <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.12em] text-graphite">
                      {[g.country, g.device, g.referrer].filter(Boolean).join(' · ')}
                    </div>
                  )}
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
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Strip the protocol/path off a referrer URL so the dashboard shows
// just the source host (e.g. `mail.google.com`, `t.co`, `twitter.com`).
// Empty / null / unparseable → "Direct link" so the column never blanks.
function prettifyReferrer(raw: string | null): string | null {
  if (!raw || !raw.trim()) return 'Direct link';
  try {
    return new URL(raw).host || 'Direct link';
  } catch {
    return raw.length > 32 ? `${raw.slice(0, 30)}…` : raw;
  }
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
  // pct is 0..1. Clamp + round so we never render >100% or NaN.
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
