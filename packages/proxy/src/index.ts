// Worker entry. Routes:
//   GET  /r/{slug}            serves the document, gates as needed
//   POST /r/{slug}/auth       password submission
//   POST /r/{slug}/email      email submission for allow-list shares
//
// Gate order: password → allow-list email → content. Each gate issues an
// HMAC-signed cookie on success (see auth.ts); subsequent requests with the
// cookie skip the gate. The document body is only ever streamed when all
// applicable gates have passed.

import type { Env } from './env.js';
import {
  getShareBySlug,
  getDocument,
  getProfileTier,
  verifySharePassword,
  type Share,
} from './supabase.js';
import { issueAuthCookie, issueEmailCookie, verifyAuthCookie, verifyEmailCookie } from './auth.js';
import { fetchDocumentHtml } from './fetch-html.js';
import { geoFromRequest, injectTracker } from './inject.js';
import {
  emailGateForm,
  expired,
  notFound,
  passwordForm,
  revoked,
  sourceUnreachable,
} from './responses.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/r\/([a-z0-9-]+)(?:\/(auth|email))?\/?$/i.exec(url.pathname);
    if (!match) return new Response('Not Found', { status: 404 });
    const slug = match[1]!;
    const subroute = match[2];

    const share = await getShareBySlug(env, slug);
    if (!share) return notFound();
    if (share.revoked_at) return revoked();
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return expired();
    }

    if (subroute === 'auth') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return handlePasswordSubmit(request, slug, env);
    }
    if (subroute === 'email') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return handleEmailSubmit(request, share, env);
    }

    // Gate sequence: password (if required) → email (if allow-listed) → content.
    if (share.require_password) {
      const cookie = await verifyAuthCookie(
        request.headers.get('cookie'),
        slug,
        env.SESSION_SECRET,
      );
      if (!cookie) return passwordForm(slug);
    }

    // When an allow-list is set, the proxy gates the document on a verified
    // email before serving any HTML. Plain email-gated shares (no allow-list)
    // use the tracker's Shadow DOM gate for the lower-friction in-document flow.
    let verifiedEmail: string | undefined;
    if (hasDomainAllowList(share)) {
      const cookie = await verifyEmailCookie(
        request.headers.get('cookie'),
        slug,
        env.SESSION_SECRET,
      );
      if (!cookie) return emailGateForm(slug);
      verifiedEmail = cookie.email;
    }

    const doc = await getDocument(env, share.document_id);
    if (!doc || doc.deleted_at) return notFound();

    const html = await fetchDocumentHtml(doc, env);
    if (!html) return sourceUnreachable();

    const tier = await getProfileTier(env, doc.owner_id);
    const geo = geoFromRequest(request);
    return injectTracker(html, {
      share,
      tier,
      trackerUrl: env.TRACKER_URL,
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
      ...(verifiedEmail ? { email: verifiedEmail } : {}),
      ...(geo && Object.keys(geo).length > 0 ? { geo } : {}),
    });
  },
} satisfies ExportedHandler<Env>;

async function handlePasswordSubmit(request: Request, slug: string, env: Env): Promise<Response> {
  const form = await request.formData();
  const password = form.get('password');
  if (typeof password !== 'string' || password.length === 0) {
    return passwordForm(slug, 'Password is required.');
  }
  if (!(await verifySharePassword(env, slug, password))) {
    return passwordForm(slug, 'Incorrect password.');
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/r/${slug}`,
      'Set-Cookie': await issueAuthCookie(slug, env.SESSION_SECRET),
    },
  });
}

async function handleEmailSubmit(request: Request, share: Share, env: Env): Promise<Response> {
  const form = await request.formData();
  const raw = form.get('email');
  if (typeof raw !== 'string') return emailGateForm(share.slug, 'Email is required.');
  const email = raw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return emailGateForm(share.slug, 'Please enter a valid email address.');
  }
  if (hasDomainAllowList(share)) {
    const domain = email.split('@')[1] ?? '';
    if (!share.allowed_email_domains!.includes(domain)) {
      return emailGateForm(share.slug, "This document isn't shared with your domain.");
    }
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/r/${share.slug}`,
      'Set-Cookie': await issueEmailCookie(share.slug, email, env.SESSION_SECRET),
    },
  });
}

function hasDomainAllowList(share: Share): boolean {
  return Array.isArray(share.allowed_email_domains) && share.allowed_email_domains.length > 0;
}
