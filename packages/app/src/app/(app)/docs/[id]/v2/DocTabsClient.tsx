'use client';

// Three-tab shell for the v2 document detail page.
//
// State source of truth is the URL: ?tab=sharing|analytics|versions.
// The default (no param) is 'sharing'. URL changes on tab click via
// router.replace(scroll:false) so deep links and back/forward work.
//
// Stage A: tab UI + URL state + accessibility + placeholder content.
// Stage B/C will replace the placeholders with real components.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { BarChart3, History, Share2, type LucideIcon } from './tab-icons';
import { normalizeTab, type TabKey } from './tab-key';
import { ShareCardList } from './ShareCardList';
import { SectionTimeBarChart, type SectionTotal } from './SectionTimeBarChart';
import { ViewerInsights } from '../ViewerInsights';
import { SharesTable } from '../SharesTable';
import { type DocumentVersionRow } from '../VersionHistoryPopover';
import type { Viewer, Session, SectionEvent } from '@/lib/types';
import type { ShareRow, ShareAnalyticsData } from '../DocumentShareManager';
import { FileText, Globe } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DocTabsClientProps {
  documentId: string;
  initialTab: TabKey;
  shareCount: number;
  versionCount: number;
  viewerCount: number;
  hasShares: boolean;
  hasOpens: boolean;
  hasMultipleVersions: boolean;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  editShareAction: (formData: FormData) => Promise<void>;
  createShareAction: (formData: FormData) => Promise<void>;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
  freeShareCap?: { used: number; cap: number } | null;
  viewers: Viewer[];
  sessions: Session[];
  events: SectionEvent[];
  shareSlugs: Record<string, string>;
  shareLabels: Record<string, string | null>;
  toggleViewerInternalAction: (formData: FormData) => Promise<void>;
  sectionTotals: SectionTotal[];
  versions: DocumentVersionRow[];
  currentVersion: number | null;
}

const TABS: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: 'sharing', label: 'Sharing', icon: Share2 },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'versions', label: 'Versions', icon: History },
];

