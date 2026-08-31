// Handle allocation: the account's subdomain label, and the hostname a new
// link is stamped with.
//
// Design: docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md,
// sections "Handles" and "Which host serves what". Read those before changing
// anything here.
//
// WHAT A HANDLE IS. Every account gets a label so its links can be served from
// `{handle}.htmlradar.page` instead of the shared apex. Safe Browsing and
// SmartScreen flag a bad page at the address, then the host, then the whole
// registrable domain — per-customer hosts do not isolate customers from each
// other, but a warning scoped to ONE HOSTNAME damages one customer instead of
// all of them. It is a routing and reputation boundary, never an identity
// claim about the sender.
//
// THIS FILE IS NOT THE CONTROL. Same reason 033 and 043 spell out: row-level
// security scopes rows, not columns. Availability, format, the reserved list,
// immutability and the permanent claim are all enforced by the triggers in
// schema/043_trust_layer_foundation.sql. Everything here picks a name to
// offer and reacts to the database's answer.
//
// WITH THE GATE OFF — its shipped state — nothing in this file reaches the
// database at all. `stampShareHost` returns null before it queries anything,
// no handle is allocated, no share stores a hostname, and every link is the
// apex link it has always been.

// No direct `server-only` import: ./error-log already carries one, so a client
// component reaching for this module fails the build exactly the same way,
// and the tests that mock the error log get this module for free.
import type { SupabaseClient } from '@supabase/supabase-js';
import { logServerError } from './error-log';

/**
 * The trust layer's Gate 2, and the whole of its rollback.
 *
 * ONE SETTING REACHES BOTH HALVES. `TRUST_HANDLES` is a single line in
 * `packages/proxy/wrangler.toml`: wrangler hands it to the Worker, where it
 * gates the apex-to-handle redirect, and the deploy workflow's preflight reads
 * that same line into `NEXT_PUBLIC_TRUST_HANDLES` for the application build,
 * where it gates allocation and the links this app prints. They cannot
 * disagree, which is Sol's ninth finding: newly generated handle links and the
 * redirects that serve them must switch off together.
 *
 * Empty or unset is off. `*` is on for every account. The Worker's
 * `TRUST_WRAPPER` also accepts a middle state — a list of slugs — and this one
 * deliberately does not: allocation happens as a share is created, before
 * anybody could have listed its slug anywhere.
 *
 * ponytail: two states, not three. A staged rollout by account is one
 * `.includes()` away if it is ever wanted.
 */
export function handleLinksEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_TRUST_HANDLES ?? '').trim() === '*';
}

// The format rule from schema/043, character for character: 3 to 24
// characters, lowercase letters, digits and hyphens, starting and ending
// alphanumeric, and no two hyphens in a row. The no-double-hyphen clause is
// what bans an `xn--` prefix, and therefore every Punycode lookalike.
const MAX_LENGTH = 24;
const MIN_LENGTH = 3;

// A random suffix costs a hyphen and four characters, so a base that needs
// one is shortened to leave room. Shortening BEFORE suffixing is the design's
// rule: appending to a full-length base would push it past the limit and the
// database would refuse a name the customer never sees.
const SUFFIX_LENGTH = 4;
const BASE_ROOM = MAX_LENGTH - (SUFFIX_LENGTH + 1);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomLabel(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Trim to a length the format rule accepts, with no hyphen left on either end. */
function tidy(base: string, max: number): string {
  return base
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * The name we would like for an account: the part of the email before the
 * `@`, lowercased, with every run of non-alphanumeric characters folded to a
 * single hyphen and the result trimmed to the format's length.
 *
 * May return something too short to use — `a@example.com` yields `a`. That is
 * the caller's signal to go straight to a generated name rather than put a
 * one-character host on the internet.
 */
export function deriveHandle(email: string): string {
  const local = (email.split('@')[0] ?? '').toLowerCase();
  return tidy(local.replace(/[^a-z0-9]+/g, '-'), MAX_LENGTH);
}

/**
 * The names to offer the database, in order.
 *
 * The derived name first, then the same name shortened with a random suffix,
 * and finally a name with nothing of the account in it. The generated name is
 * plain random characters on purpose: a memorable fallback would be a name
 * somebody could later claim was theirs, and the reserved list exists exactly
 * because a meaningful hostname reads as more official than a random one.
 */
export function handleCandidates(email: string): string[] {
  const base = deriveHandle(email);
  const generated = [randomLabel(12)];
  if (base.length < MIN_LENGTH) return generated;

  const shortened = tidy(base, BASE_ROOM);
  const suffixed =
    shortened.length >= MIN_LENGTH
      ? [`${shortened}-${randomLabel(SUFFIX_LENGTH)}`, `${shortened}-${randomLabel(SUFFIX_LENGTH)}`]
      : [];
  return [base, ...suffixed, ...generated];
}

// The database's answer to "somebody already has that". P0041 is what the
// claim trigger raises; 23505 is the unique index on profiles.handle, which
// two allocations racing past the trigger could still reach. Both mean the
// same thing to us: try the next name.
function isUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'P0041' ||
    error.code === '23505' ||
    (error.message ?? '').includes('handle_unavailable')
  );
}

