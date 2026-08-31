'use client';

// Stage B complete: share cards with progressive disclosure.
// - Card list (collapsed by default)
// - Click to expand → Link / Who can open / Availability sections
// - Save via editShareAction
// - Revoke + Permanent delete (typed-confirm) at the bottom
// - "Create a new share link" CTA opens a draft card with the same form
//   shape, submitted via createShareFormAction
//
// All server actions reused verbatim from the existing live page —
// DocumentShareManager (1418 lines) is untouched and still serves
// the live /docs/[id] route. Rollback = swap one import.

import { useEffect, useState, useTransition } from 'react';
import { captureClientEvent } from '@/lib/events-client';
import { createShareFormAction } from '../actions';
import { normalizeSlugInput } from '@/lib/share-slug';
import {
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Check,
  Plus,
  X,
  AlertTriangle,
  EyeOff,
  RotateCcw,
} from 'lucide-react';
import type { ShareRow, ShareAnalyticsData } from '../DocumentShareManager';
import { cn } from '@/lib/cn';
import { localInputToIso } from '@/lib/datetime-local';
import { SHARE_HOST, shareUrl } from '@/lib/share-url';

interface ShareCardListProps {
  documentId: string;
  shares: ShareRow[];
  analyticsByShareId: Record<string, ShareAnalyticsData>;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  editShareAction: (formData: FormData) => Promise<void>;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
  // Free-tier link cap (pricing v4). null = pro (unlimited, no counter/gate).
  freeShareCap?: { used: number; cap: number } | null;
}

export function ShareCardList(props: ShareCardListProps) {
  const {
    shares,
    documentId,
    previewShareAction,
    editShareAction,
    toggleShareAction,
    deleteShareAction,
    freeShareCap,
  } = props;
  // freeShareCap is null exactly when the owner is Pro (see v2/page.tsx), so
  // it doubles as the entitlement signal for the link-address field. The
  // database is what actually enforces it (schema/033).
  const isPro = !freeShareCap;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showDraft, setShowDraft] = useState(false);
  const atShareCap = !!freeShareCap && freeShareCap.used >= freeShareCap.cap;

  // Both paying customers converted here — on *seeing* they were at the limit,
  // not on being blocked by it. Neither ever attempted a third link, so
  // free_tier.share_cap_hit (which only fires on a blocked create) has never
  // recorded a single event and never will for a normal user.
  //
  // This is the impression that actually precedes payment, so it is the
  // denominator we were missing: how many people see this card versus how many
  // click through to /upgrade. Without it we can see 2 of 3 upgrade-page views
  // became payments, but not how many people saw the limit and shrugged — which
  // is the number that tells us whether a cap of 2 is right.
  useEffect(() => {
    if (!atShareCap) return;
    void captureClientEvent('free_tier.cap_card_seen', {
      document_id: documentId,
      used: freeShareCap!.used,
      cap: freeShareCap!.cap,
    });
  }, [atShareCap, documentId, freeShareCap]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {!showDraft &&
        (atShareCap ? (
          // Free tier, both links used — gate the create action with an upgrade
          // prompt. (The server action also enforces this; this is the UX.)
          <div className="rounded-2xl border border-dashed border-signal/40 bg-signal/5 p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
              Free plan · {freeShareCap!.used} of {freeShareCap!.cap} links used
            </p>
            <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-soft">
              You&apos;ve used both free tracked links. Upgrade to Pro for unlimited links and no
              watermark.
            </p>
            <a
              href="/upgrade?reason=share_quota"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 font-sans text-[14px] font-medium text-paper hover:bg-signal-dark"
            >
              Upgrade to Pro
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDraft(true)}
            className={cn(
              'group flex w-full items-center gap-3 rounded-2xl border border-dashed border-signal/70 bg-paper p-5 text-left transition-colors hover:bg-paper/60',
            )}
          >
            <span className="grid size-9 place-items-center rounded-full border border-signal/70 text-signal transition-transform group-hover:rotate-90">
              <Plus className="size-4" />
            </span>
            <span className="font-sans text-[14.5px] font-medium text-signal">
              Create a new share link
              {freeShareCap && (
                <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.1em] text-graphite">
                  · {freeShareCap.used} of {freeShareCap.cap} free
                </span>
              )}
            </span>
          </button>
        ))}

      {showDraft && (
        <DraftShareCard
          documentId={documentId}
          isPro={isPro}
          onCancel={() => setShowDraft(false)}
        />
      )}

      {shares.length === 0 && !showDraft && (
        <div className="rounded-2xl border border-dashed border-line bg-paper/40 px-8 py-10 text-center">
          <p className="font-serif text-[22px] font-normal leading-tight tracking-tight text-ink">
            No shares yet.
          </p>
          <p className="mx-auto mt-2 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
            Create a share link above to start tracking who reads this document.
          </p>
        </div>
      )}

      {shares.map((share) => (
        <ShareCard
          key={share.id}
          share={share}
          documentId={documentId}
          isExpanded={expanded.has(share.id)}
          onToggle={() => toggle(share.id)}
          previewShareAction={previewShareAction}
          editShareAction={editShareAction}
          toggleShareAction={toggleShareAction}
          deleteShareAction={deleteShareAction}
        />
      ))}
    </div>
  );
}

