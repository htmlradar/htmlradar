'use client';

// The two hosted tiers plus the monthly/annual switch.
//
// Client component only because the switch holds state. The page around it
// stays static — the switch changes which price the Pro card shows and where
// its button points, nothing else.
//
// Both Pro buttons route through the app rather than straight to Polar. That
// is deliberate: /upgrade attaches customer_external_id to the checkout so the
// payment webhook can match the payment to an account without guessing from
// the email address, and it turns away anyone who is already on Pro, which is
// what stops a monthly subscriber accidentally opening a second subscription
// by buying the annual plan on top of their existing one.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

const MONTHLY_PRICE = 15;
const ANNUAL_PRICE = 150;
// 12 months at the monthly rate, shown struck through next to the annual
// price. $180 against $150 is two months free; if either number moves, this
// derives rather than drifts.
const ANNUAL_AT_MONTHLY_RATE = MONTHLY_PRICE * 12;
const MONTHS_FREE = Math.round((ANNUAL_AT_MONTHLY_RATE - ANNUAL_PRICE) / MONTHLY_PRICE);

const FREE_FEATURES = [
  '2 tracked links (lifetime)',
  'Unlimited documents',
  'Section-level dwell tracking, per recipient',
  'Email gate, password, expiry, revoke per share',
  'Email-domain and per-email allow-lists',
  'Files attached to a deck: 20 files · 25 MB each · 100 MB per doc',
  'Per-share download permission, every download logged',
  'Link names are picked for you: htmlradar.page/r/swift-falcon-a3f9c2',
  '“Powered by HTMLRadar” footer on the viewer',
];

const PRO_FEATURES = [
  'Everything in Free, plus:',
  'Unlimited tracked links',
  'Name your own links: htmlradar.page/r/acme-proposal',
  'No HTMLRadar promotion in the footer on recipient views',
  'Priority email support, response inside one business day',
];

export function PricingTiers({ proHref }: { proHref: string }) {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <BillingSwitch annual={annual} onChange={setAnnual} />
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}
        className="v2-pricing-grid"
      >
        <Tier
          name="Hosted · Free"
          price="$0"
          cadence="forever"
          description="Not a trial — the two links stay free, with the full tracking on both."
          features={FREE_FEATURES}
          ctaLabel="Start free"
          ctaHref="/sign-in"
          ctaPrimary={false}
        />
        <Tier
          name="Hosted · Pro"
          price={annual ? `$${ANNUAL_PRICE}` : `$${MONTHLY_PRICE}`}
          cadence={annual ? 'per year, cancel anytime' : 'per month, cancel anytime'}
          priceNote={
            annual ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 10,
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  letterSpacing: '0.04em',
                }}
              >
                <span
                  style={{
                    textDecoration: 'line-through',
                    color: 'rgba(255,255,255,0.45)',
                  }}
                >
                  ${ANNUAL_AT_MONTHLY_RATE}
                </span>
                <span
                  style={{
                    background: 'var(--pop)',
                    color: 'var(--pop-ink)',
                    borderRadius: 999,
                    padding: '3px 9px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    fontSize: 10,
                  }}
                >
                  {MONTHS_FREE} months free
                </span>
              </span>
            ) : null
          }
          accent
          description="For founders and consultants who send real diligence packages."
          features={PRO_FEATURES}
          ctaLabel="Upgrade to Pro"
          ctaHref={annual ? `${proHref}?plan=annual` : proHref}
          ctaPrimary
        />
      </div>
    </>
  );
}

/* ───────── Monthly / annual switch ───────── */

function BillingSwitch({
  annual,
  onChange,
}: {
  annual: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 14,
        margin: '0 0 36px',
        flexWrap: 'wrap',
      }}
    >
      <div
        role="tablist"
        aria-label="Billing period"
        style={{
          display: 'inline-flex',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: 4,
          gap: 2,
        }}
      >
        <SwitchOption label="Monthly" selected={!annual} onSelect={() => onChange(false)} />
        <SwitchOption label="Annual" selected={annual} onSelect={() => onChange(true)} />
      </div>
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--brand)',
        }}
      >
        Annual = {MONTHS_FREE} months free
      </span>
    </div>
  );
}

function SwitchOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        appearance: 'none',
        border: 'none',
        cursor: 'pointer',
        borderRadius: 999,
        padding: '9px 22px',
        fontFamily: 'var(--mono)',
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: selected ? 'var(--brand)' : 'transparent',
        color: selected ? '#fff' : 'var(--ink-3)',
        transition: 'background 140ms ease, color 140ms ease',
      }}
    >
      {label}
    </button>
  );
}

/* ───────── Tier card ───────── */

interface TierProps {
  name: string;
  price: string;
  cadence: string;
  description?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaPrimary: boolean;
  accent?: boolean;
  priceNote?: React.ReactNode;
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
  priceNote = null,
}: TierProps) {
  return (
    // Box shadows live in landing-v2.css rules (.pricing-tier and
    // .pricing-tier[data-accent='true']) so the :hover variant can
    // actually override them. Inline styles win over external CSS by
    // specificity rules, so an inline boxShadow here would have left
    // the hover state with a lift but no deepened shadow — caught by
    // the static-audit pass on 2026-05-19.
    <article
      className="pricing-tier"
      data-accent={accent ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: accent ? 'var(--ink)' : 'var(--card)',
        color: accent ? '#fff' : 'var(--ink)',
        border: `1px solid ${accent ? 'var(--ink)' : 'var(--line)'}`,
        borderRadius: 16,
        padding: '32px 32px 28px',
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 18 }}>
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
      {/* Reserved whether or not a note is showing, so switching between
          monthly and annual doesn't make the two cards jump height. */}
      <div style={{ minHeight: 38 }}>{priceNote}</div>
      {description && (
        <p
          style={{
            margin: '10px 0 0',
            maxWidth: '32ch',
            fontSize: 14,
            lineHeight: 1.55,
            color: accent ? 'rgba(255,255,255,0.7)' : 'var(--ink-2)',
          }}
        >
          {description}
        </p>
      )}
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
        <Link
          href={ctaHref}
          data-cta={ctaPrimary ? 'pricing.upgrade' : 'pricing.start_free'}
          className={ctaPrimary ? 'v2-btn' : 'v2-btn v2-btn-ghost'}
          style={ctaPrimary ? { background: 'var(--brand)', color: '#fff' } : undefined}
        >
          {ctaLabel}
          <ArrowRight style={{ width: 16, height: 16 }} />
        </Link>
      </div>
    </article>
  );
}
