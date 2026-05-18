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
import { ChevronRight, FileText, Link2 } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import type { Viewer, Session, SectionEvent } from '@/lib/types';
import { isMetaSectionTitle } from '@/lib/section-filter';
import { Chip } from '@/components/doc-dashboard/Chip';
import { SectionHead } from '@/components/doc-dashboard/SectionHead';
import {
  createShareAction,
  toggleShareAction,
  deleteDocumentAction,
  deleteShareAction,
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
import { VersionHistoryPopover, type DocumentVersionRow } from './VersionHistoryPopover';

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
    share_deleted?: string;
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

  // Clear the "new activity since last visit" dot on the /docs list
  // (a designer QA3 #9). Updating last_viewed_by_owner_at to now()
  // means a subsequent /docs query sees no sessions-after-this-stamp
  // and the dot disappears for this doc.
  //
  // Awaited because Edge runtime can terminate the worker as soon as
  // the response is built, dropping unawaited promises — that left the
  // dot stuck-on for some docs in dev. A single indexed UPDATE-by-id
  // is sub-10ms; the cost is negligible vs. correctness.
  await supabase
    .from('documents')
    .update({ last_viewed_by_owner_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('owner_id', doc.owner_id);

  // Parallelise the share + attachment + version-history queries —
  // they're independent and all feed the page render. Version history
  // backs the v{n} chip popover in the hero.
  const [sharesRes, attachmentsRes, versionsRes] = await Promise.all([
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
    supabase
      .from('document_versions')
      .select('id, version, filename, bytes, source_type, source_url, replaced_at')
      .eq('document_id', params.id)
      .order('version', { ascending: false }),
  ]);
  const rawShares = sharesRes.data;
  const attachments: AttachmentRow[] = (attachmentsRes.data ?? []) as AttachmentRow[];
  const versions: DocumentVersionRow[] = (versionsRes.data ?? []) as DocumentVersionRow[];

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
    // Per-share lock-the-deck flag. Defaults to TRUE in the DB
    // (post migration 015 — flipped semantic). When true: deck
    // save/print/screenshot blocked + per-viewer watermark applied
    // by the proxy. When false: deck saveable. Attachments are NOT
    // gated by this flag — they're always available to the recipient
    // when present.
    lock_deck: Boolean(s.lock_deck ?? true),
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

  // "Reading now" — anyone heartbeated within the last 60s? Uses the
  // FULL session list (not visibleSessions) on purpose: a sender's own
  // test-read should also surface the live chip so they can verify the
  // share is working. internal-viewer filtering only matters for the
  // aggregate stat strip + viewer table.
  const now = Date.now();
  const liveReaders = allSessions.filter((s) => {
    const hb = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
    return hb > 0 && now - hb < 60_000;
  }).length;

  return (
    <div className="py-8">
      {/* Breadcrumb — replaces the old "← All documents" link. Editorial
          slash-separator pattern matches the rest of the dashboard's
          mono-kicker treatment. Visually quieter than a back-arrow so
          the hero title gets the eye first. */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite"
      >
        <Link href="/docs" className="hover:text-signal-dark">
          Documents
        </Link>
        <ChevronRight aria-hidden className="size-3 opacity-50" />
        <span className="max-w-[40ch] truncate normal-case tracking-normal text-ink-soft">
          {doc.title}
        </span>
      </nav>

      {/* Hero. Editorial-press composition: oversized serif title, mono
          kicker chips below, action cluster on the right. The Live chip
          (pistachio + pulsing dot) only renders when at least one
          recipient is actively heartbeating — silent the rest of the
          time so the chip row doesn't have a permanent attention-grabber. */}
      <header className="mt-6 flex flex-col gap-7 border-b border-line pb-8 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="min-w-0 flex-1">
          <h1
            title={doc.title}
            className="text-letterpress font-serif text-[26px] font-normal leading-[1.15] tracking-tight text-ink md:text-[32px] lg:text-[36px]"
          >
            {doc.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {liveReaders > 0 && (
              <Chip variant="live">
                {liveReaders === 1 ? '1 reading now' : `${liveReaders} reading now`}
              </Chip>
            )}
            <Chip
              icon={
                doc.source_type === 'upload' ? (
                  <FileText className="size-3 text-signal-dark" />
                ) : (
                  <Link2 className="size-3 text-signal-dark" />
                )
              }
            >
              {doc.source_type === 'upload' ? 'Uploaded HTML' : 'URL source'}
            </Chip>
            <VersionHistoryPopover currentVersion={doc.current_version} versions={versions} />
            <LiveRefresh />
          </div>
          {/* Hero stat strip was deliberately removed — the ViewerInsights
              glance grid below shows the same numbers with richer framing
              and visible-only semantics. Duplicating them in the hero
              created two read-time numbers on the same eye-line (avg here
              vs max below) that fought each other. */}
          {doc.source_type === 'url' && doc.source_url && (
            <a
              href={doc.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block max-w-[60ch] truncate font-mono text-[12px] text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal"
            >
              {doc.source_url}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Action cluster. PreviewDocumentButton stays the visual
              primary (filled), ReplaceDocumentButton is ghost, Delete is
              text — same order as a designer's ref but using the existing
              component implementations to avoid regressing their server-
              action wiring and confirmation flows. */}
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
          Share settings updated. All visitors to this link now see the new rules.
        </div>
      )}
      {searchParams?.share_deleted === '1' && (
        <div
          role="status"
          className="mt-6 rounded-md border border-signal/30 bg-signal/5 px-4 py-3 text-[14px] leading-relaxed text-signal-dark"
        >
          Share deleted. The URL now returns Not Found.
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

      {/* Single-column stack — Shares above, Analytics below. The
          Batch-F "outer master-detail" overlapped at every laptop
          width because grid items without min-w-0 collapsed the
          SharePane; the simpler stack is what worked before and
          what users actually scan top-to-bottom anyway. The inner
          DocumentShareManager keeps its own rail+pane master-detail
          at 2xl+ for very wide screens. */}
      <div className="mt-10 space-y-12">
        <section>
          <SectionHead
            title="Shares."
            hint={`${shares.length} ${shares.length === 1 ? 'share' : 'shares'} · per-recipient settings`}
          />
          <DocumentShareManager
            documentId={doc.id}
            shares={shares}
            analyticsByShareId={analyticsByShareId}
            createShare={createShareAction}
            toggleShare={toggleShareAction}
            editShare={editShareAction}
            deleteShare={deleteShareAction}
            previewShare={previewShareAction}
            attachmentCount={attachments.length}
          />
        </section>

        <section className="space-y-8">
          <ViewerInsights
            viewers={allViewers}
            sessions={allSessions}
            events={allEvents}
            documentId={doc.id}
            shareSlugs={Object.fromEntries(shareList.map((s) => [s.id, s.slug]))}
            shareLabels={Object.fromEntries(shareList.map((s) => [s.id, s.recipient_label]))}
            toggleInternal={toggleViewerInternalAction}
          />
          <SharesTable shares={shares} analyticsByShareId={analyticsByShareId} />
        </section>
      </div>

      {/* Attachments stay full-width below the two-column body. Doc-level
          asset; not specific to a single share. (Batch A will rework the
          attachments UX itself — recipient-side pill + per-viewer
          download tracking — but the layout placement stays here.) */}
      <div className="mt-12">
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
