// A customer's own subdomain for their tracked links.
//
// Design: docs/workstreams/content-domain/CUSTOM-DOMAINS-PRD-2026-09-16.md and
// the sprint file beside it. The customer does three things: type
// `decks.acme.com`, add ONE CNAME record, watch it go Live. Everything in this
// file is the plumbing behind those three things.
//
// WHO ENFORCES WHAT. The triggers in schema/052 are the control: hostname
// syntax, one live domain per owner, Pro-or-comped eligibility, the share's
// domain belonging to its owner, and immutability after insert. Row-level
// security scopes rows, not columns, so nothing here is a security boundary —
// the validation below exists to give the customer a sentence they can act on
// instead of a Postgres exception, and the conditional writes exist so a slow
// check cannot resurrect a row somebody has already disconnected.
//
// WITH THE FLAG OFF — its shipped state — none of this runs. The Settings
// section is hidden, share creation never asks for a domain, and the link
// addresses the app prints are byte for byte the addresses it printed before.
//
// No direct `server-only` import: ./error-log already carries one, so a client
// component reaching for this module fails the build the same way, and the
// tests that mock the error log get this module for free.
import type { SupabaseClient } from '@supabase/supabase-js';
import { logServerError } from './error-log';
import { SHARE_HOST } from './share-url';

/**
 * The whole of the feature's rollback.
 *
 * Off — empty, unset, anything but the two words below — hides the Settings
 * section, stops share creation from choosing a domain, and makes the API
 * refuse `domain_id`. Links already issued on a customer domain keep serving:
 * the worker answers those, and it has its own switch.
 *
 * Read inside the function rather than at module load: next-on-pages resolves
 * env at request time on the edge runtime and not always at module load.
 */
export function customDomainsEnabled(): boolean {
  const raw = (process.env['CUSTOM_DOMAINS_ENABLED'] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/** The one record the customer adds, and the only one. */
export const CNAME_TARGET = `customers.${SHARE_HOST}`;

export type DomainState = 'pending' | 'live' | 'disconnected' | 'retired';

export interface CustomDomainRow {
  id: string;
  hostname: string;
  state: DomainState;
  cloudflare_id: string | null;
  cloudflare_status: string | null;
  ssl_status: string | null;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  consecutive_failures: number | null;
  // Another account has held this hostname before. Computed by the trigger in
  // schema/052 and never written from here; a row carrying it can never reach
  // 'live', which is the whole mitigation for having no ownership proof beyond
  // the CNAME. Taking a name back costs a support conversation on purpose.
  previous_owner_review: boolean | null;
}

export const DOMAIN_COLUMNS =
  'id, hostname, state, cloudflare_id, cloudflare_status, ssl_status, verified_at, last_checked_at, last_error, consecutive_failures, previous_owner_review';

// ---------------------------------------------------------------------------
// What a customer may connect
// ---------------------------------------------------------------------------

// A bare domain cannot be connected: Cloudflare's custom hostnames need a
// CNAME, and a CNAME at the apex breaks the customer's own mail and website.
// "At least one label below the registrable domain" needs to know that
// `acme.co.uk` is itself registrable, hence this short list. It is not the
// public suffix list and does not pretend to be — a name under a suffix we do
// not know is refused by the trigger in 052, which carries the same list.
const MULTI_PART_SUFFIXES = [
  'co.uk',
  'org.uk',
  'ac.uk',
  'co.in',
  'com.au',
  'co.nz',
  'com.sg',
  'co.jp',
  'com.br',
  'com.mx',
  'co.za',
];

// Our own names. A link on one of these would read as ours however it was
// obtained, so no customer gets a certificate for one.
const OUR_DOMAINS = ['htmlradar.page', 'htmlradar.com', 'gethtmlradar.com', SHARE_HOST];

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * What the customer typed, as a hostname.
 *
 * People paste `https://decks.acme.com/` out of a browser bar and type a
 * trailing dot; none of that is a mistake worth a refusal message.
 */
export function normalizeHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.+$/, '');
}

/**
 * The reason we will not connect this name, as a sentence for the customer,
 * or null if we will.
 *
 * Every rule here is also a trigger in schema/052. This is the copy, not the
 * control.
 */
