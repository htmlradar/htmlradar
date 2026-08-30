'use client';

// Master-detail layout for managing a document's shares.
// Left rail: compact share list + "+ New share" button.
// Right pane: details for the selected share — analytics if there's a
// real share selected, or the create-share form if "+ New share" is
// active.
//
// State is client-side only (useState). Server actions still drive the
// mutations (createShare, toggleShare) — they're passed in as props.
//
// On mobile (<lg), the layout stacks: list on top, detail below. After
// selecting a share, the page scrolls the detail pane into view.

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ShareAnalytics } from '@/components/ShareAnalytics';
import { GateTag } from '@/components/doc-dashboard/GateTag';
import { resolveRecipientIdentity } from '@/lib/recipient-identity';
import { localInputToIso } from '@/lib/datetime-local';
import { shareUrl } from '@/lib/share-url';
import type { Viewer, Session } from '@/lib/types';

export interface ShareRow {
  id: string;
  slug: string;
  recipient_label: string | null;
  require_email: boolean;
  require_password: boolean;
  // Domain allowlist (e.g. ['example.com', 'example.org']). When the
  // edit form opens for an existing share, we pre-fill this textarea from
  // the same value the proxy reads to enforce the allowlist at gate time.
  allowed_email_domains: string[] | null;
  // Specific-email allowlist (e.g. ['marc@example.com', 'amrita@example.org']).
  // Independent of allowed_email_domains; the gate accepts a match in
  // EITHER list (see proxy/src/index.ts isEmailAllowed).
  allowed_emails: string[] | null;
  // Per-share permission to download supporting materials (Sprint B).
  // Default false. When false the recipient sees NO materials panel —
  // they have no signal that attachments exist on this doc.
  // Renamed from allow_download (migration 015) with flipped semantic:
  //   true  → deck is LOCKED (save/print blocked, watermark on)
  //   false → deck is open (save/print allowed)
  // Attachments are no longer gated by this flag.
  lock_deck: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  viewCount: number;
}

export interface ShareAnalyticsData {
  viewers: Viewer[];
  sessions: Session[];
  sections: Array<{
    id: string;
    title: string;
    totalSeconds: number;
    viewers: number;
    ordinal?: number | null;
  }>;
}

interface DocumentShareManagerProps {
  documentId: string;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  createShare: (formData: FormData) => Promise<void>;
  toggleShare: (formData: FormData) => Promise<void>;
  editShare: (formData: FormData) => Promise<void>;
  // Permanent destroy — separate from toggleShare (which is the
  // reversible Revoke pause). Used only from the typed-confirmation
  // modal inside the Edit pane.
  deleteShare: (formData: FormData) => Promise<void>;
  previewShare: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  // Count of supporting materials on the parent document. When zero we
  // hide the "Allow recipient to download materials" toggle entirely —
  // no point offering a permission for files that don't exist.
  attachmentCount: number;
}

type Selection = { mode: 'share'; id: string } | { mode: 'new' } | { mode: 'edit'; id: string };

const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DocumentShareManager({
  documentId,
  shares,
  analyticsByShareId,
  createShare,
  toggleShare,
  editShare,
  deleteShare,
  previewShare,
  attachmentCount,
}: DocumentShareManagerProps) {
  const initialSelection: Selection =
    shares.length > 0 && shares[0] ? { mode: 'share', id: shares[0].id } : { mode: 'new' };
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const detailRef = useRef<HTMLDivElement | null>(null);

  // After successful create-share, server revalidates and parent
  // re-renders with shares.length bumped. Auto-select the newest share.
  const prevSharesCount = useRef(shares.length);
  useEffect(() => {
    if (shares.length > prevSharesCount.current) {
      const newest = shares[0];
      if (newest) setSelection({ mode: 'share', id: newest.id });
    }
    prevSharesCount.current = shares.length;
  }, [shares]);

  // Mobile: when the user picks a share or "new share" from the rail,
  // scroll the detail pane into view so they don't have to find it.
  // No-op on lg+ where the panes are side-by-side.
  const handleSelectShare = (id: string) => {
    setSelection({ mode: 'share', id });
    scrollDetailIntoViewOnMobile();
  };
  const handleSelectNew = () => {
    setSelection({ mode: 'new' });
    scrollDetailIntoViewOnMobile();
  };
  const handleEditShare = (id: string) => {
    setSelection({ mode: 'edit', id });
    scrollDetailIntoViewOnMobile();
  };
  const scrollDetailIntoViewOnMobile = () => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  return (
    // 2xl-only inner master-detail. The outer page is already 2-col at
    // lg+ (Shares left, Analytics right), so this component is INSIDE
    // a narrower column and stacks its rail+panel by default. Only
    // very wide viewports (≥1536px) where the outer Shares column is
    // wide enough to host rail-beside-panel get the side-by-side view.
    <div className="grid gap-5 2xl:grid-cols-[280px_1fr] 2xl:items-start 2xl:gap-8">
      <ShareRail
        shares={shares}
        analyticsByShareId={analyticsByShareId}
        selection={selection}
        onSelectShare={handleSelectShare}
        onSelectNew={handleSelectNew}
      />
      <main ref={detailRef} className="min-w-0 scroll-mt-6">
        {selection.mode === 'new' ? (
          <ShareSettingsForm
            mode="create"
            documentId={documentId}
            action={createShare}
            attachmentCount={attachmentCount}
            onCancel={() => {
              if (shares.length > 0 && shares[0]) setSelection({ mode: 'share', id: shares[0].id });
            }}
          />
        ) : (
          (() => {
            const share = shares.find((s) => s.id === selection.id);
            // Defensive: if the selection points at a share that no
            // longer exists (race: revalidation removed it), fall back
            // to the new-share pane instead of a hard crash.
            if (!share) {
              return (
                <ShareSettingsForm
                  mode="create"
                  documentId={documentId}
                  action={createShare}
                  attachmentCount={attachmentCount}
                />
              );
            }
            if (selection.mode === 'edit') {
              return (
                <ShareSettingsForm
                  mode="edit"
                  documentId={documentId}
                  action={editShare}
                  deleteAction={deleteShare}
                  attachmentCount={attachmentCount}
                  initial={share}
                  onCancel={() => setSelection({ mode: 'share', id: share.id })}
                />
              );
            }
            return (
              <SharePane
                documentId={documentId}
                share={share}
                analytics={analyticsByShareId[share.id]}
                toggleShare={toggleShare}
                previewShare={previewShare}
                onEdit={() => handleEditShare(share.id)}
              />
            );
          })()
        )}
      </main>
    </div>
  );
}

