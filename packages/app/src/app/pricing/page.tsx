// /pricing — public pricing page. v2 model: free hosted with a small cap
// (10 docs lifetime), Pro $15/mo unlocks *presentation* (custom domain,
// no chrome footer, allow-list, longer retention) rather than volume.
// Self-host stays AGPL-3.0 free, no caps. Stripe Payment Link URL is
// read from env at render time so the live deploy reads from Vercel's
// env, while local dev falls back to a `#` href.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import type { Metadata } from 'next';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Open source under AGPL-3.0. Run it yourself on Cloudflare and Supabase, free forever. Or use the hosted version — free for 10 documents, $15/month for unlimited and custom-domain shares.',
};

export default function PricingPage() {
  const stripeUrl = process.env['STRIPE_PAYMENT_LINK_URL'] ?? '#';

  return (
    <>
      <NavBar />
      <main className="relative">
        <section className="mx-auto max-w-5xl px-6 py-20 md:py-28">
          <Reveal reveal={false}>
            <SectionMark>Pricing</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 max-w-3xl font-serif text-[44px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[60px]">
              Open source under <span className="italic text-signal">AGPL-3.0.</span>
            </h1>
          </Reveal>

          <Reveal reveal={false} delay={0.12}>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-soft">
              Run HTMLRadar on your own Cloudflare and Supabase, free forever. Or use the hosted
              version — free for the first ten documents, Pro when you want to send from your own
              domain.
            </p>
          </Reveal>

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <Reveal delay={0.1}>
              <Tier
                name="Hosted, Free"
                price="$0"
                cadence="forever"
                description="Enough for an early fundraise or a few client decks."
                features={[
                  '10 documents lifetime',
                  'Unlimited shares per document',
                  'Section-level dwell, per recipient',
                  'Email gate, password, expiry, revoke',
                  'Real-time email when a real read happens',
                  '“Shared with HTMLRadar” chrome footer on the viewer',
                  '30-day analytics retention',
                ]}
                ctaLabel="Start free"
                ctaHref="/sign-in"
                ctaPrimary={false}
              />
            </Reveal>

            <Reveal delay={0.18}>
              <Tier
                name="Hosted, Pro"
                price="$15"
                cadence="per month, cancel anytime"
                accent
                description="Send from your own domain, with the chrome gone. For founders, agencies, and consultants whose presentation is the product."
                features={[
                  'Everything in Free, plus:',
                  'Custom domain on share URLs (share.yourdomain.com)',
                  '“Shared with HTMLRadar” chrome footer removed',
                  'Allow-list by recipient email domain',
                  '90-day analytics retention',
                  'Priority support',
                ]}
                ctaLabel="Upgrade to Pro"
                ctaHref={stripeUrl}
                ctaPrimary
                external
              />
            </Reveal>
          </div>

          <Reveal delay={0.28}>
            <section className="mt-24 border-t border-line pt-12">
              <SectionMark>Self-host</SectionMark>
              <h2 className="mt-6 max-w-2xl font-serif text-[28px] leading-snug text-ink md:text-[34px]">
                Run the whole thing on your own infrastructure, free.
              </h2>
              <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
                The full HTMLRadar source is AGPL-3.0 on{' '}
                <a
                  href="https://github.com/htmlradar/htmlradar"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  GitHub
                </a>
                . The repo includes the schema, the proxy worker, the tracker, the web app, and a
                15-minute self-hosting guide. Cloudflare and Supabase free tiers cover personal use.
              </p>
              <Link
                href="https://github.com/htmlradar/htmlradar"
                className="link-slide mt-6 inline-flex items-center gap-1.5 text-[14px] text-ink-soft hover:text-signal-dark"
              >
                Read the source
                <ArrowUpRight className="size-4" />
              </Link>
            </section>
          </Reveal>
        </section>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
            <div className="font-mono text-[12px] tracking-wide text-graphite">
              HTML<span className="text-signal">Radar</span>. Know who's reading.
            </div>
            <nav className="flex flex-wrap items-center gap-x-7 gap-y-3 font-mono text-[12px] text-graphite">
              <Link href="/why" className="link-slide hover:text-signal-dark">
                Why this exists
              </Link>
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="link-slide hover:text-signal-dark"
                target="_blank"
                rel="noopener"
              >
                GitHub
              </a>
              <Link href="/pricing" className="link-slide hover:text-signal-dark">
                Pricing
              </Link>
              <Link href="/privacy" className="link-slide hover:text-signal-dark">
                Privacy
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  );
}

interface TierProps {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaPrimary: boolean;
  accent?: boolean;
  external?: boolean;
}

function Tier({
  name,
  price,
  cadence,
  description,
  features,
  ctaLabel,
  ctaHref,
  ctaPrimary,
  accent = false,
  external = false,
}: TierProps) {
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-paper p-8 md:p-10 ${
        accent
          ? 'border-signal/40 shadow-[0_30px_60px_-30px_rgba(122,31,46,0.25)]'
          : 'border-line shadow-[0_18px_40px_-30px_rgba(31,17,8,0.18)]'
      }`}
    >
      <header>
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-signal-dark">
            {name}
          </h2>
        </div>
        <div className="mt-6 flex items-baseline gap-1">
          <span className="font-serif text-[44px] leading-none tracking-tightest text-ink md:text-[52px]">
            {price}
          </span>
          <span className="font-mono text-[12px] text-graphite">· {cadence}</span>
        </div>
        <p className="mt-3 max-w-[32ch] text-[14px] leading-relaxed text-ink-soft">{description}</p>
      </header>

      <ul className="mt-8 space-y-3 text-[14.5px] text-ink-soft">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <Check aria-hidden className="mt-1 size-3.5 shrink-0 text-signal-dark" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-10 pt-0">
        {ctaPrimary ? (
          <a
            href={ctaHref}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
          >
            {ctaLabel}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
        ) : (
          <Link
            href={ctaHref}
            className="group inline-flex items-center gap-2 rounded-md border border-line bg-paper-2/50 px-6 py-3 text-[15px] font-medium text-ink transition hover:border-signal hover:text-signal-dark"
          >
            {ctaLabel}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </article>
  );
}
