'use client';

// Monthly / annual choice on the in-app upgrade page.
//
// Both checkout URLs are built on the server so each already carries
// customer_external_id and customer_email — that is what lets the Polar
// webhook match the payment to this account rather than guessing from the
// email address. This component only decides which of the two the button
// points at.
//
// Either URL can be null when its environment variable is missing. That is
// treated as "this plan is not on sale right now" rather than an error: the
// other plan still sells, and if both are missing the caller falls back to
// the email route.

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

const MONTHLY_PRICE = 15;
const ANNUAL_PRICE = 150;
const ANNUAL_AT_MONTHLY_RATE = MONTHLY_PRICE * 12;
const MONTHS_FREE = Math.round((ANNUAL_AT_MONTHLY_RATE - ANNUAL_PRICE) / MONTHLY_PRICE);

export function PlanChoice({
  monthlyUrl,
  annualUrl,
  initialAnnual = false,
}: {
  monthlyUrl: string | null;
  annualUrl: string | null;
  initialAnnual?: boolean;
}) {
  // Never open on a plan that isn't purchasable.
  const [annual, setAnnual] = useState(initialAnnual && !!annualUrl);
  const href = annual ? annualUrl : monthlyUrl;
  const bothAvailable = !!monthlyUrl && !!annualUrl;

  return (
    <>
      {bothAvailable ? (
        <div
          role="tablist"
          aria-label="Billing period"
          className="mt-5 inline-flex rounded-full border border-line bg-paper-2 p-1"
        >
          <PeriodTab label="Monthly" selected={!annual} onSelect={() => setAnnual(false)} />
          <PeriodTab label="Annual" selected={annual} onSelect={() => setAnnual(true)} />
        </div>
      ) : null}

      <div className="mt-5 flex items-baseline gap-1">
        <span className="font-serif text-[44px] leading-none tracking-tightest text-ink">
          ${annual ? ANNUAL_PRICE : MONTHLY_PRICE}
        </span>
        <span className="font-mono text-[12px] text-graphite">
          · per {annual ? 'year' : 'month'}, cancel anytime
        </span>
      </div>

      {/* Height is held whether or not the saving line shows, so switching
          period doesn't make the card jump under the cursor. */}
      <div className="mt-2 flex h-6 items-center gap-2">
        {annual ? (
          <>
            <span className="font-mono text-[12px] text-graphite line-through">
              ${ANNUAL_AT_MONTHLY_RATE}
            </span>
            <span className="rounded-full bg-signal/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-signal-dark">
              {MONTHS_FREE} months free
            </span>
          </>
        ) : null}
      </div>

      <a
        href={href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        data-cta="upgrade.checkout"
        data-plan={annual ? 'annual' : 'monthly'}
        className="group mt-8 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
      >
        Upgrade to Pro
        <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
      </a>

      <p className="mt-4 text-[12px] leading-relaxed text-graphite">
        Payment opens in a new tab. You&rsquo;ll be returned here once it&rsquo;s complete and your
        account will upgrade automatically.
        {annual
          ? ' Annual renews once a year, and you can cancel from settings whenever you like.'
          : ''}
      </p>
    </>
  );
}

function PeriodTab({
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
      className={
        selected
          ? 'rounded-full bg-signal px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-paper transition'
          : 'rounded-full px-5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-graphite transition hover:text-ink'
      }
    >
      {label}
    </button>
  );
}
