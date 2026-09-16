'use client';

// Settings → Your domain. Type a subdomain, add one CNAME record, watch it go
// Live. That is the whole of what a customer does, and this file is the whole
// of what they see.
//
// Nothing here decides anything. The states come from the row, the transitions
// come from the server actions, and the copy for each state names the one
// thing to do next — the two places a customer gets stuck are "the record is
// not there yet" and "the certificate is still being issued", so those are the
// two sentences.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Copy, Globe } from 'lucide-react';
import { SHARE_HOST } from '@/lib/share-url';

export interface CustomDomainView {
  id: string;
  hostname: string;
  state: 'pending' | 'live' | 'disconnected' | 'retired';
  lastError: string | null;
  // Another account held this hostname before. schema/052 will not let such a
  // row reach 'live', so the DNS instructions would be a waste of the
  // customer's afternoon; they get the one sentence that moves it forward.
  needsReview: boolean;
  // Live AND the account's default. The two can come apart: the write that
  // makes a live domain the default can fail on its own, and until it lands no
  // new link goes here. The panel says which of the two is true rather than
  // promising the second because the first happened.
  isDefault: boolean;
  // The record, in the two shapes DNS providers ask for: a bare label at
  // providers that append the zone, and the whole name at providers that do
  // not. One of the two is always wrong for a given provider, and the customer
  // cannot tell which without seeing both.
  shortName: string;
  fullName: string;
  target: string;
}

type Outcome = { ok: true; state: string; message: string } | { error: string };

