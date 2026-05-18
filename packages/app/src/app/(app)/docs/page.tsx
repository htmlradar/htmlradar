// /docs — Document library. Top-line stat strip + per-row metadata
// (status dot, share count, last opened, viewer count). The bare list
// felt like a hobbyist tool; the strip + rich rows lift it to "this
// is a working dashboard" register without redesigning anything.

import Link from 'next/link';
import { ArrowRight, FileText, Link2 } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { SectionMark } from '@/components/SectionMark';
import { HeroRadar } from '@/components/HeroRadar';

export const runtime = 'edge';

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function DocumentsPage() {
  await requireUser();
  const supabase = serverClient();

  // Fan-out: docs + shares + recent sessions in three parallel queries.
  // We aggregate client-side because the join cost in Postgres for these
  // small tables (per-user scoped via RLS) is similar to assembling in
  // memory and the latter is easier to read.
  const [docsRes, sharesRes] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, source_type, current_version, created_at, last_viewed_by_owner_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('document_shares')
      .select('id, document_id, revoked_at, expires_at')
      .is('revoked_at', null),
  ]);

  const docs = docsRes.data ?? [];
  const shares = sharesRes.data ?? [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const shareIds = shares.map((s) => s.id);

  // One sessions query for the entire library — used for "reads this
  // week" stat and per-doc "last opened" + active-time average.
  const sessionsRes = shareIds.length
    ? await supabase
        .from('sessions')
        .select('share_id, started_at, active_time_seconds')
        .in('share_id', shareIds)
        .gte('started_at', sevenDaysAgo)
    : { data: [] as Array<{ share_id: string; started_at: string; active_time_seconds: number }> };

  // Also fetch ALL sessions (not just 7d) just for the per-doc "last
  // opened" relative timestamp. We bound the query to the user's own
  // shares so it stays cheap.
  const allSessionsRes = shareIds.length
    ? await supabase
        .from('sessions')
        .select('share_id, started_at, active_time_seconds')
        .in('share_id', shareIds)
        .order('started_at', { ascending: false })
        .limit(500)
    : { data: [] as Array<{ share_id: string; started_at: string; active_time_seconds: number }> };

  const weeklySessions = sessionsRes.data ?? [];
  const recentSessions = allSessionsRes.data ?? [];

  // Map share_id → document_id for fast roll-ups.
  const shareToDoc = new Map(shares.map((s) => [s.id, s.document_id]));

  // Per-doc rollups.
  const sharesByDoc = new Map<string, number>();
  for (const s of shares) {
    sharesByDoc.set(s.document_id, (sharesByDoc.get(s.document_id) ?? 0) + 1);
  }
  const lastOpenedByDoc = new Map<string, string>();
  for (const sess of recentSessions) {
    const docId = shareToDoc.get(sess.share_id);
    if (!docId) continue;
    const prev = lastOpenedByDoc.get(docId);
    if (!prev || sess.started_at > prev) {
      lastOpenedByDoc.set(docId, sess.started_at);
    }
  }

  // Top-line stats.
  const totalDocs = docs.length;
  const activeShares = shares.length;
  const readsThisWeek = weeklySessions.length;
  const avgActiveThisWeek = weeklySessions.length
    ? weeklySessions.reduce((acc, s) => acc + (s.active_time_seconds ?? 0), 0) /
      weeklySessions.length
    : 0;

  // A doc shows a "new activity" dot if any session started AFTER the
  // owner last visited that doc's detail page. `last_viewed_by_owner_at`
  // is bumped on every /docs/[id] render (fire-and-forget), so the dot
  // self-clears as soon as the owner opens the doc — no animation, no
  // 24h ticking window, no "still showing yesterday's pulse" feel.
  const lastViewedByDoc = new Map<string, number>();
  for (const d of docs) {
    lastViewedByDoc.set(d.id, new Date(d.last_viewed_by_owner_at ?? d.created_at).getTime());
  }
  const activeDocIds = new Set<string>();
  for (const sess of recentSessions) {
    const docId = shareToDoc.get(sess.share_id);
    if (!docId) continue;
    const cutoff = lastViewedByDoc.get(docId) ?? 0;
    if (new Date(sess.started_at).getTime() > cutoff) activeDocIds.add(docId);
  }

  const hasDocs = totalDocs > 0;

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionMark>Documents</SectionMark>
          <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[44px]">
            Your library.
          </h1>
        </div>
        <Link
          href="/new"
          className="group inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
        >
          New document
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Top-line stat strip — same visual language as the per-doc
          ViewerInsights strip. Renders even on empty libraries so the
          numbers read as "zero so far" rather than absent.

          motion-safe:animate-in adds a soft 300ms opacity fade on
          first paint without count-up theatrics (the numbers should
          land final, not animate). prefers-reduced-motion: ignored
          via Tailwind's motion-safe variant. */}
      <div className="fade-in-soft mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Documents" value={String(totalDocs)} />
        <Stat label="Active shares" value={String(activeShares)} />
        <Stat label="Reads · 7d" value={String(readsThisWeek)} />
        <Stat label="Avg read · 7d" value={formatDuration(avgActiveThisWeek)} />
      </div>

      {!hasDocs ? (
        <EmptyDocs />
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {docs.map((d) => {
            const shareCount = sharesByDoc.get(d.id) ?? 0;
            const lastOpened = lastOpenedByDoc.get(d.id);
            const isActive = activeDocIds.has(d.id);
            return (
              <li key={d.id}>
                <Link
                  href={`/docs/${d.id}`}
                  className="group flex items-center justify-between gap-4 px-5 py-4 transition duration-200 hover:bg-paper-2/40 motion-safe:hover:-translate-y-px"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-3 text-signal-dark">
                      {d.source_type === 'upload' ? (
                        <FileText aria-hidden className="size-4" />
                      ) : (
                        <Link2 aria-hidden className="size-4" />
                      )}
                      {isActive && (
                        <>
                          {/* Outer halo — uses the existing .radar-ring
                              utility (scales 0.4 → 1.0, fades 0 → 0.55 → 0
                              every 4s). The dot itself stays static and
                              load-bearing for the affordance; the halo is
                              ambient. prefers-reduced-motion globally
                              neutralizes the animation via the !important
                              rule in globals.css. */}
                          <span
                            aria-hidden
                            className="radar-ring pointer-events-none absolute -right-1.5 -top-1.5 size-5 rounded-full bg-signal/30"
                          />
                          <span
                            aria-label="New activity since your last visit"
                            title="New activity since your last visit"
                            className="absolute -right-0.5 -top-0.5 inline-flex size-2.5 rounded-full bg-signal ring-2 ring-paper"
                          />
                        </>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-serif text-[18px] text-ink">{d.title}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-graphite">
                        {d.source_type === 'upload' ? 'Uploaded' : 'URL source'} · v
                        {d.current_version} · {new Date(d.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-[12px] tabular-nums text-ink">
                      {shareCount} {shareCount === 1 ? 'share' : 'shares'}
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                      {lastOpened ? formatRelative(lastOpened) : 'no opens yet'}
                    </div>
                  </div>
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-graphite transition group-hover:translate-x-0.5 group-hover:text-signal-dark"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">{label}</div>
      <div className="mt-1.5 font-serif text-[22px] tabular-nums leading-none text-ink">
        {value}
      </div>
    </div>
  );
}

function EmptyDocs() {
  return (
    <div className="relative mt-10 overflow-hidden rounded-2xl border border-dashed border-signal/30 bg-paper px-8 py-14 text-center md:px-12 md:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-60px] top-1/2 -translate-y-1/2 opacity-30"
      >
        <HeroRadar size={260} />
      </div>

      <div className="relative mx-auto max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
          Empty library
        </p>
        <h2 className="text-letterpress mt-4 font-serif text-[28px] leading-[1.1] tracking-tightest text-ink md:text-[34px]">
          Upload your first document.
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          A single HTML file or a URL you already host. Once uploaded, you create per-recipient
          share links and watch reads land in the dashboard.
        </p>
        <Link
          href="/new"
          className="group mt-8 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
        >
          Upload an HTML file
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
