// Thin Supabase REST helpers for the Worker. Uses the service-role key.
// Recipients never touch Supabase directly; the proxy is the trust border.

import type { Env } from './env.js';

// Thrown when an upstream (Supabase) request fails at the transport/HTTP level
// — distinct from "the query succeeded but returned no rows". Lets the worker
// show recipients a "try again" page instead of a "deleted" 404 on a transient
// Supabase blip.
export class UpstreamError extends Error {}

export interface Share {
  id: string;
  document_id: string;
  owner_id: string;
  slug: string;
  recipient_label: string | null;
  require_email: boolean;
  require_password: boolean;
  // Whole-domain allowlist: addresses at any of these domains pass the
  // gate (e.g. ['example-capital.test'] → sarah@example-capital.test OK).
  allowed_email_domains: string[] | null;
  // Specific-email allowlist: only these exact addresses pass the gate.
  // When both lists are non-empty the gate accepts a UNION — useful for
  // "everyone at this company + these two external advisors."
  allowed_emails: string[] | null;
  // Per-share permission to download supporting materials. When false
  // the proxy returns 404 for the download endpoint AND skips injecting
  // the materials panel into the recipient's view — they have no signal
  // that attachments exist on this doc.
  // Renamed from `allow_download` (migration 015). Semantic flipped:
  //   true  → deck save/print/screenshot blocked + per-viewer watermark
  //   false → deck saveable + printable + no watermark
  // Attachments are now ALWAYS visible to recipients when present —
  // not gated by this flag. Per 2026-05-19 design decision.
  lock_deck: boolean;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface Document {
  id: string;
  owner_id: string;
  title: string;
  source_type: 'upload' | 'url';
  source_url: string | null;
  current_version: number;
  r2_key: string | null;
  deleted_at: string | null;
}

export interface Attachment {
  id: string;
  document_id: string;
  owner_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  created_at: string;
}

export async function getShareBySlug(env: Env, slug: string): Promise<Share | null> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/document_shares`);
  url.searchParams.set('slug', `eq.${slug}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');

  const res = await call(env, url);
  if (!res.ok) throw new UpstreamError(`document_shares lookup failed: ${res.status}`);
  const rows = (await res.json()) as Share[];
  return rows[0] ?? null;
}

// Look up a single attachment by id. Used by the recipient-side download
// route AND by the proxy when injecting the materials panel into the
// recipient's HTML (to render the file list).
export async function getAttachment(env: Env, id: string): Promise<Attachment | null> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/document_attachments`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');
  const res = await call(env, url);
  if (!res.ok) return null;
  const rows = (await res.json()) as Attachment[];
  return rows[0] ?? null;
}

// All attachments for a document, in upload order. Used by the inject
// pipeline to render the materials panel. The proxy uses service-role
// so RLS is bypassed — owner_id is what scopes ownership at the app
// boundary, not the read path.
export async function listAttachmentsForDocument(
  env: Env,
  documentId: string,
): Promise<Attachment[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/document_attachments`);
  url.searchParams.set('document_id', `eq.${documentId}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('order', 'created_at.asc');
  const res = await call(env, url);
  if (!res.ok) return [];
  return (await res.json()) as Attachment[];
}

// Log a successful download. Fire-and-forget; failure here must not
// break the user-visible download.
//
// New columns from migration 016 (viewer_id, session_id, filename,
// size_bytes) — populated whenever the proxy can resolve them. When
// the share is anonymous and we have no email cookie, viewer_id stays
// null and the row still represents "someone with this fingerprint
// downloaded at this time" via session_id (when we have it).
export async function logAttachmentDownload(
  env: Env,
  payload: {
    attachment_id: string;
    share_id: string;
    recipient_email: string | null;
    country_code: string | null;
    device_type: string | null;
    user_agent: string | null;
    viewer_id: string | null;
    session_id: string | null;
    filename: string | null;
    size_bytes: number | null;
  },
): Promise<void> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/attachment_downloads`);
  await call(env, url, { method: 'POST', body: JSON.stringify(payload) });
}