export function CustomDomain({
  domain,
  eligible,
  connectAction,
  checkAction,
  disconnectAction,
}: {
  domain: CustomDomainView | null;
  // Pro or comped. False still renders the card for an account that already
  // has a domain, because disconnecting must never depend on the tier.
  eligible: boolean;
  connectAction: (hostname: string) => Promise<Outcome>;
  checkAction: () => Promise<Outcome>;
  disconnectAction: () => Promise<Outcome>;
}) {
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (work: () => Promise<Outcome>) => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await work();
      if ('error' in result) setError(result.error);
      else setNote(result.message);
      router.refresh();
    });
  };

  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="font-serif text-[24px] leading-tight tracking-tightest text-ink">
        Your domain
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft">
        Serve your tracked links from a subdomain of your own — <code>decks.acme.com/r/…</code>{' '}
        rather than ours. Tracking, gates and reports are unchanged. Links you have already sent
        never move.
      </p>

      {!domain && eligible && (
        <form
          className="mt-5 flex max-w-xl flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => connectAction(hostname));
          }}
        >
          <input
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="decks.acme.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Your subdomain"
            className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13.5px] text-ink focus:border-signal focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || !hostname.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper transition hover:bg-signal-dark disabled:opacity-60"
          >
            <Globe className="size-4" />
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {!domain && !eligible && (
        <p className="mt-4 text-[13.5px] text-ink-soft">
          Your own domain is part of Pro.{' '}
          <a
            href="/upgrade?reason=custom_domain"
            className="text-signal-dark underline underline-offset-4 hover:no-underline"
          >
            See Pro
          </a>
        </p>
      )}

      {domain && (
        <div className="mt-5 max-w-xl overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <span className="font-mono text-[14px] text-ink">{domain.hostname}</span>
            <StatusBadge state={domain.state} />
          </div>

          {domain.needsReview && (
            <div className="border-b border-line px-5 py-4 text-[13.5px] leading-relaxed text-ink">
              This domain was connected to another HTMLRadar account before, so we check it over by
              hand before it goes live. Email{' '}
              <a
                href="mailto:hello@htmlradar.com"
                className="text-signal-dark underline underline-offset-4 hover:no-underline"
              >
                hello@htmlradar.com
              </a>{' '}
              and we will reply. Nothing else is needed from you yet.
            </div>
          )}

          {domain.state !== 'live' && !domain.needsReview && (
            <div className="border-b border-line px-5 py-4">
              <p className="text-[13.5px] leading-relaxed text-ink">
                Add this one record at whoever manages DNS for {domain.fullName}. Nothing else is
                needed — no TXT record, no second step.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper-2/40 px-4 py-3">
                <code className="min-w-0 flex-1 font-mono text-[13px] text-ink">
                  {domain.shortName}&nbsp;&nbsp;CNAME&nbsp;&nbsp;{domain.target}
                </code>
                <CopyTarget target={domain.target} />
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-graphite">
                Some providers want the name as <code>{domain.shortName}</code> and others want the
                whole thing, <code>{domain.fullName}</code>. Either is the same record.
              </p>
              {domain.state === 'disconnected' && (
                <p className="mt-3 text-[13px] leading-relaxed text-alert">
                  This domain stopped answering, so links on it are not opening. Put the record back
                  and press Check again.
                </p>
              )}
              {domain.lastError && (
                <p className="mt-3 text-[12.5px] leading-relaxed text-graphite">
                  {domain.lastError}
                </p>
              )}
            </div>
          )}

          {domain.state === 'live' && domain.isDefault && (
            <div className="border-b border-line px-5 py-4 text-[13.5px] leading-relaxed text-ink">
              Every new link goes on {domain.hostname}. Each one can still be created on ours
              instead, from the link form.
            </div>
          )}

          {domain.state === 'live' && !domain.isDefault && (
            <div className="border-b border-line px-5 py-4 text-[13.5px] leading-relaxed text-ink">
              The domain is serving, but we have not managed to make it the address for your new
              links yet, so they are still going out on {SHARE_HOST}. Press Check again.
            </div>
          )}

          {/* Always offered, whatever the state and whatever we have switched
              off at our end. It is how a customer sees what their hostname is
              doing, and how a live domain that failed to become the account's
              default gets made the default. */}
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            {!domain.needsReview && (
              <button
                type="button"
                onClick={() => run(checkAction)}
                disabled={pending}
                className="rounded-md border border-line bg-paper px-4 py-2 font-mono text-[12px] uppercase tracking-[0.16em] text-graphite transition hover:border-signal hover:text-signal-dark disabled:opacity-60"
              >
                {pending ? 'Checking…' : 'Check again'}
              </button>
            )}
            {confirming ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    run(disconnectAction);
                  }}
                  disabled={pending}
                  className="rounded-md border border-alert bg-alert/5 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.16em] text-alert transition hover:bg-alert/10 disabled:opacity-60"
                >
                  Yes, disconnect
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-ink"
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={pending}
                className="rounded-md border border-line bg-paper px-4 py-2 font-mono text-[12px] uppercase tracking-[0.16em] text-graphite transition hover:border-alert hover:text-alert disabled:opacity-60"
              >
                Disconnect
              </button>
            )}
          </div>

          {confirming && (
            <p className="flex items-start gap-2 border-t border-line bg-alert/5 px-5 py-4 text-[13px] leading-relaxed text-ink">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-alert" />
              <span>
                Every link already sent on {domain.hostname} stops opening. There is no way to move
                those links to another address — the people holding them would have to be sent new
                ones. Remove the CNAME record at your DNS provider afterwards.
              </span>
            </p>
          )}
        </div>
      )}

      {note && <p className="mt-3 max-w-xl text-[13px] text-ink-soft">{note}</p>}
      {error && (
        <p className="mt-3 flex max-w-xl items-start gap-2 text-[13px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </section>
  );
}

function StatusBadge({ state }: { state: CustomDomainView['state'] }) {
  const copy: Record<CustomDomainView['state'], { label: string; className: string }> = {
    pending: { label: 'Waiting for DNS', className: 'bg-paper-3 text-graphite' },
    // `needs review` is not a state of its own: the row is pending and the
    // badge beside it says so, while the panel explains why it will stay that
    // way until somebody answers an email.
    live: { label: 'Live', className: 'bg-signal/15 text-signal-dark' },
    disconnected: { label: 'Not answering', className: 'bg-alert/10 text-alert' },
    retired: { label: 'Disconnected', className: 'bg-paper-3 text-graphite' },
  };
  const { label, className } = copy[state];
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${className}`}
    >
      {label}
    </span>
  );
}

/** The value to paste. The name is two words; the target is the part that is retyped wrong. */
function CopyTarget({ target }: { target: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(target);
        } catch {
          // Non-secure contexts reject the clipboard API; the hidden-textarea
          // fallback is what every other copy control in the app uses.
          const el = document.createElement('textarea');
          el.value = target;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:border-signal hover:text-signal-dark"
    >
      {copied ? (
        <Check aria-hidden className="size-3 text-signal" />
      ) : (
        <Copy aria-hidden className="size-3" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