/* ============================== Left rail ============================== */

function ShareRail({
  shares,
  analyticsByShareId,
  selection,
  onSelectShare,
  onSelectNew,
}: {
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  selection: Selection;
  onSelectShare: (id: string) => void;
  onSelectNew: () => void;
}) {
  // Hide the "no shares yet" placeholder when the new-share form is
  // already visible in the right pane — the placeholder + open form is
  // redundant.
  const showEmptyPlaceholder = shares.length === 0 && selection.mode !== 'new';

  // Stickiness flipped from lg→2xl: at lg the OUTER page is 2-col
  // with the Shares column already sticky, so inner stickiness would
  // compound weirdly. Only at 2xl+ — where this component is rendered
  // side-by-side as a real master-detail — does the inner sticky rail
  // make sense again.
  return (
    <aside className="flex flex-col gap-2 2xl:sticky 2xl:top-24">
      {/* "+ New share" pill — dashed border, no fill. Matches the
          ref's transparent-rail composition. When the new-share form is
          open in the right pane, the pill goes signal-tinted so the
          relationship between rail-state and pane-state is obvious. */}
      <button
        type="button"
        onClick={onSelectNew}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3.5 text-left text-[14px] font-medium transition',
          selection.mode === 'new'
            ? 'border-signal bg-paper text-ink'
            : 'border-line bg-transparent text-ink-soft hover:border-signal/50 hover:bg-paper hover:text-ink',
        )}
      >
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full border transition',
            selection.mode === 'new'
              ? 'border-signal bg-signal text-paper'
              : 'border-line bg-paper text-signal-dark',
          )}
        >
          <Plus aria-hidden className="size-3.5" />
        </span>
        New share
      </button>

      {showEmptyPlaceholder ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-[13px] leading-relaxed text-graphite">
          No shares yet. Click <span className="text-ink">New share</span> to create one.
        </p>
      ) : shares.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {shares.map((s) => {
            const isExpired = !!s.expires_at && new Date(s.expires_at) < new Date();
            const isRevoked = !!s.revoked_at;
            const active = selection.mode === 'share' && selection.id === s.id;
            const status: 'active' | 'expired' | 'revoked' = isRevoked
              ? 'revoked'
              : isExpired
                ? 'expired'
                : 'active';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectShare(s.id)}
                  className={cn(
                    'group relative flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition',
                    active
                      ? 'border-line bg-paper shadow-[0_1px_0_rgba(31,17,8,0.04)]'
                      : 'border-transparent hover:border-line hover:bg-paper',
                  )}
                >
                  {/* 3px vertical brand bar on selected — the
                      "selection accent" pattern. Transparent on unselected
                      so the row stays clean. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-3 left-2 w-[3px] rounded-full transition-colors',
                      active ? 'bg-signal' : 'bg-transparent group-hover:bg-signal/30',
                    )}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'ml-3 mt-1.5 size-2 shrink-0 rounded-full',
                      status === 'active' && 'bg-good',
                      status === 'expired' && 'bg-alert',
                      status === 'revoked' && 'bg-graphite/40',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {(() => {
                      const identity = resolveRecipientIdentity(
                        s,
                        analyticsByShareId[s.id]?.viewers ?? [],
                      );
                      return (
                        <>
                          <div
                            className="truncate text-[14px] font-medium text-ink"
                            title={
                              identity.secondary
                                ? `${identity.primary} — ${identity.secondary}`
                                : identity.primary
                            }
                          >
                            {identity.primary}
                          </div>
                          {identity.secondary && (
                            <div className="mt-0.5 truncate text-[11.5px] text-graphite">
                              {identity.secondary}
                            </div>
                          )}
                          <div className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                            {status === 'revoked'
                              ? 'Revoked'
                              : status === 'expired'
                                ? 'Expired'
                                : `${s.viewCount} ${s.viewCount === 1 ? 'view' : 'views'}`}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </aside>
  );
}

/* ============================= Right pane: share ======================== */

function SharePane({
  documentId,
  share,
  analytics,
  toggleShare,
  previewShare,
  onEdit,
}: {
  documentId: string;
  share: ShareRow;
  analytics: ShareAnalyticsData | undefined;
  toggleShare: (formData: FormData) => Promise<void>;
  previewShare: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  onEdit: () => void;
}) {
  const isRevoked = !!share.revoked_at;
  const isExpired = !!share.expires_at && new Date(share.expires_at) < new Date();
  const isLive = !isRevoked && !isExpired;
  const fullUrl = shareUrl(share.slug);

  // Use the same identity resolver as the rail + tables so the
  // SharePane heading reads consistently across the page. Without
  // this, a label-less share showed "Unlabeled" here while the rail
  // showed the viewer email — same share, two different identities.
  const identity = resolveRecipientIdentity(share, analytics?.viewers ?? []);

  const gateTags = buildGateTags(share);

  return (
    <section className="space-y-6 rounded-2xl border border-line bg-paper p-6 md:p-7">
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-graphite">
              Share
            </p>
            <h2
              title={
                identity.secondary
                  ? `${identity.primary} — ${identity.secondary}`
                  : identity.primary
              }
              className="text-letterpress mt-2 truncate font-serif text-[28px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[34px]"
            >
              {identity.primary}
            </h2>
            {identity.secondary && (
              <p className="mt-1 truncate font-mono text-[11.5px] uppercase tracking-[0.14em] text-graphite">
                {identity.secondary}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <PreviewAsYouButton shareId={share.id} documentId={documentId} action={previewShare} />
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-paper px-3.5 py-2 text-[13px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark"
            >
              <Pencil aria-hidden className="size-3.5" />
              Edit settings
            </button>
            {isExpired ? (
              <StatusPill tone="alert" label="Expired" />
            ) : (
              <ShareToggle
                documentId={documentId}
                shareId={share.id}
                active={!isRevoked}
                action={toggleShare}
              />
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-xl border bg-paper-2/30 px-4 py-3',
            isLive ? 'border-line' : 'border-line/60 opacity-70',
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-mono text-[13px]',
              isLive ? 'text-ink' : 'text-graphite line-through',
            )}
          >
            {fullUrl}
          </span>
          {isLive && <CopyInline slug={share.slug} />}
        </div>

        {/* Gate row — one chip per gate condition. Replaces the prior
            single-sentence gateSummary() so each setting is independently
            scannable. */}
        {gateTags.length > 0 && <div className="flex flex-wrap items-center gap-2">{gateTags}</div>}
      </header>

      {!isLive && (
        <div
          className={cn(
            'rounded-xl border border-dashed bg-paper-2/30 px-5 py-4',
            isRevoked ? 'border-graphite/30' : 'border-alert/30',
          )}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">
            {isRevoked && isExpired
              ? 'Revoked & expired'
              : isRevoked
                ? 'Currently revoked'
                : 'Expired'}
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
            {isRevoked && isExpired
              ? 'This link is both revoked and past its expiry, so the toggle above is hidden. Extend the expiry in Edit settings first — once it’s no longer expired the reactivate switch returns, then flip it to bring the link back.'
              : isRevoked
                ? "Recipients see a polite 'sender turned this link off' notice. Flip the switch above to bring it back — past read history stays intact."
                : 'The expiry date passed; recipients now see an Expired notice. Extend the date below or create a new share from the left rail to re-share.'}
          </p>
        </div>
      )}

      {analytics && analytics.sessions.length > 0 ? (
        <ShareAnalytics
          shareSlug={share.slug}
          recipientLabel={share.recipient_label}
          viewers={analytics.viewers}
          sessions={analytics.sessions}
          sections={analytics.sections}
          // panel-mini styles the stats with the pop accent on the
          // headline and rebuilds the sessions row as a 5-col grid;
          // /dashboard/[slug] keeps the default variant.
          variant="panel-mini"
          // ViewerInsights below ALWAYS shows the canonical glance
          // grid + viewer-grouped drill. The SharePane stat row +
          // sessions list would duplicate it, so we suppress both
          // here unconditionally. /dashboard/[slug] uses the same
          // ShareAnalytics component without these hides because it
          // is the standalone view with no ViewerInsights companion.
          hideStatRow
          hideSessions
        />
      ) : isLive ? (
        <WaitingInline shareSlug={share.slug} recipientLabel={share.recipient_label} />
      ) : null}
    </section>
  );
}

// Renders the per-share access conditions as independent chips.
// Replaces the prior single-sentence gateSummary() — easier to scan at
// a glance ("password + 3-domain allowlist, expires in 7d") than
// parsing a comma-list. Returns React nodes ready to drop into a row.
function buildGateTags(share: ShareRow): ReactNode[] {
  const tags: ReactNode[] = [];
  // Gate: email + password presented as separate chips so the user
  // sees "both" as two chips, "either" as one. Anonymous = "Open"
  // dashed chip so the absence of a gate reads as deliberate.
  if (share.require_email) {
    tags.push(
      <GateTag key="email" icon={<Mail className="size-3" />}>
        Email gate
      </GateTag>,
    );
  }
  if (share.require_password) {
    tags.push(
      <GateTag key="password" icon={<Lock className="size-3" />}>
        Password
      </GateTag>,
    );
  }
  if (!share.require_email && !share.require_password) {
    tags.push(
      <GateTag key="open" tone="off">
        Open · no gate
      </GateTag>,
    );
  }
  // Allowlists — surfaced as count when present. "+1 email" / "3 domains"
  // is the most useful affordance at glance; full list lives in the edit
  // form.
  const domainCount = share.allowed_email_domains?.length ?? 0;
  if (domainCount > 0) {
    tags.push(
      <GateTag key="domains" icon={<Globe className="size-3" />}>
        {domainCount} {domainCount === 1 ? 'domain' : 'domains'}
      </GateTag>,
    );
  }
  const emailCount = share.allowed_emails?.length ?? 0;
  if (emailCount > 0) {
    tags.push(
      <GateTag key="emails" icon={<ShieldCheck className="size-3" />}>
        {emailCount} allow-listed
      </GateTag>,
    );
  }
  // Expiry chip — alert tone if already past, default otherwise.
  // "No expiry" goes muted so its absence reads deliberate.
  if (share.expires_at) {
    const exp = new Date(share.expires_at);
    const past = exp < new Date();
    tags.push(
      <GateTag
        key="expiry"
        icon={<Calendar className="size-3" />}
        tone={past ? 'alert' : 'default'}
      >
        {past ? 'Expired' : 'Expires'} {formatExpiry(share.expires_at)}
      </GateTag>,
    );
  } else {
    tags.push(
      <GateTag key="no-expiry" tone="off">
        No expiry
      </GateTag>,
    );
  }
  // Deck lock state. Default is locked (save/print/screenshot blocked
  // + watermark). Worth surfacing prominently — it's the highest-
  // friction default. The Download icon now refers to deck saving;
  // attachments have their own implicit "always available when
  // present" semantic and are surfaced via the attachments panel.
  tags.push(
    <GateTag key="lock-deck" icon={<Download className="size-3" />}>
      {share.lock_deck ? 'Deck locked' : 'Deck saveable'}
    </GateTag>,
  );
  return tags;
}

function WaitingInline({
  shareSlug,
  recipientLabel,
}: {
  shareSlug: string;
  recipientLabel: string | null;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-dashed border-signal/30 bg-paper-2/30 px-5 py-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
          Waiting for first read
        </p>
        <h3 className="mt-2 font-serif text-[20px] leading-snug text-ink md:text-[22px]">
          {recipientLabel
            ? `Send the link to ${recipientLabel}. Watch this space.`
            : 'Send this link, watch this space.'}
        </h3>
        <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          Sessions, section dwell, and devices populate here the moment the recipient opens the link
          and stays past three seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
          {shareUrl(shareSlug)}
        </span>
        <CopyInline slug={shareSlug} />
      </div>
    </div>
  );
}

function ShareToggle({
  documentId,
  shareId,
  active,
  action,
}: {
  documentId: string;
  shareId: string;
  active: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  // Short-lived flag that flips true right after the action settles, so
  // we can show a brief "Saved" indicator. Without this the user toggles
  // the switch, the visual stays the same (because the optimistic state
  // matched the new server state), and they don't know anything happened.
  const [justSaved, setJustSaved] = useState(false);
  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !isPending) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 2200);
      return () => clearTimeout(t);
    }
    prevPending.current = isPending;
    return undefined;
  }, [isPending]);

  const handle = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  // While the action is in-flight, optimistic-flip the visual so the
  // user gets immediate feedback. Server result is the source of truth
  // when revalidation completes; for the few hundred ms of latency,
  // showing the about-to-be state prevents double-clicking.
  const visualActive = isPending ? !active : active;

  return (
    <form
      onSubmit={handle}
      className="flex flex-col items-end gap-1"
      title="Reversible pause. Flip OFF to revoke instantly — the recipient sees a polite 'sender turned this off' notice from that moment on. Flip ON whenever you want to bring the link back; past read history stays intact either way. For a permanent destroy, use Delete share in Edit settings."
    >
      <div className="flex items-center gap-2.5">
        <input type="hidden" name="share_id" value={shareId} />
        <input type="hidden" name="document_id" value={documentId} />
        <span
          className={cn(
            'font-mono text-[11px] uppercase tracking-[0.16em]',
            visualActive ? 'text-signal-dark' : 'text-graphite',
          )}
        >
          {visualActive ? 'Active' : 'Revoked'}
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={visualActive}
          aria-label={visualActive ? 'Switch share off' : 'Switch share on'}
          disabled={isPending}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-wait',
            visualActive ? 'bg-signal' : 'bg-paper-3',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'inline-block size-5 rounded-full bg-paper shadow-[0_1px_2px_rgba(31,17,8,0.2)] transition-transform',
              visualActive ? 'translate-x-[22px]' : 'translate-x-[2px]',
            )}
          />
        </button>
      </div>
      <span
        aria-live="polite"
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.16em] transition-opacity',
          justSaved ? 'text-signal-dark opacity-100' : 'text-graphite opacity-0',
        )}
      >
        {visualActive ? 'Reactivated · saved' : 'Revoked · saved'}
      </span>
    </form>
  );
}

