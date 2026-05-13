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
  allowed_email_domains: string[] | null;
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
