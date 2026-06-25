// /docs/[id]/v2 — Three-tab document view (Sharing / Analytics / Versions).
//
// PARALLEL ROUTE under /docs/[id]/v2 — the existing /docs/[id] page is
// untouched. Stage A: header + sticky tab bar with URL state and
// placeholder tab content. The placeholders show real counts so the
// preview looks intentional rather than half-finished.
//
// Stage B fills in the Sharing tab (DocumentShareManager + attachments
// inline inside share cards). Stage C fills in Analytics + Versions.
// Heavier data shapes (analyticsByShareId, sectionMap roll-ups) are NOT
// computed in Stage A — adding them now would pay edge cold-start cost
// for nothing. They come back when their tab needs them.
//
// Layout note: AppLayout already wraps in `px-6 py-8`, so this page
// uses `pb-16` only to add bottom breathing room without double-padding
// the top.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, FileText, Link2 } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { logServerError } from '@/lib/error-log';
import { Chip } from '@/components/doc-dashboard/Chip';
import {
  previewDocumentAction,
  replaceDocumentAction,
  deleteDocumentAction,
  previewShareAction,
  editShareAction,
  createShareAction,
  toggleShareAction,
  deleteShareAction,
  uploadAttachmentsAction,
  deleteAttachmentAction,
  toggleViewerInternalAction,
} from '../actions';
import { AttachmentsPanel, type AttachmentRow } from '../AttachmentsPanel';
import type { SectionTotal } from './SectionTimeBarChart';
import { DeleteDocumentButton } from '../DeleteDocumentButton';
import { ReplaceDocumentButton } from '../ReplaceDocumentButton';
import { PreviewDocumentButton } from '../PreviewDocumentButton';
import { LiveRefresh } from '../LiveRefresh';
import { VersionHistoryPopover, type DocumentVersionRow } from '../VersionHistoryPopover';
import { DocTabsClient } from './DocTabsClient';
import { normalizeTab, type TabKey } from './tab-key';
import { type ShareRow, type ShareAnalyticsData } from '../DocumentShareManager';
import type { Viewer, Session, SectionEvent } from '@/lib/types';
import { isMetaSectionTitle } from '@/lib/section-filter';
import { countDistinctViewers } from '@/lib/viewer-metrics';
import { readQuota } from '@/lib/quota';

export const runtime = 'edge';

