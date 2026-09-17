'use client';

// Settings → Your domain. Type a subdomain, add one record, watch it go Live.
// That is the whole of what a customer does, and this file is the whole of
// what they see.
//
// WRITTEN FOR SOMEBODY WHO HAS NEVER HEARD OF DNS. The founder walked this
// card on 17 September and it assumed two things a customer does not have:
// that they know what a DNS record is, and that they know where their domain
// is managed. So the card now names their provider (read off the domain's
// nameservers, server-side), gives the clicks in that provider's own menu
// words, shows the three fields as the form they are about to fill in, and
// carries one sentence saying what the record does and what it does not
// touch. The jargon that is left — CNAME — is left because it is a value they
// must type into a box, not a thing they have to understand.
//
// Nothing here decides anything. The states come from the row, the
// transitions come from the server actions. The only behaviour this file owns
// is the timer: while a domain is waiting, the card checks every thirty
// seconds by itself, so nobody sits on a page pressing a button.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Copy, ExternalLink, Globe } from 'lucide-react';
import { SHARE_HOST } from '@/lib/share-url';

/** How often the card asks the server where the domain stands. */
const AUTO_CHECK_MS = 30_000;

export interface CustomDomainView {
  id: string;
  hostname: string;
  state: 'pending' | 'live' | 'disconnected' | 'retired';
  // Cloudflare has the record and is issuing the certificate — the second of
  // the two places a customer gets stuck, and the one where the honest answer
  // is "nothing more to do". Not a state of its own: the row is still pending.
  securing: boolean;
  // Another account held this hostname before. schema/052 will not let such a
  // row reach 'live', so the DNS instructions would be a waste of the
  // customer's afternoon; they get the one sentence that moves it forward.
  needsReview: boolean;
  // Live AND the account's default. The two can come apart: the write that
  // makes a live domain the default can fail on its own, and until it lands no
  // new link goes here. The panel says which of the two is true rather than
  // promising the second because the first happened.
  isDefault: boolean;
  // When the server last looked. Feeds "Checked 20 seconds ago" so the card
  // never looks asleep.
  lastCheckedAt: string | null;
  // The record, in the two shapes DNS providers ask for: a bare label at
  // providers that append the zone, and the whole name at providers that do
  // not. One of the two is always wrong for a given provider, and the customer
  // cannot tell which without seeing both.
  shortName: string;
  fullName: string;
  target: string;
  // The domain they bought, for the sentence that promises the record changes
  // nothing else on it.
  registrable: string;
  // Who manages this domain's DNS, read off its nameservers by the server.
  // `url` is null when the nameservers said nothing we recognise.
  provider: { name: string; url: string | null; steps: string };
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
  // Both start unset so the server and the first client render agree; the
  // timer fills them in. A clock in the markup is a hydration mismatch.
  const [checkedAt, setCheckedAt] = useState<number | null>(() => msOf(domain?.lastCheckedAt));
  const [now, setNow] = useState(0);
  const [lastOutcome, setLastOutcome] = useState('');
  const router = useRouter();

  const run = (work: () => Promise<Outcome>, auto = false) => {
    if (!auto) {
      setError(null);
      setNote(null);
    }
    startTransition(async () => {
      const result = await work();
      const seen = JSON.stringify(result);
      const changed = seen !== lastOutcome;
      setLastOutcome(seen);
      // An automatic check that found nothing new says nothing and reloads
      // nothing: this page fetches the subscription on every render, so a
      // refresh every thirty seconds would be a Polar call every thirty
      // seconds for a card that has not changed.
      if (!auto || changed) {
        if ('error' in result) setError(result.error);
        else setNote(result.message);
        router.refresh();
      }
    });
  };

  // Only while the customer is waiting. Live, disconnected and retired are
  // answers, not waits, and a hidden tab is nobody watching.
  const autoChecking = !!domain && domain.state === 'pending' && !domain.needsReview;