// --- Draft card for "create new share" ---

function DraftShareCard({
  documentId,
  isPro,
  onCancel,
}: {
  documentId: string;
  isPro: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-signal/40 bg-paper">
      <div className="flex items-center justify-between border-b border-line/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-signal-soft" />
          <div>
            <div className="font-serif text-[16px] font-medium leading-tight text-ink">
              New share link
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-graphite">
              Fill in the settings below to create
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel new share"
          className="rounded-md p-1 text-graphite hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-5">
        <ShareForm mode="create" documentId={documentId} isPro={isPro} />
      </div>
    </div>
  );
}

interface ShareCardProps {
  share: ShareRow;
  documentId: string;
  isExpanded: boolean;
  onToggle: () => void;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  editShareAction: (formData: FormData) => Promise<void>;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
}

function ShareCard({
  share,
  documentId,
  isExpanded,
  onToggle,
  previewShareAction,
  editShareAction,
  toggleShareAction,
  deleteShareAction,
}: ShareCardProps) {
  const { state, badgeLabel, expiredAt } = deriveState(share);

  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-paper transition-opacity',
        state === 'expired' && !isExpanded && 'opacity-70',
      )}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={cn(
          'grid w-full cursor-pointer items-center gap-4 rounded-2xl px-5 py-4 text-left transition-colors',
          'grid-cols-[auto_1fr_auto_auto] md:grid-cols-[auto_1fr_auto_auto_auto]',
          'hover:bg-paper-2/40',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/40',
        )}
      >
        <StatusDot state={state} />
        <div className="min-w-0">
          <div className="truncate font-serif text-[16px] font-medium leading-tight text-ink">
            {share.recipient_label || 'Untitled share'}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.06em] text-graphite">
            {describeRecipients(share)}
          </div>
        </div>
        <Badge state={state} label={badgeLabel} expiredAt={expiredAt} />
        <div className="hidden text-[12px] text-ink-soft md:block">
          <span className="font-serif text-[16px] font-medium text-ink">{share.viewCount}</span>{' '}
          {share.viewCount === 1 ? 'viewer' : 'viewers'}
        </div>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 text-graphite transition-transform duration-150',
            isExpanded && 'rotate-180',
          )}
        />
      </button>

      {isExpanded && (
        <ExpandedBody
          share={share}
          documentId={documentId}
          previewShareAction={previewShareAction}
          editShareAction={editShareAction}
          toggleShareAction={toggleShareAction}
          deleteShareAction={deleteShareAction}
        />
      )}
    </div>
  );
}

