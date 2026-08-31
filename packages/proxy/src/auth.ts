// Stateless HMAC-signed cookies for the password and email gates.
//
// Password cookie: `{slug}.{expiry}.{hmac}`        HMAC over `{slug}:{expiry}`
// Email cookie:    `{slug}.{b64email}.{expiry}.{hmac}`  HMAC over `{slug}:{email}:{expiry}`
//
// Stateless — we never store gate sessions; the cookie itself is the proof
// of having passed the gate.

const PWD_PREFIX = 'htmlradar_auth_';
const EMAIL_PREFIX = 'htmlradar_email_';
const TTL_SECONDS = 24 * 60 * 60;
// Owner preview tokens are short-lived because they're meant to be
// generated and consumed in a single navigation. 10 minutes covers
// "click the button, the page loads, owner pokes around for a few
// minutes." Doesn't need to be reusable.
const OWNER_PREVIEW_TTL_SECONDS = 10 * 60;

export interface VerifiedAuth {
  slug: string;
  expiresAt: number;
}

export interface VerifiedEmail {
  slug: string;
  email: string;
  expiresAt: number;
}

export async function issueAuthCookie(slug: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const mac = await hmac(`${slug}:${expiresAt}`, secret);
  return cookieAttrs(`${PWD_PREFIX}${slug}`, `${slug}.${expiresAt}.${mac}`);
}

