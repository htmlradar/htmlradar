import type { Viewer } from '@/lib/types';

// Count distinct PEOPLE, not raw viewer rows — the single "Viewers" semantic
// across all analytics surfaces (per product decision D2). One person who
// opened from two devices or through two shares shares an email → counts once;
// anonymous viewers (no email gate) each count as their own person. This
// mirrors how ViewerInsights groups (lowercased/trimmed email) and how
// SharesTable dedupes, so the number agrees everywhere.
export function countDistinctViewers(viewers: Pick<Viewer, 'email'>[]): number {
  const emails = new Set<string>();
  let anonymous = 0;
  for (const v of viewers) {
    const email = v.email?.trim().toLowerCase();
    if (email) emails.add(email);
    else anonymous += 1;
  }
  return emails.size + anonymous;
}
