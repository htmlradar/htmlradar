// Decision logic for the in-product monthly → annual switch, kept out of the
// settings component so it can be unit-tested without React, Polar or
// Supabase. Real money moves on the back of these two functions:
// shouldOfferAnnualSwitch decides whether the offer is even shown, and
// switchToAnnual decides whether a PATCH (and therefore a charge) happens.

export interface ActiveSubscription {
  id: string;
  canceling: boolean;
  recurringInterval: string;
  productId: string;
  amount: number;
}

// The offer is shown only for a Pro account whose live subscription is monthly
// and not already on its way out, and only when the annual product is
// configured. Anything unknown → hidden; never offer a charge we can't honour.
export function shouldOfferAnnualSwitch({
  tier,
  sub,
  annualProductId,
}: {
  tier: string;
  sub: ActiveSubscription | null;
  annualProductId: string | undefined;
}): boolean {
  return (
    tier === 'pro' &&
    !!annualProductId &&
    !!sub &&
    sub.recurringInterval === 'month' &&
    !sub.canceling
  );
}

export type SwitchResult =
  | { ok: true; patched: boolean }
  | {
      ok: false;
      reason: 'not_configured' | 'no_subscription' | 'not_monthly' | 'canceling';
      detail: string;
    };

// `sub` must be a fresh read from Polar, not page state — the caller re-reads
// before calling this. `patch` throws on a Polar error; the caller owns the
// try/catch so the failure is logged with its user context.
export async function switchToAnnual({
  sub,
  annualProductId,
  patch,
}: {
  sub: ActiveSubscription | null;
  annualProductId: string;
  patch: (subscriptionId: string, body: Record<string, unknown>) => Promise<void>;
}): Promise<SwitchResult> {
  // An unset env var arrives here as '' — and Polar can omit product_id, which
  // also reads as ''. Refusing up front stops '' === '' from passing as
  // "already annual" and stops a PATCH with an empty product_id.
  if (!annualProductId) {
    return { ok: false, reason: 'not_configured', detail: 'POLAR_PRODUCT_ID_ANNUAL is empty' };
  }
  if (!sub) {
    return { ok: false, reason: 'no_subscription', detail: 'no active subscription on Polar' };
  }
  // Idempotency. Already on the annual product → success without a PATCH, so a
  // double submit (or a stale tab) can never bill the difference twice.
  if (sub.productId === annualProductId) {
    return { ok: true, patched: false };
  }
  if (sub.recurringInterval !== 'month') {
    return {
      ok: false,
      reason: 'not_monthly',
      detail: `recurring_interval is ${sub.recurringInterval}, not month`,
    };
  }
  // Mirrors the visibility rule: someone who has already asked to leave must
  // not be charged a year up front from a page they loaded before cancelling.
  if (sub.canceling) {
    return {
      ok: false,
      reason: 'canceling',
      detail: 'subscription is set to cancel at period end',
    };
  }
  await patch(sub.id, { product_id: annualProductId, proration_behavior: 'invoice' });
  return { ok: true, patched: true };
}
