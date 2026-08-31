// /pricing — public pricing page, restyled to match the v2 landing.
//
// Tier model (pricing v4): free hosted with caps (2 tracked links
// lifetime + 100 MB total attachments), Pro $15/mo or $150/yr lifts the caps and
// drops the footer chrome. Self-host under AGPL stays free, no caps.
// Roadmap section is honest about what's NOT in Pro yet.
//
// Visual: shares the landing's design tokens — Newsreader serif
// headlines, cream paper, oxblood signal, mono kickers — by importing
// the same landing-v2.css. The .v2-* classes are reused for nav,
// buttons, kickers, and the dark "self-host" card.

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import { FaqLd } from '@/components/JsonLd';
import { V2Footer } from '@/components/V2Footer';
import { PricingTiers } from './PricingTiers';
import { pageMeta } from '@/lib/seo';
import '../landing-v2.css';

export const dynamic = 'force-static';

export const metadata: Metadata = pageMeta({
  title: 'HTMLRadar Pricing — Free to Start, Open Source',
  description:
    'Simple pricing for tracked HTML documents. Free for 2 tracked links, then $15/mo or $150/yr for unlimited links and no viewer footer. Or self-host free under AGPL-3.0.',
  path: '/pricing',
});

const FAQ = [
  {
    q: 'Is there a free plan?',
    a: 'Yes. The hosted free tier covers 2 tracked links across any number of documents, with full section-level tracking — no credit card needed.',
  },
  {
    q: 'What does Pro add?',
    a: 'Unlimited tracked links, your own link names (htmlradar.page/r/acme-proposal instead of a random one), no "Powered by HTMLRadar" footer on recipient views, and priority support. $15/mo flat — not per seat. Annual billing is $150 a year, which is two months free.',
  },
  {
    q: 'Can I run HTMLRadar for free forever?',
    a: 'Yes — self-host it. The full source is AGPL-3.0 on GitHub and runs on your own Cloudflare and Supabase accounts; their free tiers cover personal use.',
  },
  {
    q: 'Can I cancel, and what happens if I do?',
    a: 'Cancel yourself from settings at any time — no email required. Your plan stays active until the end of the period you have already paid for, then the account returns to the free tier. Payments already made are not refundable.',
  },
  {
    q: 'Do recipients need an account?',
    a: 'No. Recipients just open the link. If you enable the email gate or a password on a share, they verify before the document renders — still no account.',
  },
];

