// The last segment of a tracked link's public address — the "acme-proposal"
// in htmlradar.com/r/acme-proposal. Pro customers may choose it; everyone
// else gets a generated one.
//
// THIS FILE IS NOT THE CONTROL. The RLS policy on document_shares lets any
// signed-in customer write their own share rows straight through PostgREST,
// so the real validation and the real Pro entitlement check live in the
// validate_share_slug trigger (schema/033_custom_share_slug.sql). Everything
// here exists so the customer finds out in the form instead of after a round
// trip, and so the messages they read are the same either way. Keep the
// pattern and the reserved list in step with 033 — if they drift, the
// database wins and the customer gets a worse error, not a security hole.

// Mirrors the regex in validate_share_slug: 3–60 characters, lowercase
// letters, digits and hyphens, starting and ending alphanumeric.
export const SHARE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/;

export const RESERVED_SHARE_SLUGS = [
  'login',
  'signin',
  'sign-in',
  'support',
  'verify',
  'account',
  'accounts',
  'billing',
  'payment',
  'payments',
  'invoice',
  'secure',
  'admin',
  'api',
  'htmlradar',
  'www',
  'mail',
  'auth',
  'email',
  'm',
  '_doc',
];

export const SLUG_FORMAT_MESSAGE =
  'Use 3 to 60 characters: lowercase letters, numbers and hyphens, starting and ending with a letter or number.';
export const SLUG_RESERVED_MESSAGE = 'That ending is reserved. Please choose another.';
export const SLUG_UNAVAILABLE_MESSAGE = 'That link ending is not available. Please choose another.';
export const SLUG_REQUIRES_PRO_MESSAGE =
  'Choosing your own link ending is a Pro feature. Upgrade to Pro, or leave the ending blank and we will generate one.';

/**
 * What the customer typed, turned into what we would store.
 *
 * People paste the whole URL. When the input looks like a path we keep the
 * last segment and say so — `shortened` drives a visible note, because
 * quietly throwing away most of what someone pasted is how you end up with a
 * link nobody expected. Anything else is only lowercased: stripping illegal
 * characters as they type would rewrite their input under the cursor, so
 * those are left alone for validation to complain about.
 */
export function normalizeSlugInput(raw: string): { value: string; shortened: boolean } {
  const withoutQuery = raw.split(/[?#]/)[0] ?? '';
  if (!withoutQuery.includes('/')) {
    return { value: raw.toLowerCase(), shortened: false };
  }
  const segments = withoutQuery.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return { value: last.toLowerCase(), shortened: true };
}

/** null when the address is usable, otherwise the message to show. */
export function validateShareSlug(slug: string): string | null {
  if (!SHARE_SLUG_PATTERN.test(slug)) return SLUG_FORMAT_MESSAGE;
  if (RESERVED_SHARE_SLUGS.includes(slug)) return SLUG_RESERVED_MESSAGE;
  return null;
}

/**
 * Turn a Postgres error from create_share into something a customer can act
 * on. Matches on the exception name raised by 033; anything else is not ours
 * and is handed back unchanged.
 */
export function describeSlugError(dbMessage: string): string | null {
  if (dbMessage.includes('slug_invalid_format')) return SLUG_FORMAT_MESSAGE;
  if (dbMessage.includes('slug_reserved')) return SLUG_RESERVED_MESSAGE;
  if (dbMessage.includes('slug_unavailable')) return SLUG_UNAVAILABLE_MESSAGE;
  if (dbMessage.includes('slug_requires_pro')) return SLUG_REQUIRES_PRO_MESSAGE;
  // The unique index on document_shares.slug, if two people submit the same
  // address between the trigger's check and the insert.
  if (dbMessage.includes('document_shares_slug_key')) return SLUG_UNAVAILABLE_MESSAGE;
  return null;
}
