// Per-share analytics page. Reachable as a direct link (e.g. someone
// bookmarks /dashboard/<slug>). The same view is also expanded inline
// on /docs/[id], which is the primary flow. This page exists so the URL
// works if shared / linked.
//
// Hierarchy on this page:
//   1. Back link → /docs/[id]  (this is the ONLY arrow on the page,
//      to avoid the "two arrows in close proximity" confusion the
//      SectionMark wedge created in the prior design)
//   2. H1 = recipient label (because THIS page is about this share —
//      the doc title is one level up)
//   3. Meta row: parent document title (linked) + share URL + copy
//   4. ShareAnalytics — real stats if any sessions, else "waiting"
//
// Section viewers count distinct viewer_ids, not raw event rows.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { ShareAnalytics } from '@/components/ShareAnalytics';
import { CopySlugButton } from '@/components/CopySlugButton';
import { isMetaSectionTitle } from '@/lib/section-filter';
import { SHARE_HOST } from '@/lib/share-url';

export const runtime = 'edge';

export default async function ShareAnalyticsPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { just_created?: string };
}) {
  await requireUser();
  const supabase = serverClient();

  // If the parent document was soft-deleted, treat as 404 so users
  // can't drill into orphan share analytics (the back-link to /docs/[id]
  // would dead-end anyway).
  const { data: share } = await supabase
    .from('document_shares')
    .select('*, documents!inner(title, deleted_at)')
    .eq('slug', params.slug)
    .is('documents.deleted_at', null)
    .single();
  if (!share) notFound();
  const docTitle = Array.isArray(share.documents)
    ? (share.documents[0] as { title: string } | undefined)?.title
    : (share.documents as unknown as { title: string } | null)?.title;

  const { data: viewers } = await supabase.from('viewers').select('*').eq('share_id', share.id);
  const { data: sessions } = await supabase
    .from('sessions')
    .select('*')
    .eq('share_id', share.id)
    .order('started_at', { ascending: false });

  // Hide internal viewers (owner self-views + @htmlradar staff, flagged via
  // viewers.is_internal) so this per-share drill-in matches /docs/[id], which
  // excludes them from its headline stats. Without this, clicking a share row
  // from the document page reintroduces reads that page intentionally hid.
  const internalViewerIds = new Set(
    (viewers ?? []).filter((v) => v.is_internal === true).map((v) => v.id),
  );
  const visibleViewers = (viewers ?? []).filter((v) => !internalViewerIds.has(v.id));

  // Phantom-session filter (mirrors /docs/[id]/page.tsx). Drop sessions
  // where bounced=true AND active_time_seconds=0 AND max_scroll_depth=0
  // — tracker ghosts that inflated visit counts. Also drop internal viewers'
  // sessions so the stats below match the visible viewer set.
  const sessionList = (sessions ?? []).filter(
    (s) =>
      !internalViewerIds.has(s.viewer_id) &&
      !(
        s.bounced === true &&
        (s.active_time_seconds ?? 0) === 0 &&
        (s.max_scroll_depth ?? 0) === 0
      ),
  );
  const sessionIds = sessionList.map((s) => s.id);
  const sessionToViewer = new Map<string, string>(sessionList.map((s) => [s.id, s.viewer_id]));
  const sessionActiveSeconds = new Map(sessionList.map((s) => [s.id, s.active_time_seconds ?? 0]));

  const sectionMap = new Map<
    string,
    {
      title: string;
      totalSeconds: number;
      viewerIds: Set<string>;
      minOrdinal: number;
    }
  >();
  if (sessionIds.length > 0) {
    const { data: rawEvents } = await supabase
      .from('section_events')
      .select('section_id, section_title, time_seconds, session_id, ordinal')
      .in('session_id', sessionIds);
    // Mirror /docs/[id]/v2's per-share aggregation so the drill-in matches:
    // (1) drop meta/structural "sections" (page numbers, "01 / 14"); and
    // (2) per-session cap — a session's section dwell can't exceed its active
    //     time. Stale pre-fix tracker data over-credited; rescale each
    //     session's events to sum to at most its active_time (current-tracker
    //     sessions already satisfy this, so scale = 1 for them).
    const events = (rawEvents ?? []).filter(
      (e) => !isMetaSectionTitle(e.section_title, e.section_id),
    );
    const sessionEventSum = new Map<string, number>();
    for (const e of events) {
      sessionEventSum.set(e.session_id, (sessionEventSum.get(e.session_id) ?? 0) + e.time_seconds);
    }
    const sessionScale = (sessionId: string): number => {
      const active = sessionActiveSeconds.get(sessionId) ?? 0;
      const sum = sessionEventSum.get(sessionId) ?? 0;
      return sum > active && sum > 0 ? active / sum : 1;
    };
    for (const e of events) {
      const cur = sectionMap.get(e.section_id) ?? {
        title: e.section_title ?? e.section_id,
        totalSeconds: 0,
        viewerIds: new Set<string>(),
        minOrdinal: Number.POSITIVE_INFINITY,
      };
      cur.totalSeconds += e.time_seconds * sessionScale(e.session_id);
      const vId = sessionToViewer.get(e.session_id);
      if (vId) cur.viewerIds.add(vId);
      if (typeof e.ordinal === 'number' && e.ordinal < cur.minOrdinal) {
        cur.minOrdinal = e.ordinal;
      }
      sectionMap.set(e.section_id, cur);
    }
  }
  const sections = [...sectionMap.entries()]
    .map(([id, v]) => ({
      id,
      title: v.title,
      totalSeconds: v.totalSeconds,
      viewers: v.viewerIds.size,
      ordinal: Number.isFinite(v.minOrdinal) ? v.minOrdinal : null,
    }))
    // Deck order — narrative reads the way the sender wrote it,
    // not by time-spent desc. Sections without ordinal fall to the end.
    .sort((a, b) => {
      if (a.ordinal == null && b.ordinal == null) return 0;
      if (a.ordinal == null) return 1;
      if (b.ordinal == null) return -1;
      return a.ordinal - b.ordinal;
    });

  const recipient = share.recipient_label ?? 'Unlabeled share';
  const shareStatus = share.revoked_at
    ? ('revoked' as const)
    : share.expires_at && new Date(share.expires_at) < new Date()
      ? ('expired' as const)
      : ('live' as const);
  const fullUrl = `${SHARE_HOST}/r/${share.slug}`;

  return (
    <div className="py-8">
      {/* The one and only arrow on this page — the back link. */}
      <Link
        href={`/docs/${share.document_id}`}
        className="link-slide inline-flex items-center gap-2 text-[14px] text-ink-soft hover:text-signal-dark"
      >
        <ArrowLeft className="size-4" />
        Back to <span className="font-medium text-ink">{docTitle ?? 'document'}</span>
      </Link>

      <h1 className="text-letterpress mt-8 break-words font-serif text-[40px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[52px]">
        {recipient}
      </h1>

      {searchParams?.just_created === '1' && (
        <div className="mt-5 rounded-xl border border-signal/40 bg-signal/5 px-4 py-3 text-[13.5px] leading-relaxed text-ink">
          Share created. Copy the link below and send it to{' '}
          <span className="font-medium">{recipient}</span> — reads appear here as they come in.
        </div>
      )}

      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
        A tracked share of{' '}
        <Link
          href={`/docs/${share.document_id}`}
          className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
        >
          {docTitle ?? 'this document'}
        </Link>
        .
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 md:max-w-2xl">
        <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-ink">{fullUrl}</span>
        <CopySlugButton slug={share.slug} />
      </div>

      <div className="mt-12">
        <ShareAnalytics
          shareSlug={share.slug}
          recipientLabel={share.recipient_label}
          viewers={visibleViewers}
          sessions={sessionList}
          sections={sections}
          shareStatus={shareStatus}
        />
      </div>
    </div>
  );
}