// Resolve viewer_id by share + email. Used at attachment-download time
// to attribute the download to the specific viewer row the recipient
// already created when they hit the email gate or first scrolled the
// share. Returns null if no viewer row matches yet (recipient is
// downloading before the tracker established their viewer record —
// race we ignore; the row will still link via session_id).
export async function getViewerIdByShareEmail(
  env: Env,
  shareId: string,
  email: string,
): Promise<string | null> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/viewers`);
  url.searchParams.set('share_id', `eq.${shareId}`);
  url.searchParams.set('email', `eq.${email.toLowerCase()}`);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');
  const res = await call(env, url);
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function getDocument(env: Env, id: string): Promise<Document | null> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/documents`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');

  const res = await call(env, url);
  if (!res.ok) throw new UpstreamError(`documents lookup failed: ${res.status}`);
  const rows = (await res.json()) as Document[];
  return rows[0] ?? null;
}

export async function getProfileTier(env: Env, ownerId: string): Promise<'free' | 'pro'> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set('id', `eq.${ownerId}`);
  url.searchParams.set('select', 'tier');
  url.searchParams.set('limit', '1');

  const res = await call(env, url);
  if (!res.ok) return 'free';
  const rows = (await res.json()) as Array<{ tier: 'free' | 'pro' }>;
  return rows[0]?.tier ?? 'free';
}

// 'ok' = correct password; 'bad' = wrong; 'rate_limited' = the RPC's per-slug
// rate limiter tripped (5/min) — kept distinct so the recipient sees a "wait a
// minute" message instead of being told their (possibly correct) password is
// wrong.
export async function verifySharePassword(
  env: Env,
  slug: string,
  password: string,
): Promise<'ok' | 'bad' | 'rate_limited'> {
  const res = await call(env, new URL(`${env.SUPABASE_URL}/rest/v1/rpc/verify_share_password`), {
    method: 'POST',
    body: JSON.stringify({ p_slug: slug, p_password_plain: password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429 || /rate.?limit|P0001|too many/i.test(body)) return 'rate_limited';
    return 'bad';
  }
  return (await res.json()) === true ? 'ok' : 'bad';
}

// Best-effort analytics insert into app_events, owner-scoped (same
// convention as the share.first_view trigger: the event belongs to the
// document owner's funnel, never to a recipient identity). Never throws —
// a failed analytics write must never change what the recipient sees.
// Hygiene rule for gate events: never put a rejected third party's full
// email address in properties; domain-only.
export async function logAppEvent(
  env: Env,
  ownerId: string,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await call(env, new URL(`${env.SUPABASE_URL}/rest/v1/app_events`), {
    method: 'POST',
    body: JSON.stringify({
      distinct_id: ownerId,
      event,
      properties,
      user_id: ownerId,
    }),
  }).catch(() => undefined);
}

// Best-effort: tell the DB a recipient hit a DISABLED link (revoked or
// expired) so it can email the owner. There is no session or tracker on a
// disabled open — the recipient gets an error shell — so the proxy is the
// only thing that knows the attempt happened. The DB function throttles
// per-share (one email per cooldown) and re-validates the state, so calling
// this on every hit is safe. Never throws: a failed alert must never change
// what the recipient sees (the error page) or stall the response.
export async function notifyDisabledAttempt(
  env: Env,
  shareId: string,
  kind: 'revoked' | 'expired',
): Promise<void> {
  await call(env, new URL(`${env.SUPABASE_URL}/rest/v1/rpc/notify_disabled_attempt`), {
    method: 'POST',
    body: JSON.stringify({ p_share_id: shareId, p_kind: kind }),
  }).catch(() => undefined);
}

function call(env: Env, url: URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('Content-Type', 'application/json');
  return fetch(url.toString(), { ...init, headers });
}
