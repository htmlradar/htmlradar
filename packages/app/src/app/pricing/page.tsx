// /pricing — public pricing page, restyled to match the v2 landing.
//
// Tier model unchanged from v1: free hosted with caps (10 documents
// lifetime + 100 MB total attachments), Pro $15/mo lifts the caps and
// drops the footer chrome. Self-host under AGPL stays free, no caps.
// Roadmap section is honest about what's NOT in Pro yet.
//
// Visual: shares the landing's design tokens — Newsreader serif
// headlines, cream paper, oxblood signal, mono kickers — by importing
// the same landing-v2.css. The .v2-* classes are reused for nav,
// buttons, kickers, and the dark "self-host" card.

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import type { Metadata } from 'next';
import '../landing-v2.css';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Open source under AGPL-3.0. Run it yourself, free forever. Or use the hosted version — free for 10 documents, $15/mo for unlimited.',
};

export default function PricingPage() {
  const stripeUrl = process.env['STRIPE_PAYMENT_LINK_URL'] ?? '#';

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
          Free for ten. <em className="v2-em-italic">Pro</em> past that. Or run it{' '}
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
          forever. Or use the hosted version. Free for the first ten documents, Pro when you want to
          send from your own domain with no &ldquo;Shared with HTMLRadar&rdquo; footer.
        </p>
      </section>

      {/* ─────────────────────── TIERS ─────────────────────── */}
      <section style={{ padding: '40px 56px 100px', maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
          }}
          className="v2-pricing-grid"
        >
          <Tier
            name="Hosted · Free"
            price="$0"
            cadence="forever"
            description="Enough for an early fundraise or a few client decks."
            features={[
              '10 documents lifetime',
              'Unlimited shares per document',
              'Section-level dwell tracking, per recipient',
              'Email gate, password, expiry, revoke per share',
              'Email-domain and per-email allow-lists',
              'Files attached to a deck: 20 files · 25 MB each · 100 MB per doc',
              'Per-share download permission, every download logged',
              'Real-time email when a real read happens',
              '“Shared with HTMLRadar” footer on the viewer',
            ]}
            ctaLabel="Start free"
            ctaHref="/sign-in"
            ctaPrimary={false}
          />
          <Tier
            name="Hosted · Pro"
            price="$15"
            cadence="per month, cancel anytime"
            accent
            description="For founders and consultants who send real diligence packages."
            features={[
              'Everything in Free, plus:',
              'Unlimited documents',
              'Files attached: 50 files · 100 MB each · 1 GB per doc',
              'No “Shared with HTMLRadar” footer on recipient views',
              'Priority email support, response inside one business day',
            ]}
            ctaLabel="Upgrade to Pro"
            ctaHref={stripeUrl}
            ctaPrimary
            external
          />
        </div>
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

      {/* ─────────────────────── ROADMAP ─────────────────────── */}
      <section style={{ padding: '0 56px 110px', maxWidth: 1180, margin: '0 auto' }}>
        <div className="v2-kicker">Roadmap</div>
        <h2
          style={{
            fontFamily: 'var(--serif)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontSize: 'clamp(24px, 3vw, 40px)',
            lineHeight: 1.15,
            margin: '12px 0 18px',
            maxWidth: '30ch',
          }}
        >
          What we&apos;re building next.
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: '54ch',
            fontSize: 15.5,
            lineHeight: 1.55,
            color: 'var(--ink-2)',
          }}
        >
          Public-visible and trackable on GitHub. Nothing here is promised inside the Pro tier above
          — it moves into Pro the moment it&apos;s shipped, not before.
        </p>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '36px 0 0',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
          }}
          className="v2-pricing-roadmap"
        >
          <RoadmapItem
            kicker="Custom domain"
            body="share.yourdomain.com on every link, no HTMLRadar in the URL."
          />
          <RoadmapItem
            kicker="Per-viewer watermark"
            body="Recipient&rsquo;s email overlaid on the page so a leaked screenshot is traceable."
          />
          <RoadmapItem
            kicker="Repeat-open alerts"
            body="Notify when someone re-opens a deck after their first read."
          />
        </ul>
        <Link
          href="https://github.com/htmlradar/htmlradar/issues?q=is%3Aissue+label%3Aroadmap"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 28,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Track + vote on GitHub
          <ArrowUpRight style={{ width: 14, height: 14 }} />
        </Link>
      </section>

      {/* ─────────────────────── FOOTER ─────────────────────── */}
      <footer className="v2-foot">
        <div>
          HTML
          <span style={{ color: 'var(--brand)', fontFamily: 'var(--serif)', fontStyle: 'italic' }}>
            radar
          </span>
          {' · Document tracking for HTML. Open source · AGPL-3.0.'}
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Link href="/">Home</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/privacy">Privacy</Link>
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </footer>

      {/* responsive tweaks scoped inline so they ship without polluting CSS */}
      <style>{`
        @media (max-width: 900px) {
          .v2-pricing-grid { grid-template-columns: 1fr !important; }
          .v2-pricing-roadmap { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/* ───────── Tier card ───────── */

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
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: accent ? 'var(--ink)' : 'var(--card)',
        color: accent ? '#fff' : 'var(--ink)',
        border: `1px solid ${accent ? 'var(--ink)' : 'var(--line)'}`,
        borderRadius: 16,
        padding: '32px 32px 28px',
        boxShadow: accent
          ? '0 30px 60px -20px rgba(42,24,18,0.30)'
          : '0 18px 40px -20px rgba(31,17,8,0.10)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: accent ? 'var(--pop)' : 'var(--ink-3)',
        }}
      >
        {name}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          marginTop: 18,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 'clamp(40px, 4.6vw, 64px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {price}
        </span>
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            color: accent ? 'rgba(255,255,255,0.55)' : 'var(--ink-3)',
          }}
        >
          · {cadence}
        </span>
      </div>
      <p
        style={{
          margin: '12px 0 0',
          maxWidth: '32ch',
          fontSize: 14,
          lineHeight: 1.55,
          color: accent ? 'rgba(255,255,255,0.7)' : 'var(--ink-2)',
        }}
      >
        {description}
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '24px 0 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
        }}
      >
        {features.map((f) => (
          <li
            key={f}
            style={{
              display: 'grid',
              gridTemplateColumns: '14px 1fr',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: 13.5,
              lineHeight: 1.55,
              color: accent ? 'rgba(255,255,255,0.85)' : 'var(--ink-2)',
            }}
          >
            <Check
              aria-hidden
              style={{
                width: 14,
                height: 14,
                marginTop: 3,
                color: accent ? 'var(--pop)' : 'var(--brand)',
                flexShrink: 0,
              }}
              strokeWidth={2.2}
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 28 }}>
        {ctaPrimary ? (
          <a
            href={ctaHref}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            data-cta="pricing.upgrade"
            className="v2-btn"
            style={{
              background: 'var(--brand)',
              color: '#fff',
            }}
          >
            {ctaLabel}
            <ArrowRight style={{ width: 16, height: 16 }} />
          </a>
        ) : (
          <Link href={ctaHref} data-cta="pricing.start_free" className="v2-btn v2-btn-ghost">
            {ctaLabel}
            <ArrowRight style={{ width: 16, height: 16 }} />
          </Link>
        )}
      </div>
    </article>
  );
}

/* ───────── Roadmap item ───────── */

function RoadmapItem({ kicker, body }: { kicker: string; body: string }) {
  return (
    <li
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10.5,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--ink-3)',
        }}
      >
        {kicker}
      </span>
      <span
        style={{
          fontFamily: 'var(--serif)',
          fontSize: 16,
          lineHeight: 1.4,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
        }}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </li>
  );
}
