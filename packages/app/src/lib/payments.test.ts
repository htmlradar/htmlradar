import { describe, it, expect } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { computeTierUpdate } from './payments';

const FIXED_NOW = new Date('2026-05-27T12:00:00Z');
const FUTURE = '2026-06-27T12:00:00Z';
const PAST = '2026-05-01T12:00:00Z';

describe('computeTierUpdate', () => {
  it('active status with future period_end → pro', () => {
    const update = computeTierUpdate(
      {
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: FUTURE,
        ended_at: null,
      },
      null,
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
    if (update.tier === 'pro') {
      expect(update.pro_since).toBe('2026-05-01T00:00:00Z');
      expect(update.pro_until).toBe(FUTURE);
    }
  });

  it('canceled status with future period_end → pro (keeps access until period end)', () => {
    const update = computeTierUpdate(
      {
        status: 'canceled',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: FUTURE,
        ended_at: null,
      },
      { pro_since: '2026-05-01T00:00:00Z', pro_until: FUTURE },
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
  });

  it('canceled status with PAST period_end → free (the late-delivery bug case)', () => {
    const update = computeTierUpdate(
      {
        status: 'canceled',
        started_at: '2026-04-01T00:00:00Z',
        current_period_end: PAST,
        ended_at: null,
      },
      { pro_since: '2026-04-01T00:00:00Z', pro_until: PAST },
      FIXED_NOW,
    );
    expect(update.tier).toBe('free');
  });

  it('revoked status → free with pro_until set to ended_at', () => {
    const update = computeTierUpdate(
      {
        status: 'revoked',
        started_at: '2026-04-01T00:00:00Z',
        current_period_end: PAST,
        ended_at: '2026-05-15T00:00:00Z',
      },
      null,
      FIXED_NOW,
    );
    expect(update.tier).toBe('free');
    if (update.tier === 'free') {
      expect(update.pro_until).toBe('2026-05-15T00:00:00Z');
    }
  });

  // The real subscription.revoked payload Polar sent for viewer9@example.test.
  // Status is 'canceled', not 'revoked', and the period end is still weeks away —
  // only ended_at marks the revoke. This profile sat on tier=pro for weeks.
  it('revoke delivered as canceled + past ended_at → free (the viewer9 case)', () => {
    const update = computeTierUpdate(
      {
        status: 'canceled',
        started_at: '2026-06-26T16:46:59Z',
        current_period_end: '2026-07-26T16:46:59Z',
        ended_at: '2026-07-17T20:00:05Z',
      },
      { pro_since: '2026-06-26T16:46:59Z', pro_until: '2026-07-26T16:46:59Z' },
      new Date('2026-07-17T20:00:16Z'),
    );
    expect(update.tier).toBe('free');
    if (update.tier === 'free') {
      expect(update.pro_until).toBe('2026-07-17T20:00:05Z'); // when access really ended
    }
  });

  // Guard on the other side of the ended_at rule: a paying customer who cancels
  // is paid through the period and Polar leaves ended_at null. Downgrading here
  // would cut off someone who has already paid.
  it('cancel-at-period-end with no ended_at → pro through the paid period', () => {
    const update = computeTierUpdate(
      {
        status: 'canceled',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: FUTURE,
        ended_at: null,
      },
      { pro_since: '2026-05-01T00:00:00Z', pro_until: FUTURE },
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
    if (update.tier === 'pro') {
      expect(update.pro_until).toBe(FUTURE);
    }
  });

  // Polar sets ended_at only once an end has actually happened (a scheduled end
  // is ends_at, a different field we don't read). A future ended_at therefore
  // shouldn't occur in practice — this pins the behaviour if provider clock skew
  // or a schema change ever produces one: don't revoke on it.
  it('ended_at in the FUTURE (provider clock skew) → still pro, no early revoke', () => {
    const update = computeTierUpdate(
      {
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: FUTURE,
        ended_at: FUTURE,
      },
      null,
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
    if (update.tier === 'pro') {
      expect(update.pro_until).toBe(FUTURE);
    }
  });

  it('past_due status with active period → pro (dunning grace)', () => {
    const update = computeTierUpdate(
      {
        status: 'past_due',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: FUTURE,
        ended_at: null,
      },
      null,
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
  });

  it('coalesces pro_since on resubscribe — original date preserved', () => {
    const update = computeTierUpdate(
      {
        status: 'active',
        started_at: '2027-01-01T00:00:00Z', // new sub today
        current_period_end: '2027-02-01T00:00:00Z',
        ended_at: null,
      },
      { pro_since: '2025-03-15T00:00:00Z', pro_until: '2025-04-15T00:00:00Z' }, // old sub
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
    if (update.tier === 'pro') {
      expect(update.pro_since).toBe('2025-03-15T00:00:00Z'); // unchanged
    }
  });

  it('pro_until is non-shrinking on out-of-order delivery', () => {
    const update = computeTierUpdate(
      {
        status: 'active',
        started_at: '2026-05-01T00:00:00Z',
        current_period_end: '2026-06-01T00:00:00Z', // EARLIER than existing
        ended_at: null,
      },
      { pro_since: '2026-05-01T00:00:00Z', pro_until: '2026-07-01T00:00:00Z' }, // LATER, already stored
      FIXED_NOW,
    );
    expect(update.tier).toBe('pro');
    if (update.tier === 'pro') {
      expect(update.pro_until).toBe('2026-07-01T00:00:00Z'); // didn't shrink
    }
  });

  it('incomplete status → free', () => {
    const update = computeTierUpdate(
      {
        status: 'incomplete',
        started_at: null,
        current_period_end: FUTURE,
        ended_at: null,
      },
      null,
      FIXED_NOW,
    );
    expect(update.tier).toBe('free');
  });
});

// Sanity check that the standardwebhooks library handles signed payloads
// the way our route does. Mirrors the @polar-sh/sdk pattern: raw secret
// → base64 → Webhook ctor → verify({id, timestamp, body}).
describe('webhook signature round-trip (standardwebhooks)', () => {
  const RAW_SECRET = 'whsec_abc123xyz789defghijklmnop';
  const base64Secret = btoa(RAW_SECRET);

  function sign(id: string, timestamp: string, body: string): string {
    // Mirror the algorithm standardwebhooks uses so we can produce
    // signatures it will accept.
    return crypto.subtle
      .importKey(
        'raw',
        Uint8Array.from(atob(base64Secret), (c) => c.charCodeAt(0)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      .then((key) =>
        crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
      )
      .then((buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))) as unknown as string;
  }

  it('accepts a properly signed payload', async () => {
    const wh = new Webhook(base64Secret);
    const id = 'msg_test_1';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: 'subscription.created', data: {} });
    const sig = await sign(id, timestamp, body);
    expect(() =>
      wh.verify(body, {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${sig}`,
      }),
    ).not.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const wh = new Webhook(base64Secret);
    const id = 'msg_test_2';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: 'subscription.created', data: {} });
    const sig = await sign(id, timestamp, body);
    expect(() =>
      wh.verify(body + '{}', {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${sig}`,
      }),
    ).toThrow();
  });

  it('rejects a stale timestamp (>5 min old)', async () => {
    const wh = new Webhook(base64Secret);
    const id = 'msg_test_3';
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = JSON.stringify({ type: 'subscription.created', data: {} });
    const sig = await sign(id, oldTimestamp, body);
    expect(() =>
      wh.verify(body, {
        'webhook-id': id,
        'webhook-timestamp': oldTimestamp,
        'webhook-signature': `v1,${sig}`,
      }),
    ).toThrow();
  });
});