/**
 * The account's handle, allocating one on first use.
 *
 * `admin` must be a service-role client: schema/032 narrowed the profile
 * write grant to `(display_name, timezone)`, so a customer's own session
 * cannot write this column at all — which is the point.
 *
 * Returns null when the gate is off, when the account has no email to derive
 * from, or when every candidate was refused. Null always means "this link is
 * an apex link", which is a working link, so no caller treats it as a failure.
 */
export async function ensureHandle(admin: SupabaseClient, userId: string): Promise<string | null> {
  if (!handleLinksEnabled()) return null;

  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select('handle, email')
    .eq('id', userId)
    .maybeSingle();

  if (readError) {
    await logServerError({
      source: 'lib.handle',
      message: readError.message,
      userId,
      context: { step: 'read_profile' },
    });
    return null;
  }

  // Allocated once, immutable afterwards — links carrying it are already in
  // inboxes. The trigger refuses a change anyway; this returns before asking.
  const existing = (profile as { handle?: string | null } | null)?.handle ?? null;
  if (existing) return existing;

  const email = (profile as { email?: string | null } | null)?.email ?? '';
  if (!email) return null;

  for (const candidate of handleCandidates(email)) {
    // `.is('handle', null)` and the returned row together are what make two
    // first shares arriving at once produce ONE handle: the loser's update
    // matches no row, comes back empty rather than failing, and takes the
    // winner's name instead of claiming a second one.
    const { data: claimed, error } = await admin
      .from('profiles')
      .update({ handle: candidate })
      .eq('id', userId)
      .is('handle', null)
      .select('handle')
      .maybeSingle();
    if (!error) {
      const won = (claimed as { handle?: string | null } | null)?.handle ?? null;
      if (won) return won;
      const { data: settled } = await admin
        .from('profiles')
        .select('handle')
        .eq('id', userId)
        .maybeSingle();
      return (settled as { handle?: string | null } | null)?.handle ?? null;
    }
    if (isUnavailable(error)) continue;

    await logServerError({
      source: 'lib.handle',
      message: error.message,
      userId,
      context: { step: 'claim_handle', candidate },
    });
    return null;
  }

  await logServerError({
    source: 'lib.handle',
    message: 'every handle candidate was unavailable',
    userId,
    level: 'warn',
    context: { step: 'claim_handle' },
  });
  return null;
}

/**
 * Give a freshly created share the hostname it will be served from, and
 * return that hostname for the link the caller is about to print.
 *
 * Null means the apex, which is every share that exists today and every share
 * at all while the gate is off. Stamping is deliberately not fatal: a share
 * whose hostname could not be written is still a link that opens, on the apex,
 * forever — so a failure here loses the prettier address and nothing else.
 *
 * It is called after the share row exists, inside the caller's own try block,
 * so it must not throw. A rejected fetch here would otherwise turn a share
 * that WAS created into "Failed to create the share" and leave the customer
 * looking at a form for a link they already have.
 */
export async function stampShareHost(
  admin: SupabaseClient,
  userId: string,
  shareId: string,
): Promise<string | null> {
  if (!handleLinksEnabled()) return null;

  try {
    const handle = await ensureHandle(admin, userId);
    if (!handle) return null;

    // `owner_id` is on the filter as well as the id because this client is the
    // service role and carries no session to scope the write for it. The
    // trigger in schema/043 refuses a hostname that is not the owner's own
    // handle regardless — this is the belt.
    const { error } = await admin
      .from('document_shares')
      .update({ host_handle: handle })
      .eq('id', shareId)
      .eq('owner_id', userId);

    if (error) {
      await logServerError({
        source: 'lib.handle',
        message: error.message,
        userId,
        context: { step: 'stamp_share_host', share_id: shareId, handle },
      });
      return null;
    }
    return handle;
  } catch (e) {
    await logServerError({
      source: 'lib.handle',
      message: e instanceof Error ? e.message : 'stamping the share hostname threw',
      userId,
      context: { step: 'stamp_share_host', share_id: shareId },
    });
    return null;
  }
}