export default function PricingPage() {
  // Both Pro buttons point at /upgrade, never straight at Polar. This page
  // is static and cannot tell who is signed in; /upgrade can, and it is the
  // only place that attaches customer_external_id to the checkout so the
  // payment webhook can match a payment to an account without guessing from
  // the email address. It also turns away anyone already on Pro, which is
  // what stops a monthly subscriber opening a second subscription by buying
  // the annual plan on top of the one they already have.
  const proHref = '/upgrade';

  return (
    <div className="v2-root">
      {/* ─────────────────────── NAV ─────────────────────── */}
      <nav className="v2-nav">
        <div className="logo">
          HTML<span className="ital">radar</span>
        </div>
        <ul>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li>
            <Link href="/#features">What you see</Link>
          </li>
          <li>
            <Link href="/#how">How it works</Link>
          </li>
          <li>
            <Link href="/tools">Tools</Link>
          </li>
          <li>
            <Link href="/pricing">Pricing</Link>
          </li>
        </ul>
        <Link href="/sign-in" className="nav-cta">
          Get started
        </Link>
      </nav>

      {/* ─────────────────────── HERO ─────────────────────── */}
      <section style={{ padding: '140px 56px 60px', maxWidth: 1180, margin: '0 auto' }}>
        <div className="v2-kicker">Pricing</div>
        <h1
          style={{
            fontFamily: 'var(--serif)',
            fontWeight: 700,
            letterSpacing: '-0.025em',
            fontSize: 'clamp(32px, 4.4vw, 68px)',
            lineHeight: 1.05,
            margin: '12px 0 0',
            maxWidth: '20ch',
          }}
        >
          Two links free. <em className="v2-em-italic">Pro</em> past that. Or run it{' '}
          <em className="v2-em-italic">yourself</em>.
        </h1>
        <p
          style={{
            margin: '24px 0 0',
            maxWidth: '52ch',
            fontSize: 17,
            lineHeight: 1.55,
            color: 'var(--ink-2)',
          }}
        >
          Source is AGPL-3.0 on GitHub — run HTMLRadar on your own Cloudflare and Supabase, free
          forever. Or use the hosted version. Free for your first 2 tracked links, Pro when you want
          unlimited links with no &ldquo;Powered by HTMLRadar&rdquo; footer.
        </p>
      </section>

      {/* ─────────────────────── TIERS ─────────────────────── */}
      <section style={{ padding: '40px 56px 100px', maxWidth: 1180, margin: '0 auto' }}>
        <PricingTiers proHref={proHref} />
      </section>

      {/* ─────────────────────── SELF-HOST (dark card) ─────────────────────── */}
      <section className="v2-os" style={{ padding: '40px 56px 100px' }}>
        <div className="v2-os-card">
          <div>
            <div className="kicker">Self-host</div>
            <h2>
              Run it on your own <em>Cloudflare and Supabase</em>.
            </h2>
            <p>
              The full HTMLRadar source is AGPL-3.0. The tracker, the proxy worker, the schema, the
              web app — all of it lives on GitHub. The free tiers on Cloudflare and Supabase cover
              personal use. The repo includes a 15-minute self-hosting guide.
            </p>
            <p style={{ marginTop: '14px' }}>
              Need to use HTMLRadar inside a closed-source product, or run a hosted service without
              AGPL&apos;s copyleft? A commercial license is available —{' '}
              <a
                href="mailto:hello@htmlradar.com"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                email us
              </a>
              .
            </p>
            <a
              className="repo"
              href="https://github.com/htmlradar/htmlradar"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5z" />
              </svg>
              github.com/htmlradar/htmlradar
            </a>
          </div>
          <ul>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>Audit the data path.</b> Recipients can see exactly what&apos;s being tracked.
                Closed-source competitors can&apos;t offer that.
              </span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>No caps when self-hosted.</b> Unlimited documents, unlimited attachments. Pay
                Cloudflare and Supabase directly, not us.
              </span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>AGPL keeps it open.</b> Anyone can fork — but improvements come back. The project
                can&apos;t be swallowed by a larger SaaS.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Sol's messaging review, 31 Aug 2026: a pricing page states what you
          can buy today. The "what we're building next" cards promised custom
          domains, per-viewer watermarks and repeat-open alerts to people
          reading a buy page, so they are gone; the roadmap stays where it is
          actually tracked. */}
      <section style={{ padding: '0 56px 110px', maxWidth: 1180, margin: '0 auto' }}>
        <p
          style={{
            margin: 0,
            maxWidth: '54ch',
            fontSize: 15.5,
            lineHeight: 1.55,
            color: 'var(--ink-2)',
          }}
        >
          The two cards above are what you get today, and nothing on this page is a promise about a
          feature that has not shipped. What gets built next is argued out in the open:
        </p>
        <Link
          href="https://github.com/htmlradar/htmlradar/issues"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 20,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Open an issue on GitHub
          <ArrowUpRight style={{ width: 14, height: 14 }} />
        </Link>
      </section>

      {/* ─────────────────────── FAQ ─────────────────────── */}
      <section style={{ padding: '0 56px 110px', maxWidth: 1180, margin: '0 auto' }}>
        <FaqLd items={FAQ} />
        <div className="v2-kicker">FAQ</div>
        <h2
          style={{
            fontFamily: 'var(--serif)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontSize: 'clamp(24px, 3vw, 40px)',
            lineHeight: 1.15,
            margin: '12px 0 0',
            maxWidth: '30ch',
          }}
        >
          Common questions.
        </h2>
        <dl
          style={{
            margin: '32px 0 0',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
          }}
          className="v2-pricing-grid"
        >
          {FAQ.map(({ q, a }) => (
            <div
              key={q}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '20px 22px',
              }}
            >
              <dt
                style={{
                  fontFamily: 'var(--serif)',
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: 'var(--ink)',
                }}
              >
                {q}
              </dt>
              <dd
                style={{
                  margin: '8px 0 0',
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink-2)',
                }}
              >
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ─────────────────────── FOOTER ─────────────────────── */}
      <V2Footer />

      {/* responsive tweaks scoped inline so they ship without polluting CSS */}
      <style>{`
        @media (max-width: 900px) {
          .v2-pricing-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
