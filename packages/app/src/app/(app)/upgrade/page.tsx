import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check, AlertCircle } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { readQuota } from '@/lib/quota';
import { PlanChoice } from './PlanChoice';

export const runtime = 'edge';

type SearchParams = Promise<{ reason?: string; plan?: string }>;

export default async function UpgradePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const reason = params.reason;
  const quota = await readQuota(serverClient(), user.id);
  const isQuotaTrigger = reason === 'quota' || reason === 'share_quota' || quota.atCap;

  // Awaited — un-awaited fetches get cancelled on the edge runtime and
  // this event was being dropped ~6 times out of 7 (see auth/callback).
  await captureServerEvent({
    event: 'upgrade.viewed',
    distinctId: user.id,
    userId: user.id,
    properties: { reason: reason ?? 'direct', at_cap: quota.atCap },
  });

  // Already on Pro — don't pitch a second checkout. Rendering the
  // "Upgrade to Pro" card to a paying customer read as a contradictory plan
  // state and let them re-enter checkout.
  if (quota.tier !== 'free') {
    return (
      <div className="mx-auto max-w-2xl space-y-8 py-8">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
            You&rsquo;re on Pro
          </p>
          <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.08] tracking-tightest text-ink md:text-[44px]">
            Pro is <span className="italic text-signal">active.</span>
          </h1>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-soft">
            Your account has unlimited tracked links and the Pro presentation features — nothing
            more to do here. Manage or cancel your plan from settings.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/docs"
            className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
          >
            Back to documents
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/settings"
            className="link-slide inline-flex items-center gap-1.5 text-[14px] text-ink-soft hover:text-signal-dark"
          >
            Billing &amp; settings
          </Link>
        </div>
      </div>
    );
  }

  // POLAR_CHECKOUT_URL is the canonical name; STRIPE_PAYMENT_LINK_URL is
  // the legacy name still set in some envs — read either, prefer the new
  // one, and refuse anything that isn't a Polar host so a bad rotation
  // can't route customers to the wrong processor.
  // Each plan is sold through its own Polar checkout link. A plan whose
  // env var is missing or points somewhere that isn't Polar is simply not
  // offered — the other plan still sells, and if neither resolves the card
  // falls back to the email route below.
  //
  // customer_external_id + customer_email are appended to whichever link is
  // used so Polar's webhook payload identifies which HTMLRadar user paid,
  // and the tier flip happens without anyone running SQL by hand.
  const buildCheckoutUrl = (raw: string | undefined): string | null => {
    if (!raw || raw === '#' || !raw.startsWith('http')) return null;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    // Refuse anything that isn't a Polar host so a bad rotation can't route
    // customers to the wrong processor.
    if (u.hostname !== 'buy.polar.sh' && !u.hostname.endsWith('.polar.sh')) return null;
    u.searchParams.set('customer_external_id', user.id);
    if (user.email) u.searchParams.set('customer_email', user.email);
    return u.toString();
  };

  // POLAR_CHECKOUT_URL is the canonical name; STRIPE_PAYMENT_LINK_URL is
  // the legacy name still set in some envs — read either, prefer the new one.
  const monthlyUrl = buildCheckoutUrl(
    process.env['POLAR_CHECKOUT_URL'] ?? process.env['STRIPE_PAYMENT_LINK_URL'],
  );
  const annualUrl = buildCheckoutUrl(process.env['POLAR_CHECKOUT_URL_ANNUAL']);
  const checkoutAvailable = !!monthlyUrl || !!annualUrl;
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
          {isQuotaTrigger ? 'Free tier cap reached' : 'Upgrade to Pro'}
        </p>
        <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.08] tracking-tightest text-ink md:text-[44px]">
          {isQuotaTrigger ? (
            <>
              Both free links used.{' '}
              <span className="italic text-signal">Pro removes the ceiling.</span>
            </>
          ) : (
            <>
              Pro <span className="italic text-signal">unlocks the rest.</span>
            </>
          )}
        </h1>
        <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-soft">
          {isQuotaTrigger
            ? 'Both free tracked links used. Your existing links and analytics stay exactly where they are — upgrading just lifts the limit.'
            : 'Free covers 2 tracked links, total. Move to Pro for unlimited links, no watermark, and the presentation features that make HTMLRadar look like yours.'}
        </p>
        {quota.tier === 'free' ? (
          <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
            <span className="text-ink tabular-nums">{quota.used}</span>
            <span>of {quota.cap} free links used</span>
          </div>
        ) : null}
      </header>

      <article className="rounded-2xl border border-signal/40 bg-paper p-8 shadow-[0_30px_60px_-30px_rgba(122,31,46,0.25)]">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-signal-dark">
            Hosted, Pro
          </h2>
        </div>
        <ul className="mt-7 space-y-3 text-[14.5px] text-ink-soft">
          {[
            'Unlimited tracked links',
            'Name your own links: htmlradar.com/r/acme-proposal',
            'No “Powered by HTMLRadar” footer on recipient views',
            'Priority support',
            'Coming soon: custom domain (share.yourdomain.com)',
            'Coming soon: dynamic per-viewer watermark',
            'Coming soon: repeat-open alerts',
          ].map((f) => (
            <li key={f} className="flex items-start gap-3">
              <Check aria-hidden className="mt-1 size-3.5 shrink-0 text-signal-dark" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        {checkoutAvailable ? (
          <PlanChoice
            monthlyUrl={monthlyUrl}
            annualUrl={annualUrl}
            initialAnnual={params.plan === 'annual'}
          />
        ) : (
          <>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="font-serif text-[44px] leading-none tracking-tightest text-ink">
                $15
              </span>
              <span className="font-mono text-[12px] text-graphite">
                · per month, cancel anytime
              </span>
            </div>
            <a
              href="mailto:hello@htmlradar.com?subject=Upgrade%20to%20HTMLRadar%20Pro"
              data-cta="upgrade.checkout"
              className="group mt-8 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Email us to upgrade
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </a>
          </>
        )}

        {checkoutAvailable ? null : (
          <p className="mt-4 inline-flex items-start gap-2 text-[12px] leading-relaxed text-alert">
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Hosted checkout is being set up. Email{' '}
            <a
              href="mailto:hello@htmlradar.com"
              className="text-alert underline decoration-alert/40 decoration-2 underline-offset-2 hover:decoration-alert"
            >
              hello@htmlradar.com
            </a>{' '}
            in the meantime and we'll get you on Pro.
          </p>
        )}
      </article>

      <Link
        href="/docs"
        className="link-slide inline-flex items-center gap-1.5 text-[14px] text-ink-soft hover:text-signal-dark"
      >
        <ArrowLeft className="size-4" />
        Back to documents
      </Link>
    </div>
  );
}
