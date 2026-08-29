import { describe, expect, it } from 'vitest';
import { computeTierUpdate } from './payments';

// Recorded from a REAL monthly -> annual switch.
//
// Not a hand-written fixture. This is the subscription object Polar actually
// returned after PATCHing product_id to the annual plan with
// proration_behavior: 'invoice', executed against the Polar sandbox on
// 29 August 2026. Polar charged $135 at that moment: the $150 annual price
// less a $15 credit for the unused remainder of the month.
//
// The point of this file is to prove OUR code does the right thing with what
// Polar actually sends, rather than with what we assume it sends. The failure
// this guards against is specific and expensive: if pro_until were left at the
// old monthly period end, the customer would pay for a year and then be
// silently downgraded to free three days later by the monitor's expiry sweep.
const REAL_POLAR_PAYLOAD_AFTER_SWITCH = {
  status: 'active',
  started_at: '2026-08-29T15:00:41.579203Z',
  ended_at: null,
  current_period_start: '2026-08-29T15:01:06.609995Z',
  current_period_end: '2027-08-29T15:01:06.609995Z',
  recurring_interval: 'year',
  amount: 15000,
  product_id: '37fb5e71-8e87-4cb0-a82f-72bd09cfb4ad',
} as const;

describe('tier logic against a real Polar annual-switch payload', () => {
  const existing = {
    pro_since: '2026-08-29T15:00:41.579203Z',
    // What the profile held before the switch: the monthly period end.
    pro_until: '2026-09-29T15:00:41.579203Z',
  };

  it('keeps the customer on Pro', () => {
    const update = computeTierUpdate(REAL_POLAR_PAYLOAD_AFTER_SWITCH as never, existing);
    expect(update.tier).toBe('pro');
  });

  it('moves pro_until to the new annual period end', () => {
    const update = computeTierUpdate(REAL_POLAR_PAYLOAD_AFTER_SWITCH as never, existing);
    expect(update.pro_until).toBe('2027-08-29T15:01:06.609995Z');
  });

  it('extends the expiry by roughly a year rather than shrinking it', () => {
    const update = computeTierUpdate(REAL_POLAR_PAYLOAD_AFTER_SWITCH as never, existing);
    const before = new Date(existing.pro_until).getTime();
    const after = new Date(update.pro_until as string).getTime();
    expect(after).toBeGreaterThan(before);
    expect(Math.round((after - before) / 86_400_000)).toBeGreaterThan(300);
  });

  it('leaves the account safely outside the monitor expiry sweep', () => {
    // packages/monitor demotes tier=pro rows whose pro_until passed more than
    // three days ago. A switched customer must sit comfortably the right side
    // of that cutoff.
    const update = computeTierUpdate(REAL_POLAR_PAYLOAD_AFTER_SWITCH as never, existing);
    const graceCutoff = Date.now() - 3 * 24 * 60 * 60_000;
    expect(new Date(update.pro_until as string).getTime()).toBeGreaterThan(graceCutoff);
  });
});
