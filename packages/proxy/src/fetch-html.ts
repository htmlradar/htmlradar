import type { Document } from './supabase.js';
import type { Env } from './env.js';

const URL_CACHE_TTL_SECONDS = 600;
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function fetchDocumentHtml(doc: Document, env: Env): Promise<Response | null> {
  if (doc.source_type === 'upload') {
    if (!doc.r2_key) return null;
    const object = await env.DOCS_BUCKET.get(doc.r2_key);
    if (!object) return null;
    return new Response(object.body, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!doc.source_url) return null;
  return fetchExternal(doc.source_url);
}

async function fetchExternal(initialUrl: string): Promise<Response | null> {
  // Follow redirects manually, cap body size, never resolve into a non-public
  // host. Defense in depth: Cloudflare Workers already block RFC-1918 egress,
  // but we re-check.
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(url)) return null;

    const upstream = await fetch(url, {
      redirect: 'manual',
      cf: { cacheTtl: URL_CACHE_TTL_SECONDS, cacheEverything: true },
      headers: { 'User-Agent': 'HTMLRadar-Proxy/1.0' },
    } as RequestInit);

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('Location');
      if (!location) return null;
      url = new URL(location, url).toString();
      continue;
    }

    if (!upstream.ok) return null;

    const contentType = upstream.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().includes('html')) return null;

    const declared = Number.parseInt(upstream.headers.get('Content-Length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;

    return new Response(upstream.body, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return null;
}

export function isPublicHttpUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  // IPv4-literal sanity check for the obvious private ranges; CF Workers can't
  // reach these from egress anyway, but better to fail fast and explicit.
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  return true;
}
