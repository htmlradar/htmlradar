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

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return out;
}

async function hmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64url(new Uint8Array(sig));
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
