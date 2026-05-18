// Free-tier quota helpers — single source of truth for the "X of 10
// lifetime documents" counter that appears on /new, /settings, and the
// /upgrade contextual headline. The cap is enforced server-side by the
// trigger in schema/003_triggers.sql; this module just reads the
// current state for UI surfacing.
//
// Lifetime semantics: deleted documents count. Free-tier users cannot
// rotate slots by deleting and re-uploading.

import type { SupabaseClient } from '@supabase/supabase-js';

export const FREE_TIER_CAP = 10;

export type QuotaState = {
  tier: 'free' | 'pro';
  used: number;
  cap: number;
  remaining: number;
  atCap: boolean;
};

export async function readQuota(supabase: SupabaseClient, userId: string): Promise<QuotaState> {
  const [profileRes, countRes] = await Promise.all([
    supabase.from('profiles').select('tier').eq('id', userId).single(),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
  ]);

  const tier: 'free' | 'pro' = profileRes.data?.tier === 'pro' ? 'pro' : 'free';
  const used = countRes.count ?? 0;
  const cap = FREE_TIER_CAP;
  return {
    tier,
    used,
    cap,
    remaining: Math.max(0, cap - used),
    atCap: tier === 'free' && used >= cap,
  };
}
