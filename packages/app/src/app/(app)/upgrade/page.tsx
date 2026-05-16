// Cap-hit upsell + Pro tier entry point. v2 pricing (post v4.1 redesign):
// Pro unlocks *presentation* (custom domain on share URLs, chrome
// footer removed, allow-list, longer retention) rather than volume.
// Volume cap on Free is 10 docs lifetime.
//
// v1.0 uses a Stripe Payment Link (no billing integration). When someone
// completes checkout, Stripe emails the founder; the founder manually
// flips `profiles.tier` to `pro` in Supabase. This is the Wizard-of-Oz
// pattern from the Lean Startup playbook — validates demand before
// investing in a real billing webhook + customer portal.
//
// We move to a real Stripe Checkout + webhook flow when ≥5 paying
// customers prove the pricing.

import Link from 'next/link';
import { ArrowRight, ArrowLeft, Check, AlertCircle } from 'lucide-react';
import { requireUser } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';

export const runtime = 'edge';

export default async function UpgradePage() {
  const user = await requireUser();
  // Fire on every render. Free-tier cap-hit users land here as the
  // intended conversion moment; we want to count every view.
  void captureServerEvent({
    event: 'upgrade.viewed',
    distinctId: user.id,
    userId: user.id,
  });
  const rawCheckoutUrl = process.env['STRIPE_PAYMENT_LINK_URL'];
  const checkoutAvailable =
    !!rawCheckoutUrl && rawCheckoutUrl !== '#' && rawCheckoutUrl.startsWith('http');
  // Append customer_external_id + customer_email so Polar's webhook
  // payload identifies which HTMLRadar user paid. Lets the v1.1 webhook
  // handler auto-flip them to Pro without manual SQL.
  const checkoutUrl = checkoutAvailable
    ? (() => {
        const u = new URL(rawCheckoutUrl as string);
        u.searchParams.set('customer_external_id', user.id);
        if (user.email) u.searchParams.set('customer_email', user.email);
        return u.toString();
      })()
    : 'mailto:hello@htmlradar.com?subject=Upgrade%20to%20HTMLRadar%20Pro';
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
          Free tier cap reached
        </p>
        <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.08] tracking-tightest text-ink md:text-[44px]">
          Pro <span className="italic text-signal">unlocks the rest.</span>
        </h1>
        <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink-soft">
          Free covers ten documents lifetime, total. Move to Pro for unlimited documents and the
          presentation features that make HTMLRadar look like yours.
        </p>
      </header>

      <article className="rounded-2xl border border-signal/40 bg-paper p-8 shadow-[0_30px_60px_-30px_rgba(122,31,46,0.25)]">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-signal-dark">
            Hosted, Pro
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
            Wizard-of-Oz checkout
          </span>
        </div>
        <div className="mt-5 flex items-baseline gap-1">
          <span className="font-serif text-[44px] leading-none tracking-tightest text-ink">
            $15
          </span>
          <span className="font-mono text-[12px] text-graphite">· per month, cancel anytime</span>
        </div>

        <ul className="mt-7 space-y-3 text-[14.5px] text-ink-soft">
          {[
            'Unlimited documents',
            'No “Shared with HTMLRadar” footer on recipient views',
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

        <a
          href={checkoutUrl}
          target={checkoutAvailable ? '_blank' : undefined}
          rel={checkoutAvailable ? 'noopener noreferrer' : undefined}
          data-cta="upgrade.checkout"
          className="group mt-8 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
        >
          {checkoutAvailable ? 'Upgrade to Pro' : 'Email us to upgrade'}
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </a>

        {checkoutAvailable ? (
          <p className="mt-4 text-[12px] leading-relaxed text-graphite">
            Payment opens in a new tab. After paying, email{' '}
            <a
              href="mailto:hello@htmlradar.com"
              className="text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal"
            >
              hello@htmlradar.com
            </a>{' '}
            and we'll flip your account to Pro within a few hours.
          </p>
        ) : (
          <p className="mt-4 inline-flex items-start gap-2 text-[12px] leading-relaxed text-alert">
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Hosted checkout is being set up. Email{' '}
            <a
              href="mailto:hello@htmlradar.com"
              className="text-alert underline decoration-alert/40 decoration-2 underline-offset-2 hover:decoration-alert"
            >
              hello@htmlradar.com
            </a>{' '}
            and we'll flip your account to Pro manually within a few hours.
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