  useEffect(() => {
    if (!autoChecking) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
      if (pending) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (checkedAt !== null && Date.now() - checkedAt < AUTO_CHECK_MS) return;
      setCheckedAt(Date.now());
      run(checkAction, true);
    }, 1000);
    return () => clearInterval(id);
  }, [autoChecking, pending, checkedAt]);

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
            <StatusBadge state={domain.state} securing={domain.securing} />
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
              {domain.securing ? (
                <>
                  <h3 className="text-[15px] font-medium leading-snug text-ink">
                    The record is there
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
                    Nothing more to do. We are setting up the secure connection for{' '}
                    {domain.fullName}, which usually takes a few minutes.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-[15px] font-medium leading-snug text-ink">
                    Add one record where your domain is managed
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
                    {domain.provider.steps}
                    {domain.provider.url && (
                      <>
                        {' '}
                        <a
                          href={domain.provider.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 whitespace-nowrap text-signal-dark underline underline-offset-4 hover:no-underline"
                        >
                          Open {domain.provider.name}
                          <ExternalLink aria-hidden className="size-3" />
                        </a>
                      </>
                    )}
                  </p>
                </>
              )}

              <dl className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper-2/40">
                <RecordField label="Type" value="CNAME" />
                <RecordField
                  label="Name"
                  value={domain.shortName}
                  note={`Some providers want the whole name instead: ${domain.fullName}`}
                />
                <RecordField label="Target" value={domain.target} />
              </dl>

              <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                This record tells the internet that {domain.fullName} should point at HTMLRadar. It
                does not affect anything else on {domain.registrable}.
              </p>

              {!domain.securing && (
                <CopyLine
                  value={instructionsText(domain)}
                  label="Copy instructions for whoever manages your website"
                />
              )}

              {domain.state === 'disconnected' && (
                <p className="mt-3 text-[13px] leading-relaxed text-alert">
                  This domain stopped answering, so links on it are not opening. Put the record back
                  and press Check again.
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
            {autoChecking && now > 0 && (
              <span className="text-[12.5px] leading-relaxed text-graphite">
                {checkedAt === null ? '' : `${checkedLabel(now - checkedAt)} `}We look again every
                30 seconds.
              </span>
            )}
          </div>

          {confirming && (
            <p className="flex items-start gap-2 border-t border-line bg-alert/5 px-5 py-4 text-[13px] leading-relaxed text-ink">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-alert" />
              <span>
                Every link already sent on {domain.hostname} stops opening. There is no way to move
                those links to another address — the people holding them would have to be sent new
                ones. Remove the record at {domain.provider.name} afterwards.
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

/** A timestamp from the row as milliseconds, or null if there isn't one. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** "Checked 20 seconds ago" — proof the page is doing the waiting, not them. */
export function checkedLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 5) return 'Checked just now.';
  if (seconds < 60) return `Checked ${seconds} seconds ago.`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Checked a minute ago.' : `Checked ${minutes} minutes ago.`;
}

/**
 * The whole job, as a message to paste to whoever looks after the website.
 *
 * Plain text and nothing else: it is going into an email, a WhatsApp message
 * or a support ticket, and it has to survive all three.
 */
export function instructionsText(domain: CustomDomainView): string {
  const where = domain.provider.url
    ? `${domain.provider.steps} ${domain.provider.url}`
    : domain.provider.steps;
  return [
    `Please add one DNS record for ${domain.fullName}.`,
    '',
    'Type: CNAME',
    `Name: ${domain.shortName} (some providers want the whole name instead: ${domain.fullName})`,
    `Target: ${domain.target}`,
    '',
    `Where to add it: ${where}`,
    '',
    `This record tells the internet that ${domain.fullName} should point at HTMLRadar. It does not affect anything else on ${domain.registrable}.`,
  ].join('\n');
}

function StatusBadge({ state, securing }: { state: CustomDomainView['state']; securing: boolean }) {
  const copy: Record<CustomDomainView['state'], { label: string; className: string }> = {
    // `needs review` is not a state of its own: the row is pending and the
    // badge beside it says so, while the panel explains why it will stay that
    // way until somebody answers an email.
    pending: securing
      ? { label: 'Almost there, securing the connection', className: 'bg-paper-3 text-graphite' }
      : { label: 'Waiting for the record', className: 'bg-paper-3 text-graphite' },
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

/** One row of the form they are about to fill in, with its own copy button. */
function RecordField({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <dt className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <code className="font-mono text-[13px] text-ink">{value}</code>
        {note && (
          <span className="mt-1 block text-[12px] leading-relaxed text-graphite">{note}</span>
        )}
      </dd>
      <CopyValue value={value} label={label} />
    </div>
  );
}

/** Copy, with the fallback every other copy control in the app uses. */
async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Non-secure contexts reject the clipboard API.
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await copyText(value);
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

function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-paper px-4 py-2 text-[13px] text-graphite transition hover:border-signal hover:text-signal-dark"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5 text-signal" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}
