'use server';

// The three buttons in Settings → Your domain: Save, Check again, Disconnect.
//
// Thin on purpose. The rules, the Cloudflare calls and the conditional writes
// all live in `lib/custom-domains.ts`, which is where they are tested; these
// three add the caller's identity and nothing else.
//
// Every write goes through the service role because schema/052 grants the
// customer's own session no write on `custom_domains` at all — the same shape
// as the handle column in schema/043, and for the same reason: row-level
// security scopes rows, not columns, so a column a customer must not set is a
// column a customer must not be able to write.

import { requireUser } from '@/lib/supabase-server';
import { serviceClient } from '@/lib/api-auth';
import {
  checkDomain,
  connectDomain,
  customDomainsEnabled,
  disconnectDomain,
  readDomain,
  type DomainOutcome,
} from '@/lib/custom-domains';

const OFF: DomainOutcome = { error: 'Custom domains are not available yet.' };
const NONE: DomainOutcome = { error: 'You have no domain connected.' };

export async function connectDomainAction(hostname: string): Promise<DomainOutcome> {
  if (!customDomainsEnabled()) return OFF;
  const user = await requireUser();
  return connectDomain(serviceClient(), user.id, hostname);
}

export async function checkDomainAction(): Promise<DomainOutcome> {
  if (!customDomainsEnabled()) return OFF;
  const user = await requireUser();
  const admin = serviceClient();
  const domain = await readDomain(admin, user.id);
  if (!domain) return NONE;
  return checkDomain(admin, user.id, domain);
}

/**
 * Give the domain up.
 *
 * Deliberately not gated on the tier. An account whose Pro has lapsed must
 * still be able to take its own hostname back, and a customer who cannot
 * disconnect is a customer whose DNS is stuck pointing at us.
 */
export async function disconnectDomainAction(): Promise<DomainOutcome> {
  if (!customDomainsEnabled()) return OFF;
  const user = await requireUser();
  const admin = serviceClient();
  const domain = await readDomain(admin, user.id);
  if (!domain) return NONE;
  return disconnectDomain(admin, user.id, domain.id);
}
