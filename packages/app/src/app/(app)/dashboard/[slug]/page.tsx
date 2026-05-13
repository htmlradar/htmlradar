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

export const runtime = 'edge';

export default async function ShareAnalyticsPage({ params }: { params: { slug: string } }) {
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

  const sessionList = sessions ?? [];
  const sessionIds = sessionList.map((s) => s.id);
  const sessionToViewer = new Map<string, string>(sessionList.map((s) => [s.id, s.viewer_id]));

  const sectionMap = new Map<
    string,
    { title: string; totalSeconds: number; viewerIds: Set<string> }
  >();
  if (sessionIds.length > 0) {
    const { data: events } = await supabase
      .from('section_events')
      .select('section_id, section_title, time_seconds, session_id')
      .in('session_id', sessionIds);
    for (const e of events ?? []) {
      const cur = sectionMap.get(e.section_id) ?? {
        title: e.section_title ?? e.section_id,
        totalSeconds: 0,
        viewerIds: new Set<string>(),
      };
      cur.totalSeconds += e.time_seconds;
      const vId = sessionToViewer.get(e.session_id);
      if (vId) cur.viewerIds.add(vId);
      sectionMap.set(e.section_id, cur);
    }
  }
  const sections = [...sectionMap.entries()]
    .map(([id, v]) => ({
      id,
      title: v.title,
      totalSeconds: v.totalSeconds,
      viewers: v.viewerIds.size,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  const recipient = share.recipient_label ?? 'Unlabeled share';
  const fullUrl = `htmlradar.com/r/${share.slug}`;

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
          viewers={viewers ?? []}
          sessions={sessionList}
          sections={sections}
        />
      </div>
    </div>
  );
}
