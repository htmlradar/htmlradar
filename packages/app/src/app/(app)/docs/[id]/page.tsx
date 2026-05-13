// /docs/[id] — Document detail + share management (master-detail layout).
//
// Pattern: list of shares on the left (compact, ~320px), analytics for the
// selected share on the right. Same pattern DocSend / Papermark / Pitch
// use. "+ New share" lives at the top of the left rail; selecting it
// renders the create form in the right pane.
//
// This page is a Server Component that does all the data fetching, then
// hands off to <DocumentShareManager /> (client) for the interactive
// state — which share is selected, whether the new-share form is open.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, Link2 } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import type { Viewer, Session, SectionEvent } from '@/lib/types';
import { createShareAction, toggleShareAction, deleteDocumentAction } from './actions';
import {
  DocumentShareManager,
  type ShareRow,
  type ShareAnalyticsData,
} from './DocumentShareManager';
import { DeleteDocumentButton } from './DeleteDocumentButton';

export const runtime = 'edge';

export default async function DocumentPage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = serverClient();

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single();
  if (!doc) notFound();

  const { data: rawShares } = await supabase
    .from('document_shares')
    .select('*')
    .eq('document_id', params.id)
    .order('created_at', { ascending: false });

  const shareList = rawShares ?? [];
  const shareIds = shareList.map((s) => s.id);

  // Single batch of three queries, regardless of how many shares.
  const [viewersRes, sessionsRes] = shareIds.length
    ? await Promise.all([
        supabase.from('viewers').select('*').in('share_id', shareIds),
        supabase
          .from('sessions')
          .select('*')
          .in('share_id', shareIds)
          .order('started_at', { ascending: false }),
      ])
    : [{ data: [] as Viewer[] }, { data: [] as Session[] }];
  const allViewers = (viewersRes.data ?? []) as Viewer[];
  const allSessions = (sessionsRes.data ?? []) as Session[];

  const sessionIds = allSessions.map((s) => s.id);
  const eventsRes = sessionIds.length
    ? await supabase
        .from('section_events')
        .select('section_id, section_title, time_seconds, session_id')
        .in('session_id', sessionIds)
    : { data: [] as SectionEvent[] };
  const allEvents = (eventsRes.data ?? []) as SectionEvent[];

  // Pre-compute everything per share so the client component just renders.
  const sessionToShare = new Map<string, string>(allSessions.map((s) => [s.id, s.share_id]));
  const viewersByShare: Record<string, Viewer[]> = {};
  for (const v of allViewers) {
    (viewersByShare[v.share_id] ??= []).push(v);
  }
  const sessionsByShare: Record<string, Session[]> = {};
  for (const s of allSessions) {
    (sessionsByShare[s.share_id] ??= []).push(s);
  }

  const shares: ShareRow[] = shareList.map((s) => ({
    id: s.id,
    slug: s.slug,
    recipient_label: s.recipient_label,
    require_email: s.require_email,
    require_password: s.require_password,
    expires_at: s.expires_at,
    revoked_at: s.revoked_at,
    viewCount: sessionsByShare[s.id]?.length ?? 0,
  }));

  const analyticsByShareId: Record<string, ShareAnalyticsData> = {};
  for (const s of shareList) {
    const shareSessions = sessionsByShare[s.id] ?? [];
    const sessionToViewer = new Map<string, string>(
      shareSessions.map((sess) => [sess.id, sess.viewer_id]),
    );
    const sectionMap = new Map<
      string,
      { title: string; totalSeconds: number; viewerIds: Set<string> }
    >();
    for (const e of allEvents) {
      if (sessionToShare.get(e.session_id) !== s.id) continue;
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
    const sections = [...sectionMap.entries()]
      .map(([id, v]) => ({
        id,
        title: v.title,
        totalSeconds: v.totalSeconds,
        viewers: v.viewerIds.size,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    analyticsByShareId[s.id] = {
      viewers: viewersByShare[s.id] ?? [],
      sessions: shareSessions,
      sections,
    };
  }

  return (
    <div className="py-8">
      <Link
        href="/docs"
        className="link-slide inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
      >
        <ArrowLeft className="size-3.5" />
        All documents
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-letterpress break-words font-serif text-[34px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[42px]">
            {doc.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            <span className="inline-flex items-center gap-1.5">
              {doc.source_type === 'upload' ? (
                <FileText aria-hidden className="size-3.5 text-signal-dark" />
              ) : (
                <Link2 aria-hidden className="size-3.5 text-signal-dark" />
              )}
              {doc.source_type === 'upload' ? 'Uploaded HTML' : 'URL source'}
            </span>
            <span aria-hidden>·</span>
            <span>v{doc.current_version}</span>
            {doc.source_type === 'url' && doc.source_url && (
              <>
                <span aria-hidden>·</span>
                <a
                  href={doc.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[40ch] truncate normal-case tracking-normal text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal"
                >
                  {doc.source_url}
                </a>
              </>
            )}
          </div>
        </div>
        <DeleteDocumentButton
          documentId={doc.id}
          documentTitle={doc.title}
          shareCount={shares.length}
          action={deleteDocumentAction}
        />
      </header>

      <div className="mt-8">
        <DocumentShareManager
          documentId={doc.id}
          shares={shares}
          analyticsByShareId={analyticsByShareId}
          createShare={createShareAction}
          toggleShare={toggleShareAction}
        />
      </div>
    </div>
  );
}
