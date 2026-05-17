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
import { isMetaSectionTitle } from '@/lib/section-filter';
import {
  createShareAction,
  toggleShareAction,
  deleteDocumentAction,
  editShareAction,
  previewShareAction,
  previewDocumentAction,
  uploadAttachmentsAction,
  deleteAttachmentAction,
  replaceDocumentAction,
  toggleViewerInternalAction,
} from './actions';
import {
  DocumentShareManager,
  type ShareRow,
  type ShareAnalyticsData,
} from './DocumentShareManager';
import { DeleteDocumentButton } from './DeleteDocumentButton';
import { ReplaceDocumentButton } from './ReplaceDocumentButton';
import { PreviewDocumentButton } from './PreviewDocumentButton';
import { LiveRefresh } from './LiveRefresh';
import { SharesTable } from './SharesTable';
import { ViewerInsights } from './ViewerInsights';
import { AttachmentsPanel, type AttachmentRow } from './AttachmentsPanel';

export const runtime = 'edge';

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: {
    share_error?: string;
    delete_error?: string;
    attachment_error?: string;
    preview_error?: string;
    replace_error?: string;
    replaced?: string;
    hide_error?: string;
    edited?: string;
  };
}) {
  await requireUser();
  const supabase = serverClient();

  const shareError = searchParams?.share_error
    ? decodeURIComponent(searchParams.share_error)
    : null;
  const deleteError = searchParams?.delete_error
    ? decodeURIComponent(searchParams.delete_error)
    : null;
  const previewError = searchParams?.preview_error
    ? decodeURIComponent(searchParams.preview_error)
    : null;
  const replaceError = searchParams?.replace_error
    ? decodeURIComponent(searchParams.replace_error)
    : null;
  const replacedFlash = searchParams?.replaced === '1';
  const hideError = searchParams?.hide_error ? decodeURIComponent(searchParams.hide_error) : null;
  // ?edited=<shareId> is set by editShareAction on success. Page renders
  // a brief "Share updated" banner so the user knows the save took
  // effect — without it, edit + save felt like a no-op (QA2 #8).
  const editedShareId = searchParams?.edited ?? null;

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single();
  if (!doc) notFound();

  // Parallelise the share + attachment queries — they're independent and
  // both feed the page render.
  const [sharesRes, attachmentsRes] = await Promise.all([
    supabase
      .from('document_shares')
      .select('*')
      .eq('document_id', params.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('document_attachments')
      .select('id, filename, mime_type, size_bytes, created_at')
      .eq('document_id', params.id)
      .order('created_at', { ascending: true }),
  ]);
  const rawShares = sharesRes.data;
  const attachments: AttachmentRow[] = (attachmentsRes.data ?? []) as AttachmentRow[];

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
  // Belt-and-suspenders alongside migration 011: if a viewer is still on
  // a cached old tracker bundle, any meta-text rows they POST get
  // filtered at read time. Once the migration runs and all caches
  // expire, this filter is a no-op.
  const allEvents = ((eventsRes.data ?? []) as SectionEvent[]).filter(
    (e) => !isMetaSectionTitle(e.section_title, e.section_id),
  );

  // Per-share buckets feed the Sessions list, share row "view count",
  // and the section roll-up under each share tile. These surfaces are
  // for "real" prospects only — internal viewers (test reads, owner-
  // self, staff) get filtered out here so they don't clutter the
  // session log, view counter, or section dwell numbers under each
  // share. The top ViewerInsights table still receives all viewers
  // and handles the "Show hidden (N)" toggle locally.
  const internalViewerIds = new Set(allViewers.filter((v) => v.is_internal).map((v) => v.id));
  const visibleViewers = allViewers.filter((v) => !internalViewerIds.has(v.id));
  const visibleSessions = allSessions.filter((s) => !internalViewerIds.has(s.viewer_id));
  const sessionToShare = new Map<string, string>(visibleSessions.map((s) => [s.id, s.share_id]));
  const viewersByShare: Record<string, Viewer[]> = {};
  for (const v of visibleViewers) {
    (viewersByShare[v.share_id] ??= []).push(v);
  }
  const sessionsByShare: Record<string, Session[]> = {};
  for (const s of visibleSessions) {
    (sessionsByShare[s.share_id] ??= []).push(s);
  }

  const shares: ShareRow[] = shareList.map((s) => ({
    id: s.id,
    slug: s.slug,
    recipient_label: s.recipient_label,
    require_email: s.require_email,
    require_password: s.require_password,
    // Domain + email allowlists are part of the share row so the Edit
    // form can pre-fill them without an extra query round-trip.
    allowed_email_domains: (s.allowed_email_domains as string[] | null) ?? null,
    allowed_emails: (s.allowed_emails as string[] | null) ?? null,
    // Per-share download permission for supporting materials (Sprint B).
    // Defaults to false in the DB; the share form's checkbox controls it.
    allow_download: Boolean(s.allow_download),
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
            <span aria-hidden>·</span>
            <LiveRefresh />
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
        <div className="flex flex-wrap items-center gap-2.5">
          {/* "Preview document" — sender-side raw-doc preview, no share.
              Sits left of Delete so the destructive action is last in the
              tab order and visually. Only useful for upload-type docs;
              for URL-type docs we surface the source URL inline above
              instead (clicking it opens the source directly). */}
          {doc.source_type === 'upload' && (
            <>
              <PreviewDocumentButton documentId={doc.id} action={previewDocumentAction} />
              <ReplaceDocumentButton documentId={doc.id} action={replaceDocumentAction} />
            </>
          )}
          <DeleteDocumentButton
            documentId={doc.id}
            documentTitle={doc.title}
            shareCount={shares.length}
            action={deleteDocumentAction}
          />
        </div>
      </header>

      {shareError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Couldn't create the share: {shareError}
        </div>
      )}
      {deleteError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Couldn't delete this document: {deleteError}
        </div>
      )}
      {previewError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Preview couldn't open: {previewError}
        </div>
      )}
      {replaceError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Couldn't replace the document: {replaceError}
        </div>
      )}
      {hideError && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Couldn't update the viewer: {hideError}
        </div>
      )}
      {replacedFlash && (
        <div
          role="status"
          className="mt-6 rounded-md border border-signal/30 bg-signal/5 px-4 py-3 text-[14px] leading-relaxed text-signal-dark"
        >
          New version saved. All existing share links now serve v{doc.current_version}.
        </div>
      )}
      {editedShareId && (
        <div
          role="status"
          className="mt-6 rounded-md border border-signal/30 bg-signal/5 px-4 py-3 text-[14px] leading-relaxed text-signal-dark"
        >
          Share settings updated. The next visitor to this link sees the new rules.
        </div>
      )}
      {searchParams?.attachment_error && (
        <div
          role="alert"
          className="mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert"
        >
          Attachment problem: {decodeURIComponent(searchParams.attachment_error)}
        </div>
      )}

      <div className="mt-8 space-y-8">
        {/* Order matters: HTML doc + its shares are the primary surface.
            Attachments are deliberately demoted to the bottom — they're
            optional supplements, not a parallel concept. Empty state is
            a one-line CTA so the panel doesn't compete with the share
            manager for attention when the user has no attachments yet. */}
        <ViewerInsights
          viewers={allViewers}
          sessions={allSessions}
          events={allEvents}
          documentId={doc.id}
          toggleInternal={toggleViewerInternalAction}
        />

        <SharesTable shares={shares} analyticsByShareId={analyticsByShareId} />

        <DocumentShareManager
          documentId={doc.id}
          shares={shares}
          analyticsByShareId={analyticsByShareId}
          createShare={createShareAction}
          toggleShare={toggleShareAction}
          editShare={editShareAction}
          previewShare={previewShareAction}
          attachmentCount={attachments.length}
        />

        <AttachmentsPanel
          documentId={doc.id}
          attachments={attachments}
          uploadAction={uploadAttachmentsAction}
          deleteAction={deleteAttachmentAction}
        />
      </div>
    </div>
  );
}