export function describeHostnameProblem(raw: string): string | null {
  const hostname = normalizeHostname(raw);
  if (!hostname) return 'Type the subdomain you want to use, such as decks.acme.com.';
  if (hostname.length > 253) return 'That name is too long for a hostname.';

  const labels = hostname.split('.');
  if (labels.some((label) => !LABEL.test(label))) {
    return 'A domain is made of letters, digits and hyphens separated by dots — decks.acme.com.';
  }
  if (labels.some((label) => label.startsWith('xn--'))) {
    return 'Punycode names (xn--…) are not supported. Use a plain ASCII subdomain.';
  }
  if (labels.some((label) => label.includes('htmlradar'))) {
    return 'A name containing “htmlradar” can be mistaken for one of ours, so we cannot issue a certificate for it.';
  }
  if (OUR_DOMAINS.some((ours) => hostname === ours || hostname.endsWith(`.${ours}`))) {
    return 'That is one of our own domains. Use a subdomain of a domain you own, such as decks.acme.com.';
  }

  const suffix = MULTI_PART_SUFFIXES.find((s) => hostname.endsWith(`.${s}`));
  const minimum = suffix ? suffix.split('.').length + 2 : 3;
  if (labels.length < minimum) {
    return `Use a subdomain rather than the bare domain — decks.${hostname} rather than ${hostname}.`;
  }
  return null;
}

/** The DNS record the customer adds, in the two shapes providers ask for. */
export function dnsRecord(hostname: string): {
  shortName: string;
  fullName: string;
  target: string;
} {
  const labels = hostname.split('.');
  const suffix = MULTI_PART_SUFFIXES.find((s) => hostname.endsWith(`.${s}`));
  const keep = labels.length - (suffix ? suffix.split('.').length + 1 : 2);
  return {
    shortName: labels.slice(0, Math.max(1, keep)).join('.'),
    fullName: hostname,
    target: CNAME_TARGET,
  };
}

// ---------------------------------------------------------------------------
// Cloudflare: four calls, and the exact bodies Astra verified
// ---------------------------------------------------------------------------

const CF_BASE = 'https://api.cloudflare.com/client/v4';

// Repeated on PATCH as well as POST: re-sending the SSL configuration is how
// Cloudflare is asked to run validation again.
const SSL_CONFIG = { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } as const;

export interface HostnameState {
  id: string;
  status: string;
  sslStatus: string;
}

interface CloudflareEnvelope {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { id?: string; status?: string; ssl?: { status?: string } } | null;
}