// "Preview as you" — minted server-side via previewShareAction. Opens the
// real proxy URL in a new tab with an HMAC token that bypasses the email
// gate (the owner shouldn't have to satisfy their own recipient gate).
// Token is short-lived (10 min) and slug-bound; see preview-token.ts.
function PreviewAsYouButton({
  shareId,
  documentId,
  action,
}: {
  shareId: string;
  documentId: string;
  action: (formData: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  // Hard navigation via window.location.href, NOT redirect(): Next.js's
  // server-action redirect would route same-hostname URLs through the
  // app's client router, where /r/{slug}?owner_preview=... isn't a known
  // route → app's not-found.tsx renders instead of the proxy serving
  // the doc. Returning the URL and navigating client-side bypasses Next
  // entirely; the browser hits the Worker route directly.
  const onClick = () => {
    // Open the preview in a new tab so the sender's dashboard stays
    // put. window.open must be called synchronously here — popup
    // blockers reject calls from inside the async startTransition
    // callback below. Placeholder about:blank gets its real URL once
    // the server action returns.
    const previewTab = window.open('about:blank', '_blank', 'noopener');
    startTransition(async () => {
      const fd = new FormData();
      fd.set('share_id', shareId);
      fd.set('document_id', documentId);
      const res = await action(fd);
      if (res.ok) {
        if (previewTab && !previewTab.closed) {
          previewTab.location.href = res.url;
        } else {
          window.location.href = res.url;
        }
      } else {
        previewTab?.close();
        window.location.href = `/docs/${documentId}?share_error=${encodeURIComponent(res.error)}`;
      }
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      title="Open the share URL, bypassing the email gate — only you can do this."
      className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-paper px-3.5 py-2 text-[13px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark disabled:cursor-wait disabled:opacity-60"
    >
      <ExternalLink aria-hidden className="size-3.5" />
      {isPending ? 'Opening…' : 'Preview as you'}
    </button>
  );
}

/* ============================ Right pane: settings form ================== */

// Parametric form used for both creating a new share AND editing an existing
// one. Behaviour differences:
//   - mode='create' → action receives only document_id; password is required
//     when require_password is checked (8+ chars).
//   - mode='edit'   → action receives share_id + document_id; password is
//     optional (blank means "keep existing hash"). expires_at is pre-filled
//     by converting ISO → datetime-local. The rest of the inputs pre-fill
//     from initial.*
// Keeping one component avoids drift between the create + edit shapes.
function ShareSettingsForm({
  mode,
  documentId,
  action,
  deleteAction,
  initial,
  onCancel,
  attachmentCount,
}: {
  mode: 'create' | 'edit';
  documentId: string;
  action: (formData: FormData) => Promise<void>;
  // Optional — only passed in edit mode. Powers the "Delete share"
  // affordance + its typed-DELETE confirmation modal.
  deleteAction?: (formData: FormData) => Promise<void>;
  initial?: ShareRow;
  onCancel?: () => void;
  attachmentCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [requireEmail, setRequireEmail] = useState(initial?.require_email ?? true);
  const [requirePassword, setRequirePassword] = useState(initial?.require_password ?? false);
  // lock_deck starts from the existing share value on edit, or true
  // on create. Default-true is the safe posture — deck locked +
  // watermarked unless the sender explicitly unlocks. Attachments are
  // no longer gated by this flag (design decision).
  const [lockDeck, setLockDeck] = useState(initial?.lock_deck ?? true);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState(
    initial?.allowed_email_domains?.join(', ') ?? '',
  );
  const [allowedEmails, setAllowedEmails] = useState(initial?.allowed_emails?.join(', ') ?? '');
  const [domainsError, setDomainsError] = useState<string | null>(null);
  const [emailsError, setEmailsError] = useState<string | null>(null);

  const validateDomains = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed
      .split(/[,\n]/)
      .map((d) => d.trim())
      .filter(Boolean);
    const bad = parts.filter((d) => !DOMAIN_REGEX.test(d));
    if (bad.length === 0) return null;
    return `Not a valid domain: ${bad[0]}`;
  };

  const validateEmails = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed
      .split(/[,\n]/)
      .map((d) => d.trim())
      .filter(Boolean);
    const bad = parts.filter((d) => !EMAIL_REGEX.test(d));
    if (bad.length === 0) return null;
    return `Not a valid email: ${bad[0]}`;
  };

  const passwordTooShort = requirePassword && password.length > 0 && password.length < 8;

  // In create mode the password field is mandatory once require_password
  // is on (length >= 8). In edit mode it's optional — blank input keeps
  // the existing hash, the RPC handles that branch.
  const blocked =
    !!domainsError ||
    !!emailsError ||
    (mode === 'create' ? requirePassword && password.length < 8 : passwordTooShort);

  const isEdit = mode === 'edit';

  return (
    <section className="space-y-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">
          {isEdit ? 'Edit share' : 'New share'}
        </p>
        <h2 className="text-letterpress mt-2 font-serif text-[28px] leading-snug text-ink md:text-[32px]">
          {isEdit ? (initial?.recipient_label ?? 'Unlabeled') : 'Create a tracked link.'}
        </h2>
        <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-soft">
          {isEdit
            ? 'Update gates, password, allow-list, or expiry without revoking. Past read history stays intact; the next visitor sees the new settings.'
            : 'Send it to one person or a whole list — anyone with the URL who passes the gates can view. Make a separate share when you want individual analytics or different gates per recipient.'}
        </p>
      </header>

      <form
        action={(fd) => {
          // Convert the tz-less datetime-local expiry to a true UTC instant in
          // the browser (timezone known here) so the server stores the moment
          // the owner actually picked — not a UTC misparse of the wall-clock.
          const localExpiry = String(fd.get('expires_at') ?? '');
          if (localExpiry) {
            fd.set(
              'expires_at',
              localInputToIso(localExpiry, new Date(localExpiry).getTimezoneOffset()),
            );
          }
          startTransition(() => action(fd));
        }}
        className="space-y-7 rounded-2xl border border-line bg-paper p-6 md:p-8"
      >
        <input type="hidden" name="document_id" value={documentId} />
        {isEdit && initial && <input type="hidden" name="share_id" value={initial.id} />}

        <Field
          label="Recipient label"
          hint="Free-form. Shown to you in the dashboard. The recipient never sees it."
          optional
        >
          <input
            name="recipient_label"
            defaultValue={initial?.recipient_label ?? ''}
            placeholder="Marc at Example Ventures"
            maxLength={120}
            className="mt-2 w-full rounded-md border border-line bg-paper px-4 py-3 text-[16px] text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] md:text-[14.5px]"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxRow
            name="require_email"
            label="Require email"
            checked={requireEmail}
            onChange={setRequireEmail}
            hint="Recipient enters an email at the gate before the document renders."
          />
          <CheckboxRow
            name="require_password"
            label="Require password"
            checked={requirePassword}
            onChange={setRequirePassword}
            hint="On top of the email gate, for highly sensitive shares."
          />
        </div>

        {/* Deck-lock toggle. Single decision governs the HTML deck's
            save/print/screenshot posture. Attachments are SEPARATE:
            they're always available to the recipient when present
            (the toggle has no effect on them).

            On by default (lock posture is the privacy-by-default
            position). Inverted vs the old "Allow downloads" semantic
            — the form field name + the underlying lock_deck column
            were both renamed in migration 015.

            Sender's mental model:
              ☑ Lock the deck → recipient can't save/print/screenshot
                                cleanly; their email is watermarked
              ☐ Lock the deck → recipient can save the deck freely. */}
        <CheckboxRow
          name="lock_deck"
          label="Lock the deck"
          checked={lockDeck}
          onChange={setLockDeck}
          hint={
            attachmentCount > 0
              ? `On by default. When ON, save/print/screenshot are blocked on the main deck and the recipient's email is faintly watermarked across each page. Attached files (${attachmentCount} ${attachmentCount === 1 ? 'file' : 'files'}) stay downloadable either way.`
              : "On by default. When ON, save/print/screenshot are blocked on the deck and the recipient's email is faintly watermarked across each page. When OFF, the recipient can save and print this deck freely."
          }
        />

        <Field
          label="Password"
          hint={
            requirePassword
              ? isEdit
                ? 'Leave blank to keep the current password. Enter a new one (8+ chars) to change it.'
                : 'Recipients type this after the email gate. At least 8 characters.'
              : 'Turn on "Require password" above to use this.'
          }
          optional
          inactive={!requirePassword}
          error={passwordTooShort ? 'At least 8 characters required.' : null}
        >
          <div className="relative mt-2">
            <input
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!requirePassword}
              placeholder={
                requirePassword
                  ? isEdit
                    ? 'Leave blank to keep current'
                    : 'At least 8 characters'
                  : 'Disabled — turn on password gate above'
              }
              className={cn(
                'w-full rounded-md border bg-paper px-4 py-3 pr-11 font-mono text-[16px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] disabled:cursor-not-allowed disabled:bg-paper-2/40 disabled:text-graphite md:text-[13.5px]',
                passwordTooShort
                  ? 'border-alert/60 focus:border-alert'
                  : 'border-line focus:border-signal',
              )}
            />
            {requirePassword && password.length > 0 && (
              <button
                type="button"
                onClick={() => setPasswordVisible((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex size-7 items-center justify-center rounded-md text-graphite transition hover:bg-paper-2/60 hover:text-ink"
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              >
                {passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            )}
          </div>
        </Field>

        <Field
          label="Allowed email domains"
          hint={
            requireEmail
              ? 'Comma- or newline-separated. Addresses at these domains pass; everyone else is blocked. Leave blank if you want any domain to pass.'
              : 'Turn on "Require email" above to use this.'
          }
          optional
          inactive={!requireEmail}
          error={domainsError}
        >
          <textarea
            name="allowed_domains"
            value={allowedDomains}
            disabled={!requireEmail}
            rows={2}
            onChange={(e) => {
              setAllowedDomains(e.target.value);
              setDomainsError(validateDomains(e.target.value));
            }}
            placeholder={
              requireEmail ? 'example.com, example.org' : 'Disabled — turn on email gate above'
            }
            className={cn(
              'mt-2 w-full resize-y rounded-md border bg-paper px-4 py-3 font-mono text-[16px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] disabled:cursor-not-allowed disabled:bg-paper-2/40 disabled:text-graphite md:text-[13.5px]',
              domainsError
                ? 'border-alert/60 focus:border-alert'
                : 'border-line focus:border-signal',
            )}
          />
        </Field>

        <Field
          label="Allowed specific emails"
          hint={
            requireEmail
              ? 'Comma- or newline-separated. Only these exact addresses pass the gate. Combined with the domain list: an address passes if it matches EITHER list (union, not intersection).'
              : 'Turn on "Require email" above to use this.'
          }
          optional
          inactive={!requireEmail}
          error={emailsError}
        >
          <textarea
            name="allowed_emails"
            value={allowedEmails}
            disabled={!requireEmail}
            rows={3}
            onChange={(e) => {
              setAllowedEmails(e.target.value);
              setEmailsError(validateEmails(e.target.value));
            }}
            placeholder={
              requireEmail
                ? 'marc@example.com\namrita@example.org'
                : 'Disabled — turn on email gate above'
            }
            className={cn(
              'mt-2 w-full resize-y rounded-md border bg-paper px-4 py-3 font-mono text-[16px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] disabled:cursor-not-allowed disabled:bg-paper-2/40 disabled:text-graphite md:text-[13.5px]',
              emailsError
                ? 'border-alert/60 focus:border-alert'
                : 'border-line focus:border-signal',
            )}
          />
        </Field>

        <Field
          label="Expires"
          hint="After this moment, anyone opening the link sees an Expired notice instead of the deck. You can extend the expiry from this form at any time — past read history stays intact."
          optional
        >
          <input
            name="expires_at"
            type="datetime-local"
            defaultValue={initial?.expires_at ? toDatetimeLocal(initial.expires_at) : ''}
            className="mt-2 rounded-md border border-line bg-paper px-4 py-3 font-mono text-[16px] text-ink outline-none transition focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] md:text-[13.5px]"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isPending || blocked}
            className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending
              ? isEdit
                ? 'Saving…'
                : 'Creating…'
              : isEdit
                ? 'Save changes'
                : 'Create share'}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="inline-flex items-center rounded-md border border-line bg-paper px-4 py-3 text-[14px] text-ink-soft transition hover:border-signal hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {isEdit && initial && deleteAction ? (
        <DangerZone documentId={documentId} share={initial} deleteAction={deleteAction} />
      ) : null}
    </section>
  );
}

// Permanent destroy. Visually separate from the form's Save row so it
// reads as a different category of action — "this is not just settings,
// this is destruction." Click "Delete share" → modal asks for typed
// confirmation ("DELETE"). The action itself also re-validates that
// string server-side, so the modal isn't load-bearing for safety —
// it's load-bearing for "you can't fat-finger this".
function DangerZone({
  documentId,
  share,
  deleteAction,
}: {
  documentId: string;
  share: ShareRow;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-8 rounded-2xl border border-alert/30 bg-alert/5 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-alert">
              Danger zone
            </p>
            <h3 className="mt-2 font-serif text-[18px] leading-snug text-ink">
              Delete this share.
            </h3>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-soft">
              Permanently destroys the link and all of its read history. The URL returns Not Found
              from that moment on. Want to pause access instead? Use the Active toggle in the share
              panel — it's reversible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-alert/40 bg-paper px-3.5 py-2 text-[13px] font-medium text-alert transition hover:border-alert hover:bg-alert/5"
          >
            <Trash2 aria-hidden className="size-3.5" />
            Delete share
          </button>
        </div>
      </div>
      {open ? (
        <DeleteShareModal
          documentId={documentId}
          share={share}
          deleteAction={deleteAction}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function DeleteShareModal({
  documentId,
  share,
  deleteAction,
  onClose,
}: {
  documentId: string;
  share: ShareRow;
  deleteAction: (formData: FormData) => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [isPending, startTransition] = useTransition();
  const canDestroy = typed.trim().toUpperCase() === 'DELETE';

  // Close on Escape — basic dialog ergonomics. Click-outside also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPending, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!isPending) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-share-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-alert/30 bg-paper p-6 shadow-[0_30px_60px_-20px_rgba(31,17,8,0.35)] md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-alert">
          Permanent action
        </p>
        <h3
          id="delete-share-title"
          className="text-letterpress mt-2 font-serif text-[24px] leading-snug text-ink"
        >
          Delete this share?
        </h3>
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
          The URL <span className="font-mono text-ink">/r/{share.slug}</span> will start returning
          Not Found. Sessions, viewers, and section dwell tied to this share are removed too. This
          can't be undone.
        </p>
        <form action={(fd) => startTransition(() => deleteAction(fd))} className="mt-5 space-y-4">
          <input type="hidden" name="share_id" value={share.id} />
          <input type="hidden" name="document_id" value={documentId} />
          <div>
            <label className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Type <span className="text-alert">DELETE</span> to confirm
            </label>
            <input
              type="text"
              name="confirmation"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-full rounded-md border border-line bg-paper px-4 py-3 font-mono text-[15px] tracking-[0.18em] text-ink outline-none transition placeholder:text-graphite/60 focus:border-alert focus:shadow-[0_0_0_3px_rgba(189,52,52,0.08)]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center rounded-md border border-line bg-paper px-4 py-2.5 text-[13.5px] text-ink-soft transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canDestroy || isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-alert px-4 py-2.5 text-[13.5px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-alert/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 aria-hidden className="size-3.5" />
              {isPending ? 'Deleting…' : 'Permanently delete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Convert an ISO timestamp into the local-time string accepted by
// <input type="datetime-local"> ("YYYY-MM-DDTHH:MM"). The browser shows
// it in the viewer's local zone, which matches what they saw when they
// first picked the expiry.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ============================== Sub-components ========================== */

function StatusPill({ tone, label }: { tone: 'signal' | 'alert'; label: string }) {
  const className = tone === 'alert' ? 'bg-alert/10 text-alert' : 'bg-signal/10 text-signal-dark';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${className}`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${tone === 'alert' ? 'bg-alert' : 'bg-signal'}`}
      />
      {label}
    </span>
  );
}

function CopyInline({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // navigator.clipboard fails in non-secure contexts; fall back to a
      // hidden-textarea copy so the action never silently no-ops.
      const el = document.createElement('textarea');
      el.value = shareUrl(slug);
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:border-signal hover:text-signal-dark"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3 text-signal" />
          Copied
        </>
      ) : (
        <>
          <Copy aria-hidden className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}

function Field({
  label,
  hint,
  optional,
  inactive,
  error,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  inactive?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={inactive ? 'opacity-60' : ''}>
      <div className="flex items-baseline justify-between">
        <label
          className={cn(
            'font-mono text-[11px] uppercase tracking-[0.16em]',
            inactive ? 'text-graphite/70' : 'text-graphite',
          )}
        >
          {label}
        </label>
        {optional && (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite/60">
            optional
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="mt-2 inline-flex items-start gap-1.5 text-[12.5px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-graphite">{hint}</p>
      ) : null}
    </div>
  );
}

function CheckboxRow({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper p-4 transition hover:border-signal/40">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-line bg-paper text-paper transition peer-checked:border-signal peer-checked:bg-signal peer-focus-visible:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
      >
        <svg
          viewBox="0 0 12 12"
          className="size-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6 L5 9 L10 3" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[14px] font-medium text-ink">{label}</span>
        {hint && (
          <span className="mt-1 block text-[12.5px] leading-relaxed text-graphite">{hint}</span>
        )}
      </span>
    </label>
  );
}