export default async function DocumentPageV2(props: {
  params: { id: string };
  searchParams?: {
    tab?: string;
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
  // Wrap the entire render so any exception lands in app_error_log
  // with the document id + stage marker — otherwise the user just
  // sees error.tsx with a hash and we have no idea what broke.
  try {
    return await renderV2(props);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    const stack = e instanceof Error ? e.stack?.slice(0, 1500) : null;
    await logServerError({
      source: 'docs.v2.render',
      message: msg,
      route: `/docs/${props.params.id}/v2`,
      context: { stack, stage: 'A' },
    });
    throw e; // re-throw so Next.js renders error.tsx as before
  }
}

async function renderV2({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: {
    tab?: string;
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
  const user = await requireUser();
  const supabase = serverClient();

  // Free-tier link-cap state for the share-creation gate (pricing v4). null for
  // pro (unlimited); { used, cap } for free, counted lifetime by owner.
  const quota = await readQuota(supabase, user.id);
  const freeShareCap = quota.tier === 'free' ? { used: quota.used, cap: quota.cap } : null;

  const banners = collectBanners(searchParams ?? {});
  const initialTab: TabKey = normalizeTab(searchParams?.tab);

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', params.id)
    .is('deleted_at', null)
    .single();
  if (!doc) notFound();

  // Mark "new activity since last visit" cleared on /docs list.
  await supabase
    .from('documents')
    .update({ last_viewed_by_owner_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('owner_id', doc.owner_id);

  // Stage A only needs: share count, version count, viewer count, plus
  // booleans for empty-state branching, plus the liveReaders chip. The
  // full analytics pipeline (analyticsByShareId, per-section roll-ups)
  // is deferred to Stage C when its tab needs it.
  // Full share row fetch so the Sharing tab can render cards with all
  // settings + analytics roll-ups; same shape the live page uses.
  const [sharesRes, versionsRes, attachmentsRes] = await Promise.all([
    supabase
      .from('document_shares')
      .select('*')
      .eq('document_id', params.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('document_versions')
      .select('id, version, filename, bytes, source_type, source_url, replaced_at')
      .eq('document_id', params.id)
      .order('version', { ascending: false }),
    supabase
      .from('document_attachments')
      .select('id, filename, mime_type, size_bytes, created_at')
      .eq('document_id', params.id)
      .order('created_at', { ascending: true }),
  ]);
  const rawShares = sharesRes.data ?? [];
  const shareIds = rawShares.map((s) => s.id);
  const versions: DocumentVersionRow[] = (versionsRes.data ?? []) as DocumentVersionRow[];
  const attachments: AttachmentRow[] = (attachmentsRes.data ?? []) as AttachmentRow[];

  // Full data fetch (viewers/sessions/section events) — same Promise.all
  // pattern as live page. Used by ShareRow analytics + the live-readers
  // chip + the per-share viewer counts that show on each card.
  let viewerCount = 0;
  let hasOpens = false;
  let liveReaders = 0;
  let allViewers: Viewer[] = [];
  let allSessions: Session[] = [];
  let allEvents: SectionEvent[] = [];
  let visibleSessions: Session[] = [];
  if (shareIds.length) {
    const [viewersRes, sessionsRes] = await Promise.all([
      supabase.from('viewers').select('*').in('share_id', shareIds),
      supabase
        .from('sessions')
        .select('*')
        .in('share_id', shareIds)
        .order('started_at', { ascending: false }),
    ]);
    allViewers = (viewersRes.data ?? []) as Viewer[];
    allSessions = (sessionsRes.data ?? []) as Session[];

    const sessionIds = allSessions.map((s) => s.id);
    const eventsRes = sessionIds.length
      ? await supabase
          .from('section_events')
          .select('section_id, section_title, time_seconds, session_id, ordinal')
          .in('session_id', sessionIds)
      : { data: [] as SectionEvent[] };
    allEvents = ((eventsRes.data ?? []) as SectionEvent[]).filter(
      (e) => !isMetaSectionTitle(e.section_title, e.section_id),
    );

    const internalViewerIds = new Set(allViewers.filter((v) => v.is_internal).map((v) => v.id));
    const visibleViewers = allViewers.filter((v) => !internalViewerIds.has(v.id));
    visibleSessions = allSessions.filter(
      (s) =>
        !internalViewerIds.has(s.viewer_id) &&
        !(
          s.bounced === true &&
          (s.active_time_seconds ?? 0) === 0 &&
          (s.max_scroll_depth ?? 0) === 0
        ),
    );

    viewerCount = countDistinctViewers(visibleViewers);
    hasOpens = visibleSessions.length > 0;

    const now = Date.now();
    const live = allSessions.filter((s) => {
      const hb = s.last_heartbeat_at ? new Date(s.last_heartbeat_at).getTime() : 0;
      return hb > 0 && now - hb < 60_000;
    });
    const viewersById = new Map(allViewers.map((v) => [v.id, v]));
    const keys = new Set<string>();
    for (const s of live) {
      const v = viewersById.get(s.viewer_id);
      keys.add(v?.email?.trim().toLowerCase() || s.viewer_id);
    }
    liveReaders = keys.size;
  }

  // Build shares + analyticsByShareId — same shape DocumentShareManager
  // uses on the live page, kept identical so ShareCardList stays a pure
  // visual swap with zero server-side behaviour change.
  const sessionToShare = new Map<string, string>(visibleSessions.map((s) => [s.id, s.share_id]));
  const sessionsByShare: Record<string, Session[]> = {};
  for (const s of visibleSessions) {
    (sessionsByShare[s.share_id] ??= []).push(s);
  }
  const viewersByShare: Record<string, Viewer[]> = {};
  for (const v of allViewers) {
    if (!v.is_internal) (viewersByShare[v.share_id] ??= []).push(v);
  }

  const shares: ShareRow[] = rawShares.map((s) => ({
    id: s.id,
    slug: s.slug,
    recipient_label: s.recipient_label,
    require_email: s.require_email,
    require_password: s.require_password,
    allowed_email_domains: (s.allowed_email_domains as string[] | null) ?? null,
    allowed_emails: (s.allowed_emails as string[] | null) ?? null,
    lock_deck: Boolean(s.lock_deck ?? true),
    expires_at: s.expires_at,
    revoked_at: s.revoked_at,
    viewCount: sessionsByShare[s.id]?.length ?? 0,
  }));

  // Aggregate section totals for the doc-level chart.
  //
  // Two filters that the prior version missed and produced the
  // 309-min / duplicate-bars regression on the v2 Analytics tab:
  //
  // 1. Keep only events from visibleSessions (internal viewers and
  //    phantom/bounced sessions otherwise dominate every bar — the
  //    owner re-reading their own deck during dev showed up as a
  //    125-min "The Decade" bar with no real reader on it).
  // 2. Key on the normalized section TITLE, not section_id. Across
  //    deck versions the same titled section gets a fresh DOM id
  //    (slide-9 → slide-12 → slide-30), so keying by id rendered
  //    "Why We Win / Roadmap / Team" as three duplicate bars instead
  //    of one. Sections without a title fall back to id (can't merge
  //    unknowns safely).
  const visibleSessionIds = new Set(visibleSessions.map((s) => s.id));

  // Per-session cap. A session's section dwell can never exceed the time the
  // session was actually active. Sessions recorded by an older tracker (before
  // the normalized viewport-coverage fix) over-credited — their section
  // time_seconds can sum to 2–3x the session's active_time. Rescale each
  // session's events proportionally so its sections sum to at most its
  // active_time, then aggregate. Current-tracker sessions already satisfy this
  // (scale = 1), so this only corrects stale pre-fix data on the chart.
  const sessionActiveSeconds = new Map(
    visibleSessions.map((s) => [s.id, s.active_time_seconds ?? 0]),
  );
  const sessionEventSum = new Map<string, number>();
  for (const e of allEvents) {
    if (!visibleSessionIds.has(e.session_id)) continue;
    sessionEventSum.set(e.session_id, (sessionEventSum.get(e.session_id) ?? 0) + e.time_seconds);
  }
  const sessionScale = (sessionId: string): number => {
    const active = sessionActiveSeconds.get(sessionId) ?? 0;
    const sum = sessionEventSum.get(sessionId) ?? 0;
    return sum > active && sum > 0 ? active / sum : 1;
  };

  const sectionAgg = new Map<
    string,
    { id: string; title: string; totalSeconds: number; minOrdinal: number }
  >();
  for (const e of allEvents) {
    if (!visibleSessionIds.has(e.session_id)) continue;
    const title = (e.section_title ?? e.section_id).trim();
    const key = title ? title.toLowerCase() : e.section_id;
    const cur = sectionAgg.get(key) ?? {
      id: e.section_id,
      title: title || e.section_id,
      totalSeconds: 0,
      minOrdinal: Number.POSITIVE_INFINITY,
    };
    cur.totalSeconds += e.time_seconds * sessionScale(e.session_id);
    if (typeof e.ordinal === 'number' && e.ordinal < cur.minOrdinal) {
      cur.minOrdinal = e.ordinal;
    }
    sectionAgg.set(key, cur);
  }
  const sectionTotals: SectionTotal[] = [...sectionAgg.entries()]
    .map(([key, v]) => ({
      id: key,
      title: v.title,
      totalSeconds: v.totalSeconds,
      ordinal: Number.isFinite(v.minOrdinal) ? v.minOrdinal : null,
    }))
    .sort((a, b) => {
      if (a.ordinal == null && b.ordinal == null) return 0;
      if (a.ordinal == null) return 1;
      if (b.ordinal == null) return -1;
      return a.ordinal - b.ordinal;
    });

  // Per-share id → slug + recipient_label maps for ViewerInsights.
  const shareSlugs = Object.fromEntries(rawShares.map((s) => [s.id, s.slug]));
  const shareLabels = Object.fromEntries(rawShares.map((s) => [s.id, s.recipient_label]));

  const analyticsByShareId: Record<string, ShareAnalyticsData> = {};
  for (const s of rawShares) {
    const shareSessions = sessionsByShare[s.id] ?? [];
    const sessionToViewer = new Map<string, string>(
      shareSessions.map((sess) => [sess.id, sess.viewer_id]),
    );
    const sectionMap = new Map<
      string,
      { title: string; totalSeconds: number; viewerIds: Set<string>; minOrdinal: number }
    >();
    for (const e of allEvents) {
      if (sessionToShare.get(e.session_id) !== s.id) continue;
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
    const sections = [...sectionMap.entries()]
      .map(([id, v]) => ({
        id,
        title: v.title,
        totalSeconds: v.totalSeconds,
        viewers: v.viewerIds.size,
        ordinal: Number.isFinite(v.minOrdinal) ? v.minOrdinal : null,
      }))
      .sort((a, b) => {
        if (a.ordinal == null && b.ordinal == null) return 0;
        if (a.ordinal == null) return 1;
        if (b.ordinal == null) return -1;
        return a.ordinal - b.ordinal;
      });
    analyticsByShareId[s.id] = {
      viewers: viewersByShare[s.id] ?? [],
      sessions: shareSessions,
      sections,
    };
  }

  return (
    <div className="pb-16">
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

      <header className="mt-6 flex flex-col gap-7 pb-8 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="min-w-0 flex-1">
          <h1
            title={doc.title}
            className="text-letterpress font-serif text-[30px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[40px] lg:text-[46px]"
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
          {doc.source_type === 'upload' && (
            <>
              <PreviewDocumentButton documentId={doc.id} action={previewDocumentAction} />
              <ReplaceDocumentButton documentId={doc.id} action={replaceDocumentAction} />
            </>
          )}
          <DeleteDocumentButton
            documentId={doc.id}
            documentTitle={doc.title}
            shareCount={shareIds.length}
            action={deleteDocumentAction}
          />
        </div>
      </header>

      {banners.map((b) => (
        <div
          key={b.key}
          role={b.role}
          className={
            b.role === 'alert'
              ? 'mt-6 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[14px] leading-relaxed text-alert'
              : 'mt-6 rounded-md border border-signal/30 bg-signal/5 px-4 py-3 text-[14px] leading-relaxed text-signal-dark'
          }
        >
          {b.message}
        </div>
      ))}

      <DocTabsClient
        documentId={doc.id}
        initialTab={initialTab}
        shareCount={shareIds.length}
        versionCount={versions.length}
        viewerCount={viewerCount}
        hasShares={shareIds.length > 0}
        hasOpens={hasOpens}
        hasMultipleVersions={versions.length > 1}
        shares={shares}
        analyticsByShareId={analyticsByShareId}
        previewShareAction={previewShareAction}
        editShareAction={editShareAction}
        createShareAction={createShareAction}
        freeShareCap={freeShareCap}
        toggleShareAction={toggleShareAction}
        deleteShareAction={deleteShareAction}
        viewers={allViewers}
        sessions={allSessions}
        events={allEvents}
        shareSlugs={shareSlugs}
        shareLabels={shareLabels}
        toggleViewerInternalAction={toggleViewerInternalAction}
        sectionTotals={sectionTotals}
        versions={versions}
        currentVersion={doc.current_version}
      />

      {/* Attachments stay full-width below the tabs. They're doc-level
          assets (one set per document, not per share), so embedding
          inside each share card would mislead — the same files would
          appear under every card. Live page uses the same placement. */}
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

// ---------- helpers ----------

type BannerRow = { key: string; role: 'alert' | 'status'; message: string };

function collectBanners(sp: NonNullable<Parameters<typeof DocumentPageV2>[0]['searchParams']>) {
  const out: BannerRow[] = [];
  if (!sp) return out;
  if (sp.share_error)
    out.push({
      key: 'share_error',
      role: 'alert',
      message: `Couldn't create the share: ${decodeURIComponent(sp.share_error)}`,
    });
  if (sp.delete_error)
    out.push({
      key: 'delete_error',
      role: 'alert',
      message: `Couldn't delete this document: ${decodeURIComponent(sp.delete_error)}`,
    });
  if (sp.preview_error)
    out.push({
      key: 'preview_error',
      role: 'alert',
      message: `Preview couldn't open: ${decodeURIComponent(sp.preview_error)}`,
    });
  if (sp.replace_error)
    out.push({
      key: 'replace_error',
      role: 'alert',
      message: `Couldn't replace the document: ${decodeURIComponent(sp.replace_error)}`,
    });
  if (sp.hide_error)
    out.push({
      key: 'hide_error',
      role: 'alert',
      message: `Couldn't update the viewer: ${decodeURIComponent(sp.hide_error)}`,
    });
  if (sp.attachment_error)
    out.push({
      key: 'attachment_error',
      role: 'alert',
      message: `Attachment problem: ${decodeURIComponent(sp.attachment_error)}`,
    });
  if (sp.replaced === '1')
    out.push({
      key: 'replaced',
      role: 'status',
      message: 'New version saved. All existing share links now serve the latest upload.',
    });
  if (sp.edited)
    out.push({
      key: 'edited',
      role: 'status',
      message: 'Share settings updated. All visitors to this link now see the new rules.',
    });
  if (sp.share_deleted === '1')
    out.push({
      key: 'share_deleted',
      role: 'status',
      message: 'Share deleted. The URL now returns Not Found.',
    });
  return out;
}