export async function verifyAuthCookie(
  cookieHeader: string | null,
  slug: string,
  secret: string,
): Promise<VerifiedAuth | null> {
  if (!cookieHeader) return null;
  const raw = parseCookies(cookieHeader)[`${PWD_PREFIX}${slug}`];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [cookieSlug, expiryStr, mac] = parts as [string, string, string];
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (cookieSlug !== slug || !Number.isFinite(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(`${slug}:${expiresAt}`, secret);
  return constantTimeEqual(mac, expected) ? { slug, expiresAt } : null;
}

export async function issueEmailCookie(
  slug: string,
  email: string,
  secret: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const b64 = base64urlEncode(new TextEncoder().encode(email));
  const mac = await hmac(`${slug}:${email}:${expiresAt}`, secret);
  return cookieAttrs(`${EMAIL_PREFIX}${slug}`, `${slug}.${b64}.${expiresAt}.${mac}`);
}

export async function verifyEmailCookie(
  cookieHeader: string | null,
  slug: string,
  secret: string,
): Promise<VerifiedEmail | null> {
  if (!cookieHeader) return null;
  const raw = parseCookies(cookieHeader)[`${EMAIL_PREFIX}${slug}`];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [cookieSlug, b64email, expiryStr, mac] = parts as [string, string, string, string];
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (cookieSlug !== slug || !Number.isFinite(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;

  let email: string;
  try {
    email = new TextDecoder().decode(base64urlDecode(b64email));
  } catch {
    return null;
  }
  const expected = await hmac(`${slug}:${email}:${expiresAt}`, secret);
  return constantTimeEqual(mac, expected) ? { slug, email, expiresAt } : null;
}

// Owner-preview token. Mints a short-lived HMAC over
// `owner-preview:{slug}:{exp}` so the doc-owner can preview their own
// share without entering the email gate (which they wouldn't satisfy —
// it's gated by the proxy on a slug-scoped cookie). The token is bound
// to a single slug and expires fast; replay outside the slug or after
// TTL fails.
//
// Format: `{slug}.{exp}.{hmac}` — same shape as the auth cookie but
// the HMAC message has a different prefix so a captured auth cookie
// can't be replayed as a preview token (or vice versa).
export async function issueOwnerPreviewToken(slug: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + OWNER_PREVIEW_TTL_SECONDS;
  const mac = await hmac(`owner-preview:${slug}:${expiresAt}`, secret);
  return `${slug}.${expiresAt}.${mac}`;
}

export async function verifyOwnerPreviewToken(
  token: string | null,
  slug: string,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenSlug, expiryStr, mac] = parts as [string, string, string];
  if (tokenSlug !== slug) return false;
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`owner-preview:${slug}:${expiresAt}`, secret);
  return constantTimeEqual(mac, expected);
}

// Owner-DOCUMENT-preview token. Distinct from the share-bound owner
// preview above: this one is bound to a document_id, not a share slug,
// and lets the doc owner view the raw uploaded HTML *before* creating
// any share. The message prefix is different (`owner-doc-preview:`) so
// a captured share-preview token can't be replayed as a doc-preview
// token (or vice versa).
export async function verifyOwnerDocPreviewToken(
  token: string | null,
  docId: string,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenDocId, expiryStr, mac] = parts as [string, string, string];
  if (tokenDocId !== docId) return false;
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(`owner-doc-preview:${docId}:${expiresAt}`, secret);
  return constantTimeEqual(mac, expected);
}

function cookieAttrs(name: string, value: string): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${TTL_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

// Recipient opt-out from read tracking. Server-side by necessity: every
// proxy response carries a `sandbox` CSP without allow-same-origin, so the
// document runs in an opaque origin where localStorage and document.cookie
// both throw. A cookie set by the proxy is the only store the recipient's
// choice can survive in.
export const OPT_OUT_COOKIE =
  'hr_optout=1; Path=/r/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax';
export const OPT_OUT_CLEAR_COOKIE =
  'hr_optout=; Path=/r/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';

// The stored cookie is the only thing that decides. A query parameter used to
// decide it too, which meant a GET changed the preference — and a GET is
// reachable by a mailed link and by the shared document's own script, which
// may navigate its browsing context even from an opaque origin. Both could
// therefore switch tracking off across every sender's shares, or switch it
// back on after the recipient had turned it off. See issueOptOutToken.
export function isTrackingOptedOut(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return parseCookies(cookieHeader)['hr_optout'] === '1';
}

// Confirmation token for the opt-out POST.
//
// `GET /r/{slug}?optout=1|0` only asks the question and mints one of these;
// the POST that carries it back is the only thing that writes the cookie. An
// attacker can reach the GET but cannot produce the signature, so the write
// stays behind a deliberate click.
//
// Message is `optout|slug|expiry`, so a token minted to turn tracking off
// cannot be replayed to turn it back on, nor moved to another share.
// Format: `{expiry}.{hex hmac}` — hex rather than base64url so the value is
// safe in an HTML attribute and a form field without any encoding thought.
const OPT_OUT_TOKEN_TTL_SECONDS = 10 * 60;

export async function issueOptOutToken(
  optout: string,
  slug: string,
  secret: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + OPT_OUT_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${await hmacHex(`${optout}|${slug}|${expiresAt}`, secret)}`;
}

export async function verifyOptOutToken(
  token: string,
  optout: string,
  slug: string,
  secret: string,
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiryStr, mac] = parts as [string, string];
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(`${optout}|${slug}|${expiresAt}`, secret);
  return constantTimeEqual(mac, expected);
}

// The print grant, and why printing needs one.
//
// A browser printing a page that contains a frame prints only the part on
// screen, so Cmd+P breaks inside the wrapper and the strip has to offer Print
// itself. The first draft answered with a public /r/{slug}?print=1 address,
// and that was a way ROUND the badge: a sender could email it directly or hide
// it behind a fake strip, and the only HTMLRadar mark on it is the free-tier
// footer injected into the sender's own document, which the sender's own code
// can remove.
//
// So the print address is not public. Serving the wrapper sets a random,
// script-inaccessible cookie — HttpOnly, so the framed document cannot read
// it, and no Domain attribute, so it belongs to that exact hostname — and the
// strip's Print link carries a grant signed over the slug, that hostname and
// the cookie's value, with ten minutes' life.
//
// Four properties follow, and they are what print-grant.test.ts pins:
//   - copied into another browser, the grant has no matching cookie: dead.
//   - copied to another share, the slug does not match: dead.
//   - copied to another hostname, the hostname does not match: dead.
//   - kept for a quarter of an hour: expired.
// Every one of those redirects to the wrapper, where a live grant is minted,
// so a genuine reader is never dead-ended — they are put back in front of the
// badge, which is the whole point.
//
// Format `{expiry}.{hex hmac}`, hex so the value needs no encoding thought in
// an href. Message is prefixed `print:`, so no other token in this file can be
// replayed as one of these, or one of these as another.
const PRINT_COOKIE_NAME = 'hr_print';
const PRINT_GRANT_TTL_SECONDS = 10 * 60;
// A day, so a reader who leaves the tab open overnight and prints in the
// morning re-uses the same binding rather than losing it. The GRANT is the
// short-lived half; this is only the thing it is bound to.
const PRINT_COOKIE_MAX_AGE = 24 * 60 * 60;

// Path=/r/ like the opt-out cookie: sent with the print route, sent with
// nothing outside the recipient namespace.
export function printCookie(secret: string): string {
  return `${PRINT_COOKIE_NAME}=${secret}; Path=/r/; Max-Age=${PRINT_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function readPrintCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const raw = parseCookies(cookieHeader)[PRINT_COOKIE_NAME];
  return raw && /^[0-9a-f]{32}$/.test(raw) ? raw : null;
}

export function newPrintSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function issuePrintGrant(
  slug: string,
  hostname: string,
  cookieSecret: string,
  secret: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + PRINT_GRANT_TTL_SECONDS;
  const mac = await hmacHex(printMessage(slug, hostname, cookieSecret, expiresAt), secret);
  return `${expiresAt}.${mac}`;
}

export async function verifyPrintGrant(
  grant: string | null,
  slug: string,
  hostname: string,
  cookieHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!grant) return false;
  const cookieSecret = readPrintCookie(cookieHeader);
  if (!cookieSecret) return false;
  const parts = grant.split('.');
  if (parts.length !== 2) return false;
  const [expiryStr, mac] = parts as [string, string];
  const expiresAt = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(printMessage(slug, hostname, cookieSecret, expiresAt), secret);
  return constantTimeEqual(mac, expected);
}

const printMessage = (
  slug: string,
  hostname: string,
  cookieSecret: string,
  expiresAt: number,
): string => `print:${slug}|${hostname.toLowerCase()}|${cookieSecret}|${expiresAt}`;

// The rate-limit identity for an abuse report, and the only thing about the
// reporter that leaves this worker.
//
// The report itself is anonymous — no sign-in, no address field — but "five an
// hour" has to count something. This is that something: an HMAC of the
// connecting address under SESSION_SECRET, so the database stores an opaque
// string and never the address, and a reader of that table cannot walk the
// hash back by trying every address in the world, because the key is not in
// the database.
//
// An empty address (no CF-Connecting-IP, which is every local run and no
// production request) hashes to one stable value, so those reporters share a
// single budget. That fails toward more limiting, which is the right way for
// a limit to fail.
export async function hashReporterAddress(address: string, secret: string): Promise<string> {
  return hmacHex(`abuse-reporter:${address}`, secret);
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

async function hmacBytes(message: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

async function hmac(message: string, secret: string): Promise<string> {
  return base64url(await hmacBytes(message, secret));
}

async function hmacHex(message: string, secret: string): Promise<string> {
  return [...(await hmacBytes(message, secret))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64url(bytes: Uint8Array): string {
  return base64urlEncode(bytes);
}

function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
