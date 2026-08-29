import { describe, it, expect, vi } from 'vitest';
import { shouldOfferAnnualSwitch, switchToAnnual, type ActiveSubscription } from './annual-switch';

const ANNUAL = 'cc5fa72b-170f-42a3-8a61-3a8fb21e5453';
const MONTHLY = 'dc97b804-b378-4a02-9153-5b35a8667986';

function sub(over: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    id: 'sub_123',
    canceling: false,
    recurringInterval: 'month',
    productId: MONTHLY,
    amount: 1500,
    ...over,
  };
}

describe('annual switch offer visibility', () => {
  it('monthly, active, not cancelling → shown', () => {
    expect(shouldOfferAnnualSwitch({ tier: 'pro', sub: sub(), annualProductId: ANNUAL })).toBe(
      true,
    );
  });

  it('already annual → hidden', () => {
    expect(
      shouldOfferAnnualSwitch({
        tier: 'pro',
        sub: sub({ recurringInterval: 'year', productId: ANNUAL }),
        annualProductId: ANNUAL,
      }),
    ).toBe(false);
  });

  it('free tier → hidden', () => {
    expect(shouldOfferAnnualSwitch({ tier: 'free', sub: sub(), annualProductId: ANNUAL })).toBe(
      false,
    );
  });

  it('cancelling at period end → hidden', () => {
    expect(
      shouldOfferAnnualSwitch({
        tier: 'pro',
        sub: sub({ canceling: true }),
        annualProductId: ANNUAL,
      }),
    ).toBe(false);
  });

  it('annual product env var missing → hidden', () => {
    expect(shouldOfferAnnualSwitch({ tier: 'pro', sub: sub(), annualProductId: undefined })).toBe(
      false,
    );
    expect(shouldOfferAnnualSwitch({ tier: 'pro', sub: sub(), annualProductId: '' })).toBe(false);
  });

  it('no subscription found on Polar → hidden', () => {
    expect(shouldOfferAnnualSwitch({ tier: 'pro', sub: null, annualProductId: ANNUAL })).toBe(
      false,
    );
  });
});

describe('switchToAnnual', () => {
  it('monthly → PATCHes with the annual product and invoice proration', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({ sub: sub(), annualProductId: ANNUAL, patch });
    expect(r).toEqual({ ok: true, patched: true });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('sub_123', {
      product_id: ANNUAL,
      proration_behavior: 'invoice',
    });
  });

  // The one that stops a double submit charging twice.
  it('already on the annual product → success, and PATCH is never called', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({
      sub: sub({ recurringInterval: 'year', productId: ANNUAL }),
      annualProductId: ANNUAL,
      patch,
    });
    expect(r).toEqual({ ok: true, patched: false });
    expect(patch).not.toHaveBeenCalled();
  });

  // Same guard, isolated: on the annual product but Polar still reporting the
  // old interval (a read that lands mid-update). Nothing else stops a PATCH
  // here, so this is the case that proves the idempotency check is load-bearing
  // rather than shadowed by the not-monthly check above.
  it('already on the annual product but still reported as monthly → no PATCH', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({
      sub: sub({ recurringInterval: 'month', productId: ANNUAL }),
      annualProductId: ANNUAL,
      patch,
    });
    expect(r).toEqual({ ok: true, patched: false });
    expect(patch).not.toHaveBeenCalled();
  });

  it('no subscription → refuses without calling PATCH', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({ sub: null, annualProductId: ANNUAL, patch });
    expect(r.ok).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it('an interval that is neither month nor the annual product → refuses', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({
      sub: sub({ recurringInterval: 'year', productId: 'some-other-annual-product' }),
      annualProductId: ANNUAL,
      patch,
    });
    expect(r).toMatchObject({ ok: false, reason: 'not_monthly' });
    expect(patch).not.toHaveBeenCalled();
  });

  it('subscription set to cancel → refuses without calling PATCH', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const r = await switchToAnnual({
      sub: sub({ canceling: true }),
      annualProductId: ANNUAL,
      patch,
    });
    expect(r).toMatchObject({ ok: false, reason: 'canceling' });
    expect(patch).not.toHaveBeenCalled();
  });
});
