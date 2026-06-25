// Free-tier quota helpers — single source of truth for the "X of 2 tracked
// links" state shown on /settings and the /upgrade headline, and used by the
// share-creation pre-check. The cap is enforced authoritatively server-side by
// the enforce_share_cap trigger (schema/027_free_tier_share_cap.sql); this
// module reads the current state for the UI + the pre-check.
//
// Lifetime semantics: every tracked link a free user has ever created counts
// (revoked/expired included). Free-tier users cannot rotate links by
// deleting/revoking and re-creating. Documents are no longer capped — the
// share (tracked link) is the value + conversion unit.

import type { SupabaseClient } from '@supabase/supabase-js';

export const FREE_TIER_CAP = 2; // free tier: 2 tracked links, lifetime

export type QuotaState = {
  tier: 'free' | 'pro';
  used: number;
  cap: number;
  remaining: number;
  atCap: boolean;
};

// Pure "is this owner blocked from creating another link?" decision. Extracted
// so it's deterministically unit-testable (readQuota and the createShare
// pre-check both go through it, so they can't disagree).
export function computeAtCap(
  tier: 'free' | 'pro',
  used: number,
  cap: number = FREE_TIER_CAP,
): boolean {
  return tier === 'free' && used >= cap;
}

export async function readQuota(supabase: SupabaseClient, userId: string): Promise<QuotaState> {
  const [profileRes, countRes] = await Promise.all([
    supabase.from('profiles').select('tier').eq('id', userId).single(),
    supabase
      .from('document_shares')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId),
  ]);

  const tier: 'free' | 'pro' = profileRes.data?.tier === 'pro' ? 'pro' : 'free';
  const used = countRes.count ?? 0;
  const cap = FREE_TIER_CAP;
  return {
    tier,
    used,
    cap,
    remaining: Math.max(0, cap - used),
    atCap: computeAtCap(tier, used, cap),
  };
}
