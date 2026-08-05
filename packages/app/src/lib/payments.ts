// Pure tier-update logic extracted from the webhook handler so it can be
// unit-tested without mocking Supabase or Polar. The handler's
// applySubscription() calls this and then writes the result to profiles.
//
// Rules encoded here:
//  - 'active' | 'trialing' | 'past_due' | 'canceled' grant Pro ONLY IF the
//    current period is still in the future (a delayed delivery for a
//    canceled-but-past sub must NOT write tier=pro with pro_until in the past).
//  - A subscription whose ended_at has already passed is terminated and grants
//    nothing, whatever its status says. Polar delivers subscription.revoked with
//    data.status = 'canceled' (not 'revoked') and ended_at = the moment access
//    was cut. Without this check the revoke read as an ordinary
//    cancel-at-period-end and left the profile on Pro until current_period_end —
//    weeks of free Pro after a real revoke. A future ended_at is a *scheduled*
//    termination and must still grant Pro until it arrives.
//  - 'revoked' | 'incomplete' | 'incomplete_expired' | 'unpaid' drop to free.
//  - pro_since is coalesced to existing.pro_since when present so resubscribes
//    don't overwrite the original Pro-start date.
//  - pro_until is non-shrinking — an out-of-order delivery for an earlier
//    period_end must NOT clobber a later one already stored.

export interface SubscriptionFields {
  status: string;
  started_at: string | null;
  current_period_end: string | null;
  ended_at: string | null;
}

export interface ProfileTimestamps {
  pro_since: string | null;
  pro_until: string | null;
}

export type TierUpdate =
  | { tier: 'pro'; pro_since: string | null; pro_until: string | null }
  | { tier: 'free'; pro_until: string | null };

const PRO_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled']);

export function computeTierUpdate(
  sub: SubscriptionFields,
  existing: ProfileTimestamps | null,
  now: Date = new Date(),
): TierUpdate {
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const periodStillActive = periodEnd ? periodEnd.getTime() > now.getTime() : false;
  const endedAt = sub.ended_at ? new Date(sub.ended_at) : null;
  const alreadyEnded = endedAt ? endedAt.getTime() <= now.getTime() : false;
  const grantsPro = PRO_STATUSES.has(sub.status) && periodStillActive && !alreadyEnded;

  if (!grantsPro) {
    return {
      tier: 'free',
      pro_until: sub.ended_at ?? sub.current_period_end ?? null,
    };
  }

  const incomingProUntilMs = sub.current_period_end
    ? new Date(sub.current_period_end).getTime()
    : 0;
  const existingProUntilMs = existing?.pro_until ? new Date(existing.pro_until).getTime() : 0;
  const effectiveProUntil =
    incomingProUntilMs >= existingProUntilMs ? sub.current_period_end : existing!.pro_until;

  return {
    tier: 'pro',
    pro_since: existing?.pro_since ?? sub.started_at,
    pro_until: effectiveProUntil,
  };
}