async function cloudflare(
  path: string,
  init: { method: string; body?: unknown },
): Promise<CloudflareEnvelope> {
  const token = process.env['CLOUDFLARE_API_TOKEN'] ?? '';
  const zone = process.env['CLOUDFLARE_ZONE_ID_PAGE'] ?? '';
  if (!token || !zone) throw new Error('Cloudflare credentials are not configured.');

  const response = await fetch(`${CF_BASE}/zones/${zone}/custom_hostnames${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const envelope = (await response.json().catch(() => ({}))) as CloudflareEnvelope;
  if (!response.ok || envelope.success === false) {
    const detail = (envelope.errors ?? []).map((e) => e.message).join('; ');
    throw new Error(
      `Cloudflare ${init.method} custom_hostnames${path} → HTTP ${response.status}${
        detail ? `: ${detail}` : ''
      }`,
    );
  }
  return envelope;
}

function stateOf(envelope: CloudflareEnvelope): HostnameState {
  return {
    id: envelope.result?.id ?? '',
    status: envelope.result?.status ?? 'unknown',
    sslStatus: envelope.result?.ssl?.status ?? 'unknown',
  };
}

export async function createHostname(hostname: string): Promise<HostnameState> {
  return stateOf(await cloudflare('', { method: 'POST', body: { hostname, ssl: SSL_CONFIG } }));
}

export async function getHostname(id: string): Promise<HostnameState> {
  return stateOf(await cloudflare(`/${id}`, { method: 'GET' }));
}

export async function restartValidation(id: string): Promise<HostnameState> {
  return stateOf(await cloudflare(`/${id}`, { method: 'PATCH', body: { ssl: SSL_CONFIG } }));
}

export async function deleteHostname(id: string): Promise<void> {
  await cloudflare(`/${id}`, { method: 'DELETE' });
}

/** One retry, for the two calls whose failure strands a customer. */
async function twice<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    return await work();
  }
}

// ---------------------------------------------------------------------------
// Our own proof that the name points at us
// ---------------------------------------------------------------------------

const PROBE_PATH = '/.well-known/htmlradar-domain-check';
const PROBE_TIMEOUT_MS = 5000;

/**
 * Does this hostname reach OUR worker, serving THIS domain's claim?
 *
 * Cloudflare saying "active" means a certificate exists; it does not mean the
 * customer pointed the name at us rather than somewhere else, and it is not
 * our own account-ownership proof. So the last word is one HTTPS request for a
 * content-free path that only the worker answers, and only for the domain row
 * that owns the hostname: body and header must both name this domain's id.
 *
 * Redirects are not followed and a five-second budget is enforced, so a
 * customer's own redirect chain or a hanging origin cannot hold a request or
 * launder some other site's response into a pass.
 */
export async function probe(hostname: string, domainId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${hostname}${PROBE_PATH}`, {
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status !== 200) return false;
    if (response.headers.get('x-htmlradar-domain') !== domainId) return false;
    const body = await response.text();
    return body.trim() === `htmlradar-domain:${domainId}`;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The account's current domain — the one non-retired row, or null. */
export async function readDomain(
  client: SupabaseClient,
  userId: string,
): Promise<CustomDomainRow | null> {
  const { data } = await client
    .from('custom_domains')
    .select(DOMAIN_COLUMNS)
    .eq('owner_id', userId)
    .is('retired_at', null)
    .maybeSingle();
  return (data as CustomDomainRow | null) ?? null;
}

/**
 * The domain a new link WILL go on, for the form to print before it does.
 *
 * This is a read for the interface, not the decision: the decision is made
 * inside `create_share` (see `shareHostArgs`). It answers the same question
 * the same way — the profile's default, confirmed live and the owner's own —
 * so the address beside the "name your link" field is the address the link
 * gets. Reading through the profile rather than straight off the domain row
 * matters: that column is what the database's tier trigger clears on a
 * downgrade, so a lapsed account correctly sees the HTMLRadar address here.
 */
export async function defaultDomainForNewShare(
  admin: SupabaseClient,
  userId: string,
): Promise<{ id: string; hostname: string } | null> {
  if (!customDomainsEnabled()) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('default_custom_domain_id')
    .eq('id', userId)
    .maybeSingle();
  const defaultId = (profile as { default_custom_domain_id?: string | null } | null)
    ?.default_custom_domain_id;
  if (!defaultId) return null;

  const { data } = await admin
    .from('custom_domains')
    .select('id, hostname')
    .eq('id', defaultId)
    .eq('owner_id', userId)
    .eq('state', 'live')
    .maybeSingle();
  return (data as { id: string; hostname: string } | null) ?? null;
}

/**
 * Which host a new link is born on, as the two arguments `create_share` and
 * `create_share_as` take (schema/052).
 *
 * Passing NOTHING is the ordinary case and is deliberate: the database reads
 * the owner's `default_custom_domain_id` inside the insert that creates the
 * row, so the hostname and the row are written in one statement. Choosing it
 * out here and stamping it afterwards is what would leave a link meant for a
 * customer's domain briefly reachable on htmlradar.page.
 *
 * Two arguments and not one because PostgreSQL cannot tell an omitted argument
 * from an explicit null, and "I did not choose" and "I chose the HTMLRadar
 * address" are different answers.
 *
 * With the feature off the HTMLRadar address is named explicitly rather than
 * left to the default, which is the whole of the rollback: an account whose
 * domain went live before the switch was turned off keeps serving those links
 * and stops collecting new ones.
 */
export type HostChoice =
  | { kind: 'default' }
  | { kind: 'htmlradar' }
  | { kind: 'domain'; id: string };

export function shareHostArgs(choice: HostChoice): Record<string, unknown> {
  if (!customDomainsEnabled()) return { p_use_htmlradar_address: true };
  if (choice.kind === 'htmlradar') return { p_use_htmlradar_address: true };
  if (choice.kind === 'domain') return { p_custom_domain_id: choice.id };
  return {};
}

/**
 * The hostname of a domain a share was just created on.
 *
 * Read back rather than assumed: the database picks the domain inside
 * `create_share`, and it falls back to the HTMLRadar address when the account's
 * default has stopped serving. The row it returns is therefore the only honest
 * source for the address to print.
 */
export async function hostnameOfDomain(
  admin: SupabaseClient,
  domainId: string | null | undefined,
): Promise<string | null> {
  if (!domainId) return null;
  const { data } = await admin
    .from('custom_domains')
    .select('hostname')
    .eq('id', domainId)
    .maybeSingle();
  return (data as { hostname?: string | null } | null)?.hostname ?? null;
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export type DomainOutcome = { ok: true; state: DomainState; message: string } | { error: string };

// What the customer is told while Cloudflare has not finished. Two states and
// what to do in each, because those are the two places a customer gets stuck.
const WAITING_FOR_DNS =
  'Waiting for the CNAME record. Add it at your DNS provider — it can take a few minutes to spread.';
const WAITING_FOR_CERTIFICATE =
  'The record is there and the certificate is being issued. This usually takes a few minutes.';

// The exceptions schema/052 raises on the custom_domains insert, each as a
// sentence the customer can act on. Matched on the exception name rather than
// the SQLSTATE because that is how the rest of this app reads Postgres errors
// (mapCreateShareError, describeSlugError), and the names are what the
// migration's own header lists.
const ENROLMENT_ERRORS: [string, string][] = [
  [
    'custom_domain_unavailable',
    'That domain is already connected to an HTMLRadar account. Email hello@htmlradar.com if it is yours.',
  ],
  [
    'custom_domain_needs_review',
    'That domain was connected to another account before. Email hello@htmlradar.com and we will check it over — it takes one reply.',
  ],
  [
    'custom_domain_limit',
    'You already have a domain connected. Disconnect it before adding another.',
  ],
  ['custom_domain_requires_pro', 'Your own domain is part of Pro. Upgrade and it appears here.'],
  ['custom_domain_bare', 'Use a subdomain rather than the bare domain — decks.acme.com.'],
  [
    'custom_domain_reserved',
    'That name cannot be used: it is one of ours, a lookalike of one, or a Punycode name.',
  ],
  [
    'custom_domain_invalid_format',
    'A domain is made of letters, digits and hyphens separated by dots — decks.acme.com.',
  ],
];

function describeEnrolmentError(error: { code?: string; message: string }): string | null {
  // 23505 is the unique index the two racing inserts both reach; the trigger's
  // own name covers the ordinary case.
  if (error.code === '23505' || error.message.toLowerCase().includes('duplicate key')) {
    return ENROLMENT_ERRORS[0]?.[1] ?? null;
  }
  return ENROLMENT_ERRORS.find(([name]) => error.message.includes(name))?.[1] ?? null;
}

/**
 * The exceptions schema/052 raises when a LINK names a domain it may not have,
 * as sentences. Used by the dashboard's create path; the public API maps the
 * same names in `mapCreateShareError`.
 */
export function describeShareDomainError(message: string): string | null {
  if (message.includes('share_custom_domain_not_live')) {
    return 'That domain is not serving right now. Check it in Settings, or create this link on the HTMLRadar address.';
  }
  if (message.includes('share_custom_domain_not_owned')) {
    return 'That domain is not connected to this account.';
  }
  if (message.includes('share_host_conflict')) {
    return 'A link can be on your domain or on ours, not both.';
  }
  if (message.includes('custom_domain_requires_pro')) {
    return 'Links on your own domain are part of Pro.';
  }
  return null;
}

/**
 * Claim a hostname and ask Cloudflare for its certificate.
 *
 * The row goes in first and the Cloudflare call second, so a hostname belongs
 * to exactly one account before any certificate exists for it — the unique
 * index is the thing standing between two accounts claiming the same name, and
 * it cannot do that job from inside a Cloudflare response.
 *
 * A Cloudflare failure leaves the row pending with the reason on it rather
 * than rolling back: "Check again" creates the hostname the row is missing, so
 * a customer who hits a bad minute at Cloudflare is one button from recovering
 * instead of retyping the name into a claim somebody else could take.
 */
export async function connectDomain(
  admin: SupabaseClient,
  userId: string,
  rawHostname: string,
): Promise<DomainOutcome> {
  if (!customDomainsEnabled()) return { error: 'Custom domains are not available yet.' };

  const problem = describeHostnameProblem(rawHostname);
  if (problem) return { error: problem };
  const hostname = normalizeHostname(rawHostname);

  const { data: inserted, error } = await admin
    .from('custom_domains')
    .insert({ owner_id: userId, hostname, state: 'pending' })
    .select('id')
    .maybeSingle();

  if (error) {
    const known = describeEnrolmentError(error);
    if (known) return { error: known };
    await logServerError({
      source: 'lib.custom-domains',
      message: error.message,
      userId,
      context: { step: 'insert_domain', hostname },
    });
    return { error: 'We could not connect that domain. Try again.' };
  }

  const domainId = (inserted as { id?: string } | null)?.id ?? null;
  if (!domainId) return { error: 'We could not connect that domain. Try again.' };

  try {
    const state = await twice(() => createHostname(hostname));
    await admin
      .from('custom_domains')
      .update({
        cloudflare_id: state.id,
        cloudflare_status: state.status,
        ssl_status: state.sslStatus,
        last_checked_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', domainId)
      .eq('state', 'pending');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Cloudflare refused the hostname.';
    await logServerError({
      source: 'lib.custom-domains',
      message,
      userId,
      context: { step: 'create_hostname', hostname, domain_id: domainId },
    });
    await admin
      .from('custom_domains')
      .update({ last_error: message, last_checked_at: new Date().toISOString() })
      .eq('id', domainId)
      .eq('state', 'pending');
  }

  return { ok: true, state: 'pending', message: WAITING_FOR_DNS };
}

/**
 * Where this domain stands now, and the transition that follows from it.
 *
 * Every write names the state it expects. A check that started before a
 * disconnect and finished after it therefore updates nothing, rather than
 * putting a retired row back on the internet.
 */
export async function checkDomain(
  admin: SupabaseClient,
  userId: string,
  domain: CustomDomainRow,
): Promise<DomainOutcome> {
  const from = domain.state;
  if (from === 'retired') {
    return { error: 'That domain was disconnected. Connect it again to use it.' };
  }
  // schema/052 refuses to let such a row reach 'live' at all, so checking it
  // would spend a Cloudflare call to end in an exception. Say the one thing
  // that moves it forward instead.
  if (domain.previous_owner_review) {
    return {
      error:
        'That domain was connected to another account before. Email hello@htmlradar.com and we will check it over — it takes one reply.',
    };
  }
  const now = new Date().toISOString();

  // A row whose Cloudflare hostname was never created — the connect call hit a
  // bad minute. Create it here rather than making the customer start again.
  let cloudflareId = domain.cloudflare_id;
  try {
    if (!cloudflareId) {
      const created = await twice(() => createHostname(domain.hostname));
      cloudflareId = created.id;
      await admin
        .from('custom_domains')
        .update({ cloudflare_id: created.id })
        .eq('id', domain.id)
        .eq('state', from);
    }

    const state = await getHostname(cloudflareId);

    // Cloudflare stops retrying a validation it gave up on; re-sending the SSL
    // configuration is how it is asked to start over.
    const stalled = /timed_out|expired|deleted/.test(state.sslStatus);
    const current = stalled ? await restartValidation(cloudflareId) : state;

    const active = current.status === 'active' && current.sslStatus === 'active';
    const reached = active ? await probe(domain.hostname, domain.id) : false;

    if (active && reached) {
      const { data: promoted } = await admin
        .from('custom_domains')
        .update({
          state: 'live',
          cloudflare_status: current.status,
          ssl_status: current.sslStatus,
          verified_at: domain.verified_at ?? now,
          last_checked_at: now,
          last_error: null,
          consecutive_failures: 0,
        })
        .eq('id', domain.id)
        .eq('state', from)
        .select('id')
        .maybeSingle();

      // No row updated means somebody disconnected it while we were asking
      // Cloudflare. Leave the default alone and say so.
      if (!promoted) return { error: 'That domain was disconnected while we were checking it.' };

      // A live domain IS the default — the founder's rule is that there is no
      // toggle to find.
      await admin.from('profiles').update({ default_custom_domain_id: domain.id }).eq('id', userId);

      return { ok: true, state: 'live', message: 'Live. New links use this domain.' };
    }

    const message = current.status === 'active' ? WAITING_FOR_CERTIFICATE : WAITING_FOR_DNS;
    await admin
      .from('custom_domains')
      .update({
        cloudflare_status: current.status,
        ssl_status: current.sslStatus,
        last_checked_at: now,
        last_error: active ? 'The domain does not reach HTMLRadar yet.' : message,
        consecutive_failures: (domain.consecutive_failures ?? 0) + 1,
      })
      .eq('id', domain.id)
      .eq('state', from);
    return { ok: true, state: from, message: active ? WAITING_FOR_DNS : message };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Cloudflare did not answer.';
    await logServerError({
      source: 'lib.custom-domains',
      message,
      userId,
      context: { step: 'check_domain', domain_id: domain.id },
    });
    await admin
      .from('custom_domains')
      .update({ last_checked_at: now, last_error: message })
      .eq('id', domain.id)
      .eq('state', from);
    return { error: 'We could not reach Cloudflare just now. Try again in a minute.' };
  }
}

/**
 * Give the hostname up.
 *
 * Allowed whatever the account's tier is: an expired Pro subscription must
 * never trap somebody's own domain inside our product. The default is cleared
 * first, so no link can be created on a domain that is on its way out.
 */
export async function disconnectDomain(
  admin: SupabaseClient,
  userId: string,
  domainId: string,
): Promise<DomainOutcome> {
  await admin
    .from('profiles')
    .update({ default_custom_domain_id: null })
    .eq('id', userId)
    .eq('default_custom_domain_id', domainId);

  const { data: retired, error } = await admin
    .from('custom_domains')
    .update({ state: 'retired', retired_at: new Date().toISOString() })
    .eq('id', domainId)
    .eq('owner_id', userId)
    .is('retired_at', null)
    .select('cloudflare_id')
    .maybeSingle();

  if (error) {
    await logServerError({
      source: 'lib.custom-domains',
      message: error.message,
      userId,
      context: { step: 'retire_domain', domain_id: domainId },
    });
    return { error: 'We could not disconnect that domain. Try again.' };
  }

  const cloudflareId = (retired as { cloudflare_id?: string | null } | null)?.cloudflare_id ?? null;
  if (cloudflareId) {
    try {
      await twice(() => deleteHostname(cloudflareId));
    } catch (e) {
      // The row is already retired, so nothing of ours serves the hostname.
      // A certificate left behind at Cloudflare is ours to tidy, not the
      // customer's problem, so it is logged and not shown.
      await logServerError({
        source: 'lib.custom-domains',
        message: e instanceof Error ? e.message : 'deleting the Cloudflare hostname failed',
        userId,
        level: 'warn',
        context: { step: 'delete_hostname', domain_id: domainId, cloudflare_id: cloudflareId },
      });
    }
  }

  return { ok: true, state: 'retired', message: 'Disconnected.' };
}

// ---------------------------------------------------------------------------
// Reading the hostname off a share row
// ---------------------------------------------------------------------------

// Every `document_shares` select that feeds a printed address carries
// `custom_domains(hostname, state)` beside its own columns, so the address and
// the row it belongs to arrive together and nothing has to go looking for the
// owner's current setting. The join is written at each call site as a literal
// rather than assembled here: PostgREST's select string is what supabase-js
// derives the row type from, and a string it cannot read at compile time costs
// every one of those rows its type.
//
// It is unconditional, unlike everything else in this file. Schema/052 is
// applied before this code ships (the sprint's sequencing: database first,
// inert), so the column is always there to join on; gating the join on the
// feature flag would buy nothing and cost the row types.

interface Embedded {
  custom_domains?: { hostname?: string | null; state?: string | null } | null;
}

/** The hostname a share was issued on, or null for an HTMLRadar address. */
export function customHostnameOf(row: unknown): string | null {
  return (row as Embedded | null)?.custom_domains?.hostname ?? null;
}

/** The state of that hostname's domain — 'live', or a reason links fail. */
export function customDomainStateOf(row: unknown): string | null {
  return (row as Embedded | null)?.custom_domains?.state ?? null;
}