export function DocTabsClient(props: DocTabsClientProps) {
  const { initialTab, shareCount, versionCount, viewerCount, hasShares, hasOpens } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Active tab is normalized off the URL so garbage values (?tab=foo)
  // never put the UI into an unselected state.
  const urlTab = normalizeTab(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<TabKey>(urlTab || initialTab);

  // Ref tracks the latest activeTab so keyboard nav handlers don't read
  // a stale closure value during rapid arrow-key presses.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Re-sync from URL when it changes externally (back/forward, deep link).
  // setState short-circuits when value === current, so no redundant render.
  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const setTab = useCallback(
    (next: TabKey) => {
      setActiveTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'sharing') params.delete('tab');
      else params.set('tab', next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')
      return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.key === activeTabRef.current);
    let nextIdx = idx;
    if (e.key === 'ArrowLeft') nextIdx = idx <= 0 ? TABS.length - 1 : idx - 1;
    if (e.key === 'ArrowRight') nextIdx = idx >= TABS.length - 1 ? 0 : idx + 1;
    if (e.key === 'Home') nextIdx = 0;
    if (e.key === 'End') nextIdx = TABS.length - 1;
    const next = TABS[nextIdx]!.key;
    setTab(next);
    queueMicrotask(() => tabRefs.current[next]?.focus());
  };

  const countFor = (k: TabKey) =>
    k === 'sharing' ? shareCount : k === 'versions' ? versionCount : viewerCount;

  return (
    <div className="mt-2">
      {/* Sticky tab bar. The AppLayout wraps in `px-6`, so we bleed by
          the same amount to push the sticky strip's bg/blur edge-to-edge
          at the viewport. Bottom soft fade matches the reference. */}
      <div
        className={cn(
          'sticky top-0 z-30 -mx-6 px-6',
          'bg-paper-2/90 backdrop-blur supports-[backdrop-filter]:bg-paper-2/80',
          // Soft seam to the panel content below.
          'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-3 after:h-3',
          'after:bg-gradient-to-b after:from-paper-2/60 after:to-transparent',
        )}
      >
        <div
          role="tablist"
          aria-label="Document sections"
          onKeyDown={onKeyDown}
          className={cn(
            'flex items-end gap-1 border-b border-line pt-1',
            // Horizontal scroll on narrow viewports so tab labels never wrap.
            'overflow-x-auto scrollbar-none',
          )}
        >
          {TABS.map((t) => {
            const isActive = activeTab === t.key;
            const count = countFor(t.key);
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[t.key] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={isActive}
                aria-controls={`tabpanel-${t.key}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3.5',
                  'font-sans text-[13.5px] font-medium tracking-tight',
                  'transition-colors duration-150',
                  'focus:outline-none focus-visible:rounded-t-md focus-visible:bg-paper/50',
                  isActive ? 'text-ink' : 'text-graphite hover:text-ink-soft',
                )}
              >
                <Icon
                  className={cn(
                    'size-4 shrink-0 transition-colors',
                    isActive ? 'text-signal' : 'text-graphite/70',
                  )}
                />
                <span>{t.label}</span>
                <span
                  className={cn(
                    'inline-flex min-w-[1.5rem] justify-center rounded-full border px-1.5 py-px',
                    'font-mono text-[10px] font-medium tabular-nums tracking-wider',
                    isActive
                      ? 'border-signal bg-signal text-paper'
                      : 'border-line bg-paper-2/60 text-graphite',
                  )}
                >
                  {count}
                </span>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2.5 -bottom-px h-[2.5px] rounded-full bg-signal"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <TabPanel tabKey="sharing" active={activeTab === 'sharing'}>
          <SharingPanel
            documentId={props.documentId}
            shares={props.shares}
            analyticsByShareId={props.analyticsByShareId}
            shareCount={shareCount}
            hasShares={hasShares}
            previewShareAction={props.previewShareAction}
            editShareAction={props.editShareAction}
            createShareAction={props.createShareAction}
            toggleShareAction={props.toggleShareAction}
            deleteShareAction={props.deleteShareAction}
            freeShareCap={props.freeShareCap ?? null}
          />
        </TabPanel>
        <TabPanel tabKey="analytics" active={activeTab === 'analytics'}>
          <AnalyticsPanel
            documentId={props.documentId}
            viewers={props.viewers}
            sessions={props.sessions}
            events={props.events}
            shareSlugs={props.shareSlugs}
            shareLabels={props.shareLabels}
            toggleViewerInternalAction={props.toggleViewerInternalAction}
            shares={props.shares}
            analyticsByShareId={props.analyticsByShareId}
            sectionTotals={props.sectionTotals}
            hasOpens={hasOpens}
          />
        </TabPanel>
        <TabPanel tabKey="versions" active={activeTab === 'versions'}>
          <VersionsPanel versions={props.versions} currentVersion={props.currentVersion} />
        </TabPanel>
      </div>
    </div>
  );
}

function TabPanel({
  tabKey,
  active,
  children,
}: {
  tabKey: TabKey;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tabKey}`}
      aria-labelledby={`tab-${tabKey}`}
      hidden={!active}
    >
      {children}
    </div>
  );
}

// ---------- Stage A placeholders ----------

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-letterpress font-serif text-[28px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[32px]">
        {title}
      </h2>
      {hint && (
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          {hint}
        </span>
      )}
    </div>
  );
}

function SharingPanel({
  documentId,
  shares,
  analyticsByShareId,
  shareCount,
  hasShares,
  previewShareAction,
  editShareAction,
  createShareAction,
  toggleShareAction,
  deleteShareAction,
  freeShareCap,
}: {
  documentId: string;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  shareCount: number;
  hasShares: boolean;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  editShareAction: (formData: FormData) => Promise<void>;
  createShareAction: (formData: FormData) => Promise<void>;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
  freeShareCap?: { used: number; cap: number } | null;
}) {
  return (
    <section>
      <SectionHead
        title="Share links."
        hint={
          hasShares
            ? `${shareCount} ${shareCount === 1 ? 'link' : 'links'} · per-recipient settings`
            : 'Send this document to people, one link at a time'
        }
      />

      <ShareCardList
        documentId={documentId}
        shares={shares}
        analyticsByShareId={analyticsByShareId}
        previewShareAction={previewShareAction}
        editShareAction={editShareAction}
        createShareAction={createShareAction}
        toggleShareAction={toggleShareAction}
        deleteShareAction={deleteShareAction}
        freeShareCap={freeShareCap ?? null}
      />
    </section>
  );
}

function AnalyticsPanel({
  documentId,
  viewers,
  sessions,
  events,
  shareSlugs,
  shareLabels,
  toggleViewerInternalAction,
  shares,
  analyticsByShareId,
  sectionTotals,
  hasOpens,
}: {
  documentId: string;
  viewers: Viewer[];
  sessions: Session[];
  events: SectionEvent[];
  shareSlugs: Record<string, string>;
  shareLabels: Record<string, string | null>;
  toggleViewerInternalAction: (formData: FormData) => Promise<void>;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  sectionTotals: SectionTotal[];
  hasOpens: boolean;
}) {
  return (
    <section className="space-y-8">
      {!hasOpens ? (
        <>
          <SectionHead title="Who's reading." hint="Live the moment the first recipient opens" />
          <EmptyState
            title="Waiting for the first read."
            body="Active read time, section dwell and per-viewer breakdown land here the moment your first recipient opens the link."
          />
        </>
      ) : (
        <>
          <SectionTimeBarChart sections={sectionTotals} />
          {/* ViewerInsights has its own "Who's reading." SectionHead.
              No need to duplicate. */}
          <ViewerInsights
            viewers={viewers}
            sessions={sessions}
            events={events}
            documentId={documentId}
            shareSlugs={shareSlugs}
            shareLabels={shareLabels}
            toggleInternal={toggleViewerInternalAction}
          />
          <SharesTable shares={shares} analyticsByShareId={analyticsByShareId} />
        </>
      )}
    </section>
  );
}

function VersionsPanel({
  versions,
  currentVersion,
}: {
  versions: DocumentVersionRow[];
  currentVersion: number | null;
}) {
  return (
    <section>
      <SectionHead
        title="Version history."
        hint={`${versions.length} ${versions.length === 1 ? 'version' : 'versions'} on file`}
      />
      <p className="-mt-3 mb-6 max-w-[64ch] text-[14px] leading-relaxed text-ink-soft">
        Use <strong className="font-semibold text-ink">Replace HTML</strong> at the top of the page
        to add a new version — every share link keeps the same URL and serves the latest upload on
        next open.
      </p>
      {versions.length === 0 ? (
        <EmptyState
          title="No version history yet."
          body="Once you replace the HTML, every prior version will be kept here for reference."
        />
      ) : (
        <div className="space-y-3">
          {versions.map((v) => (
            <VersionRow key={v.id} version={v} isCurrent={v.version === currentVersion} />
          ))}
        </div>
      )}
    </section>
  );
}

function VersionRow({ version, isCurrent }: { version: DocumentVersionRow; isCurrent: boolean }) {
  const Icon = version.source_type === 'url' ? Globe : FileText;
  return (
    <div
      className={cn(
        'grid items-center gap-4 rounded-2xl border bg-paper px-5 py-4',
        isCurrent ? 'border-good/40 bg-good/5' : 'border-line',
        'grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_auto_auto]',
      )}
    >
      <div className="text-center">
        <div className="font-serif text-[22px] font-medium leading-none tracking-tight text-ink">
          v{version.version}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-graphite">
          {isCurrent ? 'Live' : 'Archived'}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 truncate font-serif text-[15px] font-medium text-ink">
          <Icon aria-hidden className="size-3.5 shrink-0 text-graphite" />
          <span className="truncate">{version.filename || 'Untitled upload'}</span>
        </div>
        <div
          className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-graphite"
          title={new Date(version.replaced_at).toLocaleString()}
        >
          {formatVersionStamp(version.replaced_at)}
          {' · '}
          {formatBytes(version.bytes)}
        </div>
      </div>
      {isCurrent && (
        <span className="hidden rounded-full border border-good/40 bg-good/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-good md:inline-block">
          Live now
        </span>
      )}
    </div>
  );
}

// Compact date+time string for the Versions tab. We want the reader
// to glance and tell "yes, this replace just landed" — date-only
// hid back-to-back replaces of the same calendar day. Hover reveals
// the full locale timestamp via the parent's `title` attribute.
function formatVersionStamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const year = d.getFullYear();
  const thisYear = new Date().getFullYear();
  return year === thisYear ? `${date}, ${time}` : `${date} ${year}, ${time}`;
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper/40 px-8 py-10 text-center">
      <p className="font-serif text-[22px] font-normal leading-tight tracking-tight text-ink">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