function ExpandedBody({
  share,
  documentId,
  previewShareAction,
  editShareAction,
  toggleShareAction,
  deleteShareAction,
}: {
  share: ShareRow;
  documentId: string;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  editShareAction: (formData: FormData) => Promise<void>;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-7 border-t border-line/60 px-5 py-5">
      <LinkSection share={share} previewShareAction={previewShareAction} />
      <ShareForm mode="edit" share={share} documentId={documentId} action={editShareAction} />
      <ShareActions
        share={share}
        documentId={documentId}
        toggleShareAction={toggleShareAction}
        deleteShareAction={deleteShareAction}
      />
    </div>
  );
}

function LinkSection({
  share,
  previewShareAction,
}: {
  share: ShareRow;
  previewShareAction: (
    formData: FormData,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();

  const url = shareUrl(share.slug, share.host_handle);
  const customSlug = hasCustomSlug(share);

  const onCopy = async () => {
    // "Copied the link" is the closest signal we have to "actually sent
    // it" — the other copy surface (CopySlugButton on the post-create
    // redirect) only sees the first copy, this one sees every revisit.
    void captureClientEvent('share.copied', { slug: share.slug, source: 'share_card' });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard rejects in non-secure contexts; fall back to a
      // hidden-textarea copy so the action never silently no-ops.
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const onPreview = () => {
    setPreviewError(null);
    startPreview(async () => {
      const fd = new FormData();
      fd.set('share_id', share.id);
      const result = await previewShareAction(fd);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    });
  };

  return (
    <section>
      <SectionEyebrow>The link</SectionEyebrow>
      <SectionNote>Send this URL — it always opens whichever version is marked Live.</SectionNote>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-paper-2/40 px-3 py-1.5">
        <code className="flex-1 truncate font-mono text-[12.5px] text-ink-soft">{url}</code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 py-1.5 font-sans text-[12.5px] font-medium text-ink hover:bg-paper-2/60"
        >
          {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 py-1.5 font-sans text-[12.5px] font-medium text-ink hover:bg-paper-2/60"
        >
          <ExternalLink className="size-3.5" />
          Open
        </a>
        <button
          type="button"
          onClick={onPreview}
          disabled={isPreviewing}
          className="inline-flex items-center gap-1.5 rounded-md border border-signal/30 bg-signal/5 px-2.5 py-1.5 font-sans text-[12.5px] font-medium text-signal-dark hover:bg-signal/10 disabled:opacity-60"
        >
          <Eye className="size-3.5" />
          {isPreviewing ? 'Opening…' : 'Preview as you'}
        </button>
      </div>
      {customSlug && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Permanent — the people you sent this to are using it.
        </p>
      )}
      {previewError && <p className="mt-2 text-[12px] text-alert">{previewError}</p>}
    </section>
  );
}

// slug_is_custom arrives from schema/033 but ShareRow is declared in
// DocumentShareManager.tsx, which this component does not own. The page
// selects '*', so the field is there at runtime; read it narrowly rather than
// widening a type that belongs to another file.
function hasCustomSlug(share: ShareRow): boolean {
  return (share as ShareRow & { slug_is_custom?: boolean }).slug_is_custom === true;
}

// Convert the tz-less datetime-local expiry to a true UTC instant in the
// browser (timezone known here) so the server stores the moment the owner
// picked, not a UTC misparse. Empty = no expiry, left as-is. (Fixes the
// [2] timezone bug on the live form — DocumentShareManager was dead.)
function applyLocalExpiry(fd: FormData) {
  const localExpiry = String(fd.get('expires_at') ?? '');
  if (localExpiry) {
    fd.set('expires_at', localInputToIso(localExpiry, new Date(localExpiry).getTimezoneOffset()));
  }
}

function ShareForm({
  mode,
  share,
  documentId,
  action,
  isPro = false,
}: {
  mode: 'create' | 'edit';
  share?: ShareRow;
  documentId: string;
  action?: (formData: FormData) => Promise<void>;
  isPro?: boolean;
}) {
  const [emailGate, setEmailGate] = useState(share?.require_email ?? true);
  const [passwordOn, setPasswordOn] = useState(share?.require_password ?? false);
  const [expiryOn, setExpiryOn] = useState(!!share?.expires_at);
  // Link address (create + Pro only). Controlled so it can be lowercased as
  // the customer types and so a pasted URL can be shortened to its last
  // segment with a visible note.
  const [slug, setSlug] = useState('');
  const [slugShortened, setSlugShortened] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const isCreate = mode === 'create';

  // Create submits through onSubmit rather than the form `action` prop on
  // purpose. A rejected link address must leave the customer looking at the
  // form they filled in — no navigation, no React form reset — so a taken
  // address costs them one field, not the whole form.
  const onCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    applyLocalExpiry(fd);
    setFormError(null);
    startSubmit(async () => {
      const result = await createShareFormAction(fd);
      // A success redirects and never returns.
      if (result) setFormError(result.error);
    });
  };

  return (
    <form
      {...(isCreate
        ? { onSubmit: onCreateSubmit }
        : {
            action: (fd: FormData) => {
              applyLocalExpiry(fd);
              return action!(fd);
            },
          })}
      className="space-y-7"
    >
      <input type="hidden" name="document_id" value={documentId} />
      {mode === 'edit' && share && <input type="hidden" name="share_id" value={share.id} />}

      {/* Label section — always editable */}
      <section>
        <SectionEyebrow>Link name</SectionEyebrow>
        <SectionNote>
          Private. Use this to identify who this link is for in your analytics, such as a person,
          company, or group.
        </SectionNote>
        <div className="mt-3">
          <input
            type="text"
            name="recipient_label"
            defaultValue={share?.recipient_label ?? ''}
            placeholder="e.g. Q2 investors"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-sans text-[14px] text-ink focus:border-signal focus:outline-none"
          />
        </div>
      </section>

      {/* Link address — set once at creation, never afterwards.
          Nothing is copied here from the link name above: that field is
          overwhelmingly the recipient's name or firm, and this one is public. */}
      {isCreate &&
        (isPro ? (
          <section>
            <SectionEyebrow>Link address</SectionEyebrow>
            <SectionNote>
              Public — this is the link your recipient receives. Optional: leave it blank and
              we&apos;ll generate one. It cannot be changed once the link is created.
            </SectionNote>
            <div className="mt-3 flex items-stretch overflow-hidden rounded-md border border-line bg-paper focus-within:border-signal">
              {/* ponytail: the apex host as the prefix, because there is no
                  share yet to carry a stored hostname. Once handle links are
                  switched on (TRUST_HANDLES) a Pro customer naming a link
                  would see the apex here and receive a handle address — read
                  the owner's handle in v2/page.tsx and pass it down when that
                  gate opens. Cosmetic until then: the link created is correct
                  either way. */}
              <span className="shrink-0 border-r border-line bg-paper-2/40 px-3 py-2 font-mono text-[12.5px] leading-normal text-graphite">
                {SHARE_HOST}/r/
              </span>
              <input
                type="text"
                name="slug"
                value={slug}
                onChange={(e) => {
                  const next = normalizeSlugInput(e.target.value);
                  setSlug(next.value);
                  setSlugShortened(next.shortened);
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder="acme-proposal"
                aria-describedby="slug-note"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[12.5px] text-ink focus:outline-none"
              />
            </div>
            {slugShortened && (
              <p id="slug-note" className="mt-2 text-[12px] text-ink-soft">
                We kept the last part of what you pasted — the rest of the address is fixed.
              </p>
            )}
          </section>
        ) : (
          <section>
            <SectionEyebrow>Link address</SectionEyebrow>
            <SectionNote>
              Pro can choose the ending. Free links get a secure random ending.{' '}
              <a
                href="/upgrade?reason=custom_slug"
                className="font-medium text-signal underline underline-offset-2 hover:text-signal-dark"
              >
                See Pro
              </a>
            </SectionNote>
          </section>
        ))}

      {/* Audience section */}
      <section>
        <SectionEyebrow>Who can open it</SectionEyebrow>
        <SectionNote>Decide who gets past the link — by email, by password, or both.</SectionNote>

        <ToggleRow
          label="Email gate"
          desc="Visitors enter their email before the document opens."
          name="require_email"
          checked={emailGate}
          onChange={setEmailGate}
        />
        {/* Without the gate, viewers still group into their own rows with full
            section dwell — they are keyed on a random browser identifier
            (ViewerInsights.tsx), not on a person. So the honest claim is that
            reading data survives and identity does not, and that one person on
            two devices counts twice. Saying "you lose individual analytics"
            would be wrong. */}
        {!emailGate && (
          <p className="mt-2 rounded-md border border-line bg-paper-2/40 px-3 py-2 text-[12.5px] leading-relaxed text-graphite">
            You&rsquo;ll still see which sections were read, but viewers will be anonymous. Each
            browser shows up as Viewer 1, Viewer 2, and so on, so the same person may appear more
            than once. If this link is going to one person, name it after them above so the report
            makes sense later.
          </p>
        )}
        {emailGate && (
          <div className="mt-3 ml-0 space-y-4 border-l-2 border-signal/40 bg-paper-2/30 px-4 py-3 sm:ml-2">
            <FieldBlock
              label="Allowed domains"
              hint="One per line. Anyone with an email at these domains gets in. Leave blank to allow any email."
            >
              <textarea
                name="allowed_domains"
                rows={2}
                defaultValue={(share?.allowed_email_domains ?? []).join('\n')}
                placeholder={'example.com\nexample.org'}
                className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft focus:border-signal focus:outline-none"
              />
            </FieldBlock>
            <FieldBlock
              label="Allowed specific emails"
              hint="One per line. A visitor passes if they match the domains OR this list."
            >
              <textarea
                name="allowed_emails"
                rows={2}
                defaultValue={(share?.allowed_emails ?? []).join('\n')}
                placeholder={'marc@example.com\namrita@example.org'}
                className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft focus:border-signal focus:outline-none"
              />
            </FieldBlock>
          </div>
        )}

        <div className="mt-4">
          <ToggleRow
            label="Password"
            desc="Visitors must type a password before the document opens."
            name="require_password"
            checked={passwordOn}
            onChange={setPasswordOn}
          />
        </div>
        {passwordOn && (
          <div className="mt-3 ml-0 border-l-2 border-signal/40 bg-paper-2/30 px-4 py-3 sm:ml-2">
            <FieldBlock
              label="Link password"
              hint={
                share?.require_password
                  ? 'Leave blank to keep the existing password. Type a new one to replace it.'
                  : 'Minimum 8 characters. Share separately from the link, never in the same message.'
              }
            >
              <input
                type="text"
                name="password"
                autoComplete="off"
                placeholder={share?.require_password ? '••••••••' : 'Set a password'}
                className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft focus:border-signal focus:outline-none"
              />
            </FieldBlock>
          </div>
        )}
      </section>

      {/* Availability section — expiry + lock_deck */}
      <section>
        <SectionEyebrow>Availability</SectionEyebrow>
        <SectionNote>Control when the link works and whether the file can be saved.</SectionNote>

        <ToggleRow
          label="Set an expiry date"
          desc='After this moment the link shows an "Expired" notice.'
          name="__expiry_on"
          checked={expiryOn}
          onChange={(next) => setExpiryOn(next)}
        />
        {expiryOn ? (
          <div className="mt-3 ml-0 border-l-2 border-signal/40 bg-paper-2/30 px-4 py-3 sm:ml-2">
            <FieldBlock
              label="Expires on"
              hint="Local time. The link auto-closes the moment this passes."
            >
              <input
                type="datetime-local"
                name="expires_at"
                defaultValue={toDateTimeLocal(share?.expires_at ?? null)}
                className="w-full max-w-[280px] rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft focus:border-signal focus:outline-none"
              />
            </FieldBlock>
          </div>
        ) : (
          // When OFF, send an empty value so editShareAction sets expires_at to NULL.
          <input type="hidden" name="expires_at" value="" />
        )}

        <div className="mt-4">
          <ToggleRow
            label="Lock HTML downloads"
            desc="Viewers can read the document but can't save the HTML file."
            name="lock_deck"
            checked={share?.lock_deck ?? true}
            onChange={() => {}}
            uncontrolled
          />
        </div>
      </section>

      <div className="border-t border-line/60 pt-5">
        {formError && (
          <p role="alert" className="mb-3 text-[13px] leading-relaxed text-alert">
            {formError}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2 font-sans text-[14px] font-medium text-paper shadow-sm hover:bg-signal-dark disabled:opacity-60"
          >
            {isCreate ? (submitting ? 'Creating…' : 'Create link') : 'Save changes'}
          </button>
        </div>
      </div>
    </form>
  );
}

// --- ShareActions (Revoke / Reactivate + Delete) — Phase 8 ---

function ShareActions({
  share,
  documentId,
  toggleShareAction,
  deleteShareAction,
}: {
  share: ShareRow;
  documentId: string;
  toggleShareAction: (formData: FormData) => Promise<void>;
  deleteShareAction: (formData: FormData) => Promise<void>;
}) {
  const isRevoked = !!share.revoked_at;
  const [showDelete, setShowDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const canDelete = typed.trim().toUpperCase() === 'DELETE';
  // A link whose address the owner chose is never destroyed: freeing the
  // address would let a later customer take it, and a recipient opening an
  // old email would land on a stranger's document. The database refuses the
  // delete too (trg_block_custom_slug_delete, schema/033).
  const customSlug = hasCustomSlug(share);

  return (
    <section className="border-t border-line/60 pt-5">
      <SectionEyebrow>Actions</SectionEyebrow>
      <SectionNote>
        {customSlug
          ? 'Revoke switches the link off, and you can switch it back on. You chose this address, so it stays reserved to you and cannot be deleted.'
          : 'Revoke pauses the link (recoverable). Delete removes it forever (history goes with it).'}
      </SectionNote>

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={toggleShareAction}>
          <input type="hidden" name="share_id" value={share.id} />
          <input type="hidden" name="document_id" value={documentId} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 font-sans text-[12.5px] font-medium text-ink hover:bg-paper-2/60"
          >
            {isRevoked ? (
              <>
                <RotateCcw className="size-3.5" />
                Reactivate
              </>
            ) : (
              <>
                <EyeOff className="size-3.5" />
                Revoke
              </>
            )}
          </button>
        </form>
        {!showDelete && !customSlug && (
          <button
            type="button"
            onClick={() => {
              setShowDelete(true);
              setTyped('');
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-alert/30 bg-alert/5 px-3 py-1.5 font-sans text-[12.5px] font-medium text-alert hover:bg-alert/10"
          >
            <AlertTriangle className="size-3.5" />
            Delete forever
          </button>
        )}
      </div>

      {showDelete && !customSlug && (
        <form
          action={deleteShareAction}
          className="mt-4 rounded-lg border border-alert/30 bg-alert/5 p-4"
        >
          <input type="hidden" name="share_id" value={share.id} />
          <input type="hidden" name="document_id" value={documentId} />
          <p className="font-serif text-[14px] text-ink">
            This removes the URL and its read history for good. Type{' '}
            <strong className="font-semibold">DELETE</strong> to confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="confirmation"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[12.5px] uppercase tracking-wider text-ink focus:border-alert focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canDelete}
              className="inline-flex items-center gap-1.5 rounded-md bg-alert px-3 py-1.5 font-sans text-[12.5px] font-medium text-paper hover:bg-alert/90 disabled:opacity-50"
            >
              Delete this link
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(false)}
              className="rounded-md px-3 py-1.5 font-sans text-[12.5px] font-medium text-graphite hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- small reusable subcomponents ---

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-serif text-[18px] font-semibold leading-tight tracking-tight text-ink">
      {children}
    </h3>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{children}</p>;
}

function ToggleRow({
  label,
  desc,
  name,
  checked,
  onChange,
  uncontrolled,
}: {
  label: string;
  desc: string;
  name: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  // When true, the checkbox is uncontrolled (defaultChecked) so the user
  // can flip it freely and the form submission reads the current DOM
  // value. Use for cases like lock_deck where we don't need React state
  // to mirror it for conditional rendering.
  uncontrolled?: boolean;
}) {
  // The "__expiry_on" toggle is UI-only — strip its name so it doesn't
  // ship in the form payload (the actual `expires_at` field carries the
  // value when on, or an empty hidden input when off).
  const submittedName = name.startsWith('__') ? undefined : name;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-serif text-[15px] font-medium text-ink">{label}</div>
        <div className="mt-1 text-[12.5px] text-ink-soft">{desc}</div>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        {uncontrolled ? (
          <input
            type="checkbox"
            name={submittedName}
            defaultChecked={checked}
            aria-label={label}
            className="peer sr-only"
          />
        ) : (
          <input
            type="checkbox"
            name={submittedName}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={label}
            className="peer sr-only"
          />
        )}
        <span
          aria-hidden
          className={cn(
            'h-6 w-11 rounded-full border transition-colors peer-checked:border-signal peer-checked:bg-signal peer-focus-visible:ring-2 peer-focus-visible:ring-signal/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-paper',
            !uncontrolled && checked ? 'border-signal bg-signal' : 'border-line bg-paper-2',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'absolute left-0.5 top-0.5 size-5 rounded-full bg-paper shadow transition-transform peer-checked:translate-x-5',
            !uncontrolled && checked && 'translate-x-5',
          )}
        />
      </label>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-serif text-[13.5px] font-medium text-ink-soft">{label}</div>
      {children}
      <div className="mt-1.5 text-[11.5px] leading-relaxed text-graphite">{hint}</div>
    </div>
  );
}

// --- visual helpers ---

type DerivedState = 'live' | 'revoked' | 'expired';

function deriveState(share: ShareRow): {
  state: DerivedState;
  badgeLabel: string;
  expiredAt: string | null;
} {
  if (share.revoked_at) return { state: 'revoked', badgeLabel: 'Revoked', expiredAt: null };
  if (share.expires_at) {
    const exp = new Date(share.expires_at).getTime();
    if (exp < Date.now()) {
      return {
        state: 'expired',
        badgeLabel: `Expired ${formatShortDate(share.expires_at)}`,
        expiredAt: share.expires_at,
      };
    }
  }
  return { state: 'live', badgeLabel: 'Active', expiredAt: null };
}

function describeRecipients(share: ShareRow): string {
  const parts: string[] = [];
  const domainCount = share.allowed_email_domains?.length ?? 0;
  const emailCount = share.allowed_emails?.length ?? 0;
  if (share.require_email) {
    if (domainCount + emailCount === 0) parts.push('Email gate · any email');
    else {
      if (domainCount) parts.push(`${domainCount} domain${domainCount === 1 ? '' : 's'}`);
      if (emailCount) parts.push(`${emailCount} email${emailCount === 1 ? '' : 's'}`);
    }
  } else {
    parts.push('No email gate');
  }
  if (share.require_password) parts.push('password');
  return parts.join(' · ');
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function StatusDot({ state }: { state: DerivedState }) {
  const cls = state === 'live' ? 'bg-good' : state === 'expired' ? 'bg-signal' : 'bg-graphite';
  return <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', cls)} />;
}

function Badge({
  state,
  label,
  expiredAt,
}: {
  state: DerivedState;
  label: string;
  expiredAt: string | null;
}) {
  const base =
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em]';
  const tones: Record<DerivedState, string> = {
    live: 'border-good/40 bg-good/10 text-good',
    expired: 'border-signal/40 bg-signal-soft/40 text-signal',
    revoked: 'border-line bg-paper-2 text-graphite',
  };
  return (
    <span className={cn(base, tones[state])}>
      {state === 'expired' && expiredAt && <Clock aria-hidden className="size-3" />}
      {label}
    </span>
  );
}
