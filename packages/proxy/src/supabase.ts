// Thin Supabase REST helpers for the Worker. Uses the service-role key.
// Recipients never touch Supabase directly; the proxy is the trust border.

import type { Env } from './env.js';

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
  allow_download: boolean;
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
  if (!res.ok) return null;
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
export async function logAttachmentDownload(
  env: Env,
  payload: {
    attachment_id: string;
    share_id: string;
    recipient_email: string | null;
    country_code: string | null;
    device_type: string | null;
    user_agent: string | null;
  },
): Promise<void> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/attachment_downloads`);
  await call(env, url, { method: 'POST', body: JSON.stringify(payload) });
}

export async function getDocument(env: Env, id: string): Promise<Document | null> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/documents`);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');

  const res = await call(env, url);
  if (!res.ok) return null;
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

export async function verifySharePassword(
  env: Env,
  slug: string,
  password: string,
): Promise<boolean> {
  const res = await call(env, new URL(`${env.SUPABASE_URL}/rest/v1/rpc/verify_share_password`), {
    method: 'POST',
    body: JSON.stringify({ p_slug: slug, p_password_plain: password }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

function call(env: Env, url: URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set('Content-Type', 'application/json');
  return fetch(url.toString(), { ...init, headers });
}
