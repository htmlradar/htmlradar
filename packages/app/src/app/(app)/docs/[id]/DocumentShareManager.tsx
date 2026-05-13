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

import { useEffect, useRef, useState, useTransition } from 'react';
import { AlertCircle, ArrowRight, Check, Copy, Eye, EyeOff, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ShareAnalytics } from '@/components/ShareAnalytics';
import type { Viewer, Session } from '@/lib/types';

export interface ShareRow {
  id: string;
  slug: string;
  recipient_label: string | null;
  require_email: boolean;
  require_password: boolean;
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
  }>;
}

interface DocumentShareManagerProps {
  documentId: string;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  createShare: (formData: FormData) => Promise<void>;
  toggleShare: (formData: FormData) => Promise<void>;
}

type Selection = { mode: 'share'; id: string } | { mode: 'new' };

const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

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
    <div className="grid gap-5 lg:grid-cols-[320px_1fr] lg:gap-6">
      <ShareRail
        shares={shares}
        selection={selection}
        onSelectShare={handleSelectShare}
        onSelectNew={handleSelectNew}
      />
      <main ref={detailRef} className="min-w-0 scroll-mt-6">
        {selection.mode === 'new' ? (
          <NewSharePane documentId={documentId} createShare={createShare} />
        ) : (
          (() => {
            const share = shares.find((s) => s.id === selection.id);
            // Defensive: if the selection points at a share that no
            // longer exists (race: revalidation removed it), fall back
            // to the new-share pane instead of a hard crash.
            if (!share) {
              return <NewSharePane documentId={documentId} createShare={createShare} />;
            }
            return (
              <SharePane
                documentId={documentId}
                share={share}
                analytics={analyticsByShareId[share.id]}
                toggleShare={toggleShare}
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
  selection,
  onSelectShare,
  onSelectNew,
}: {
  shares: ShareRow[];
  selection: Selection;
  onSelectShare: (id: string) => void;
  onSelectNew: () => void;
}) {
  // Hide the "no shares yet" placeholder when the new-share form is
  // already visible in the right pane — the placeholder + open form is
  // redundant.
  const showEmptyPlaceholder = shares.length === 0 && selection.mode !== 'new';

  return (
    <aside className="overflow-hidden rounded-2xl border border-line bg-paper">
      <button
        type="button"
        onClick={onSelectNew}
        className={cn(
          'flex w-full items-center gap-2 border-b border-line px-5 py-4 text-left transition',
          selection.mode === 'new'
            ? 'bg-signal/8 text-signal-dark'
            : 'text-ink-soft hover:bg-paper-2/40 hover:text-ink',
        )}
      >
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full transition',
            selection.mode === 'new' ? 'bg-signal text-paper' : 'bg-paper-3 text-signal-dark',
          )}
        >
          <Plus aria-hidden className="size-3.5" />
        </span>
        <span className="text-[14px] font-medium">New share</span>
      </button>

      {showEmptyPlaceholder ? (
        <p className="px-5 py-5 text-[13px] text-graphite">
          No shares yet. Click <span className="text-ink">New share</span> to create one.
        </p>
      ) : shares.length > 0 ? (
        <ul>
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
              <li key={s.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelectShare(s.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-5 py-4 text-left transition',
                    active ? 'bg-signal/6 shadow-[inset_3px_0_0_0_#7A1F2E]' : 'hover:bg-paper-2/40',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      status === 'active' && 'bg-signal',
                      status === 'expired' && 'bg-alert',
                      status === 'revoked' && 'bg-graphite/40',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">
                      {s.recipient_label ?? 'Unlabeled'}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
                      {status === 'revoked'
                        ? 'Revoked'
                        : status === 'expired'
                          ? 'Expired'
                          : `${s.viewCount} ${s.viewCount === 1 ? 'view' : 'views'}`}
                    </div>
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
}: {
  documentId: string;
  share: ShareRow;
  analytics: ShareAnalyticsData | undefined;
  toggleShare: (formData: FormData) => Promise<void>;
}) {
  const isRevoked = !!share.revoked_at;
  const isExpired = !!share.expires_at && new Date(share.expires_at) < new Date();
  const isLive = !isRevoked && !isExpired;
  const fullUrl = `https://htmlradar.com/r/${share.slug}`;

  return (
    <section className="space-y-7">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">Share</p>
            <h2 className="text-letterpress mt-2 font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              {share.recipient_label ?? 'Unlabeled'}
            </h2>
          </div>
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

        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3',
            isLive ? 'bg-paper' : 'bg-paper-2/40 opacity-70',
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

        <p className="font-mono text-[11px] text-graphite">{gateSummary(share)}</p>
      </header>

      {!isLive && (
        <div
          className={cn(
            'rounded-xl border border-dashed bg-paper-2/30 px-5 py-4',
            isRevoked ? 'border-graphite/30' : 'border-alert/30',
          )}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">
            {isRevoked ? 'Currently off' : 'Expired'}
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
            {isRevoked
              ? 'Recipients see a 403 page. Flip the switch above to make the link live again — past read history stays intact.'
              : 'The expiry date passed and the link returned a 403 from that point on. To re-share with this recipient, create a new share from the left rail.'}
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
        />
      ) : isLive ? (
        <WaitingInline shareSlug={share.slug} recipientLabel={share.recipient_label} />
      ) : null}
    </section>
  );
}

// Human-readable summary of which gates a share has + expiry.
// Distinguishes "email gate", "password gate", "both", "neither" so the
// "Anonymous · Password" wrong-label issue from the audit doesn't happen.
function gateSummary(share: ShareRow): string {
  const gate = share.require_email
    ? share.require_password
      ? 'Email + password gate'
      : 'Email gate'
    : share.require_password
      ? 'Password gate'
      : 'No gate (anonymous)';
  const expiry = share.expires_at ? `Expires ${formatExpiry(share.expires_at)}` : 'No expiry';
  return `${gate} · ${expiry}`;
}

function WaitingInline({
  shareSlug,
  recipientLabel,
}: {
  shareSlug: string;
  recipientLabel: string | null;
}) {
  const who = recipientLabel ?? 'the recipient';
  return (
    <div className="space-y-4 rounded-xl border border-dashed border-signal/30 bg-paper-2/30 px-5 py-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
          Waiting for first read
        </p>
        <h3 className="mt-2 font-serif text-[20px] leading-snug text-ink md:text-[22px]">
          Send the link to {who}.
        </h3>
        <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          The session list, section dwell, and devices populate here the moment {who} opens the link
          and dwells past three seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
          {`https://htmlradar.com/r/${shareSlug}`}
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
    <form onSubmit={handle} className="flex items-center gap-2.5">
      <input type="hidden" name="share_id" value={shareId} />
      <input type="hidden" name="document_id" value={documentId} />
      <span
        className={cn(
          'font-mono text-[11px] uppercase tracking-[0.16em]',
          visualActive ? 'text-signal-dark' : 'text-graphite',
        )}
      >
        {visualActive ? 'Active' : 'Off'}
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
    </form>
  );
}

/* ============================= Right pane: new ========================== */

function NewSharePane({
  documentId,
  createShare,
}: {
  documentId: string;
  createShare: (formData: FormData) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [requireEmail, setRequireEmail] = useState(true);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState('');
  const [domainsError, setDomainsError] = useState<string | null>(null);

  const validateDomains = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const bad = parts.filter((d) => !DOMAIN_REGEX.test(d));
    if (bad.length === 0) return null;
    return `Not a valid domain: ${bad[0]}`;
  };

  const passwordTooShort = requirePassword && password.length > 0 && password.length < 8;

  const blocked = !!domainsError || (requirePassword && password.length < 8);

  return (
    <section className="space-y-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">New share</p>
        <h2 className="text-letterpress mt-2 font-serif text-[28px] leading-snug text-ink md:text-[32px]">
          A tracked link, just for one recipient.
        </h2>
        <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-soft">
          Each share is its own URL with its own gates (email, password, expiry, domain allow-list).
          Send to one recipient. Track them individually in the dashboard.
        </p>
      </header>

      <form
        action={(fd) => startTransition(() => createShare(fd))}
        className="space-y-7 rounded-2xl border border-line bg-paper p-6 md:p-8"
      >
        <input type="hidden" name="document_id" value={documentId} />

        <Field
          label="Recipient label"
          hint="Free-form. Shown to you in the dashboard. The recipient never sees it."
          optional
        >
          <input
            name="recipient_label"
            placeholder="Marc at Example Ventures"
            maxLength={120}
            className="mt-2 w-full rounded-md border border-line bg-paper px-4 py-3 text-[14.5px] text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
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

        <Field
          label="Password"
          hint={
            requirePassword
              ? 'Recipients type this after the email gate. At least 8 characters.'
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
                requirePassword ? 'At least 4 characters' : 'Disabled — turn on password gate above'
              }
              className={cn(
                'w-full rounded-md border bg-paper px-4 py-3 pr-11 font-mono text-[13.5px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] disabled:cursor-not-allowed disabled:bg-paper-2/40 disabled:text-graphite',
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
              ? 'Comma-separated. Only addresses at these domains can view. Leave blank for any email.'
              : 'Turn on "Require email" above to use this.'
          }
          optional
          inactive={!requireEmail}
          error={domainsError}
        >
          <input
            name="allowed_domains"
            value={allowedDomains}
            disabled={!requireEmail}
            onChange={(e) => {
              setAllowedDomains(e.target.value);
              setDomainsError(validateDomains(e.target.value));
            }}
            placeholder={
              requireEmail
                ? 'example-ventures.test, example-capital.test'
                : 'Disabled — turn on email gate above'
            }
            className={cn(
              'mt-2 w-full rounded-md border bg-paper px-4 py-3 font-mono text-[13.5px] text-ink outline-none transition placeholder:text-graphite/70 focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] disabled:cursor-not-allowed disabled:bg-paper-2/40 disabled:text-graphite',
              domainsError
                ? 'border-alert/60 focus:border-alert'
                : 'border-line focus:border-signal',
            )}
          />
        </Field>

        <Field label="Expires" hint="After this moment, the share returns 403." optional>
          <input
            name="expires_at"
            type="datetime-local"
            className="mt-2 rounded-md border border-line bg-paper px-4 py-3 font-mono text-[13.5px] text-ink outline-none transition focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
          />
        </Field>

        <button
          type="submit"
          disabled={isPending || blocked}
          className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create share'}
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </button>
      </form>
    </section>
  );
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
      await navigator.clipboard.writeText(`https://htmlradar.com/r/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // navigator.clipboard fails in non-secure contexts; ignore silently.
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
