// Worker entry. Routes:
//   GET  /r/{slug}            serves the document, gates as needed
//   POST /r/{slug}/auth       password submission
//   POST /r/{slug}/email      email submission for allow-list shares
//   GET  /r/{slug}/m/{att_id} downloads a supporting-material attachment
//   GET  /r/_doc/{doc_id}     sender-side raw-doc preview (HMAC-gated)
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
  getAttachment,
  listAttachmentsForDocument,
  logAttachmentDownload,
  logAppEvent,
  getViewerIdByShareEmail,
  verifySharePassword,
  notifyDisabledAttempt,
  UpstreamError,
  type Attachment,
  type Share,
} from './supabase.js';
import {
  issueAuthCookie,
  issueEmailCookie,
  verifyAuthCookie,
  verifyEmailCookie,
  verifyOwnerDocPreviewToken,
  verifyOwnerPreviewToken,
} from './auth.js';
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      // A transient Supabase failure must not masquerade as a deleted/missing
      // share ("this link doesn't open anything") — show the recipient the
      // try-again page. Genuine bugs still surface as a 500.
      if (err instanceof UpstreamError) return sourceUnreachable();
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // Sender's "Preview document" — minted by /docs/[id] in the app when
  // the doc owner clicks the Preview button. Bound to a doc_id (not a
  // slug); no share lookup, no gates, no tracker injection. Lets the
  // sender verify what they uploaded before creating any share.
  //
  // Path: /r/_doc/{doc_id}?owner_doc_preview={token}
  //
  // The leading underscore on `_doc` is the discriminator from a share
  // slug (which is `{adjective}-{noun}-{hex}` and can never start with
  // an underscore). Keeps the route table flat without a separate /p/
  // prefix that would confuse the recipient namespace.
  const docPreviewMatch = /^\/r\/_doc\/([a-f0-9-]{8,})\/?$/i.exec(url.pathname);
  if (docPreviewMatch) {
    const docId = docPreviewMatch[1]!;
    const previewToken = url.searchParams.get('owner_doc_preview');
    const tokenValid = previewToken
      ? await verifyOwnerDocPreviewToken(previewToken, docId, env.SESSION_SECRET)
      : false;
    if (!tokenValid) return notFound();

    const doc = await getDocument(env, docId);
    if (!doc || doc.deleted_at) return notFound();
    const htmlResp = await fetchDocumentHtml(doc, env);
    if (!htmlResp) return sourceUnreachable();
    const body = await htmlResp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // The recipient path sets these via injectTracker; mirror the
        // framing/sniffing protections on the owner-preview response so
        // arbitrary sender HTML can't be framed or content-sniffed.
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  // Recipient download of a supporting-material attachment.
  //   GET /r/{slug}/m/{attachment_id}
  // Gate sequence (must pass IN ORDER, just like the doc route):
  //   1. share exists, not revoked, not expired
  //   2. password cookie (if require_password)
  //   3. email cookie (if require_email)
  //   4. attachment exists AND attachment.document_id matches the
  //      share's document_id (defends against cross-doc enumeration)
  // Note: attachments are no longer gated by lock_deck (2026-05-19
  // Design decision — if the sender uploaded files, recipients can
  // download them; lock_deck only controls deck save/print).
  // On success: stream the R2 object with Content-Disposition: attachment
  // and a sanitised filename, log the download event, return.
  const downloadMatch = /^\/r\/([a-z0-9-]+)\/m\/([a-f0-9-]{8,})\/?$/i.exec(url.pathname);
  if (downloadMatch) {
    const slug = downloadMatch[1]!;
    const attachmentId = downloadMatch[2]!;
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    return handleAttachmentDownload(request, slug, attachmentId, env);
  }

  const match = /^\/r\/([a-z0-9-]+)(?:\/(auth|email))?\/?$/i.exec(url.pathname);
  if (!match) return new Response('Not Found', { status: 404 });
  const slug = match[1]!;
  const subroute = match[2];

  const share = await getShareBySlug(env, slug);
  if (!share) return notFound();

  // Owner-preview short-circuit. When the doc owner clicks "Preview
  // as you" in /docs/[id], the app mints a 10-minute HMAC token bound
  // to this slug and sends them here with ?owner_preview=<token>.
  // Valid token bypasses revoked/expired/password/email — the owner
  // is checking what the doc itself looks like, not the recipient's
  // gate experience. They've already proved ownership via Supabase
  // auth in the app server action that minted the token.
  const previewToken = url.searchParams.get('owner_preview');
  const isOwnerPreview = previewToken
    ? await verifyOwnerPreviewToken(previewToken, slug, env.SESSION_SECRET)
    : false;

  if (!isOwnerPreview) {
    // A disabled open serves an error shell and loads no tracker, so this
    // is the only place we learn the recipient tried. Fire-and-forget an
    // owner alert (throttled per-share in the DB) without blocking the
    // response — ctx.waitUntil keeps the worker alive until it completes.
    if (share.revoked_at) {
      ctx.waitUntil(notifyDisabledAttempt(env, share.id, 'revoked'));
      return revoked();
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      ctx.waitUntil(notifyDisabledAttempt(env, share.id, 'expired'));
      return expired();
    }
  }

  if (subroute === 'auth') {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    return handlePasswordSubmit(request, share, env);
  }
  if (subroute === 'email') {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    return handleEmailSubmit(request, share, env);
  }

  // Gate sequence: password (if required) → email (if allow-listed) → content.
  if (share.require_password && !isOwnerPreview) {
    const cookie = await verifyAuthCookie(request.headers.get('cookie'), slug, env.SESSION_SECRET);
    if (!cookie) return passwordForm(slug);
  }

  // Hard-gate the document on a verified email whenever require_email
  // is true — regardless of whether an allow-list is set.
  //
  // Why this is at the proxy and not (only) the tracker:
  //   The tracker's Shadow DOM gate identifies viewers per-browser via
  //   a localStorage viewer_id that PERSISTS across all shares from the
  //   same browser. That means if a recipient enters their email on
  //   one share they're treated as "already authenticated" on every
  //   subsequent share from the same machine — even when each share is
  //   meant for a different recipient. Founders sending decks to
  //   different investors NEED the gate to fire per-share.
  //
  //   The proxy-issued email cookie is HMAC-scoped to a single slug
  //   (see verifyEmailCookie + tests/auth.test.ts "rejects an email
  //   cookie for a different slug"), so a fresh share asks for the
  //   email again, every time.
  //
  //   When the proxy gate fires, the tracker's in-doc gate stays off
  //   because injectTracker sees `email` already set in the config
  //   (gate.enabled = require_email && !email = false).
  let verifiedEmail: string | undefined;
  if (share.require_email && !isOwnerPreview) {
    const cookie = await verifyEmailCookie(request.headers.get('cookie'), slug, env.SESSION_SECRET);
    if (!cookie) return emailGateForm(slug);
    // Re-check the cookie's email against
    // the share's CURRENT allowlist on every request — not just at
    // gate-submission time. If the sender tightened the allowlist
    // after the cookie was issued, the recipient's stale cookie
    // must NOT bypass the new rule.
    //
    // isEmailAllowed returns true for shares with no allowlist
    // (so vanilla require_email shares keep working), and for the
    // owner-preview path which already short-circuits above.
    if (!isEmailAllowed(share, cookie.email)) {
      return emailGateForm(slug, 'This document is no longer shared with your address.');
    }
    verifiedEmail = cookie.email;
  }

  const doc = await getDocument(env, share.document_id);
  if (!doc || doc.deleted_at) return notFound();

  const html = await fetchDocumentHtml(doc, env);
  if (!html) return sourceUnreachable();

  const tier = await getProfileTier(env, doc.owner_id);
  const geo = geoFromRequest(request);

  // Attachments are ALWAYS surfaced to the recipient when they exist
  // (design decision). The pill + drawer UI lives in the
  // corner; clicking expands the file list. Owner-preview still
  // skips the DB call — the sender is checking deck-render, not
  // attachments which they themselves uploaded.
  let attachments: Attachment[] = [];
  if (!isOwnerPreview) {
    attachments = await listAttachmentsForDocument(env, doc.id);
  }

  return injectTracker(html, {
    share,
    tier,
    trackerUrl: env.TRACKER_URL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    ...(verifiedEmail ? { email: verifiedEmail } : {}),
    ...(geo && Object.keys(geo).length > 0 ? { geo } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

async function handlePasswordSubmit(request: Request, share: Share, env: Env): Promise<Response> {
  const slug = share.slug;
  const form = await request.formData();
  const password = form.get('password');
  if (typeof password !== 'string' || password.length === 0) {
    return passwordForm(slug, 'Password is required.');
  }
  const verdict = await verifySharePassword(env, slug, password);
  // Awaited (not waitUntil — no ctx here): the gate outcome is the one
  // signal that separates "recipient bounced at the door" from "never
  // visited", and the insert is a single fast REST call.
  await logAppEvent(env, share.owner_id, 'share.password_submitted', {
    result: verdict,
    share_id: share.id,
    document_id: share.document_id,
  });
  if (verdict === 'rate_limited') {
    return passwordForm(slug, 'Too many attempts. Wait a minute, then try again.');
  }
  if (verdict !== 'ok') {
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
  const gateEvent = (result: string, domain: string | null) =>
    logAppEvent(env, share.owner_id, 'share.email_submitted', {
      result,
      // Domain only, never the full address — a rejected visitor's email
      // is a third party's PII the owner has no relationship with yet.
      email_domain: domain,
      share_id: share.id,
      document_id: share.document_id,
    });
  const raw = form.get('email');
  if (typeof raw !== 'string') return emailGateForm(share.slug, 'Email is required.');
  const email = raw.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    await gateEvent('invalid_format', null);
    return emailGateForm(share.slug, 'Please enter a valid email address.');
  }
  const domain = email.split('@')[1] ?? null;
  // Allowlist check happens here (post-format-validation) because we
  // need the full address to test both lists. Union semantics: if any
  // list is set, the address must match SOMETHING in at least one.
  if (!isEmailAllowed(share, email)) {
    await gateEvent('not_allowed', domain);
    return emailGateForm(share.slug, "This document isn't shared with your address.");
  }
  await gateEvent('ok', domain);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/r/${share.slug}`,
      'Set-Cookie': await issueEmailCookie(share.slug, email, env.SESSION_SECRET),
    },
  });
}

// Combined allowlist check. Returns true when:
//   - no lists are set (open), OR
//   - the email appears in allowed_emails, OR
//   - the email's domain appears in allowed_email_domains.
// Email and domains are normalised to lowercase at the call site (the
// proxy lowercases on input; the DB writes whatever the client sent —
// the create/update UI also lowercases, see actions.ts).
function isEmailAllowed(share: Share, email: string): boolean {
  const hasEmailList = Array.isArray(share.allowed_emails) && share.allowed_emails.length > 0;
  const hasDomainList =
    Array.isArray(share.allowed_email_domains) && share.allowed_email_domains.length > 0;
  if (!hasEmailList && !hasDomainList) return true;
  if (hasEmailList && share.allowed_emails!.includes(email)) return true;
  if (hasDomainList) {
    const domain = email.split('@')[1] ?? '';
    if (share.allowed_email_domains!.includes(domain)) return true;
  }
  return false;
}

// Attachment download handler. The gate order MIRRORS the doc-serve path
// so a recipient with a valid email cookie for share X can download
// materials on share X (and ONLY share X — the attachment's
// document_id must match the share's document_id).
//
// On any permission failure we return 404, NOT 403. Sender chose not to
// share downloads; we don't even confirm to the recipient that a file
// exists at that ID.
async function handleAttachmentDownload(
  request: Request,
  slug: string,
  attachmentId: string,
  env: Env,
): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share) return notFound();
  if (share.revoked_at) return notFound();
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return notFound();
  }
  // Attachments are NO LONGER gated by lock_deck (2026-05-19). They're
  // a separate access surface — if the sender uploaded them, recipients
  // can download. Sender's only way to "hide" an attachment is to not
  // attach it. Lock_deck remains for deck save/print posture only.

  // Re-apply the same gate cookies the doc-serve path enforces. Without
  // this, a recipient could craft a download URL even before they pass
  // the email gate on the underlying share.
  if (share.require_password) {
    const cookie = await verifyAuthCookie(request.headers.get('cookie'), slug, env.SESSION_SECRET);
    if (!cookie) return notFound();
  }
  let recipientEmail: string | null = null;
  if (share.require_email) {
    const cookie = await verifyEmailCookie(request.headers.get('cookie'), slug, env.SESSION_SECRET);
    if (!cookie) return notFound();
    // Same fresh-allowlist check as the doc-serve path. A
    // stale email cookie must NOT bypass a tightened allowlist on the
    // attachment route either. 404 here (not "your email's not on the
    // list") because attachments are quieter than the gate page — we
    // don't want to confirm what attachments exist behind a closed
    // gate.
    if (!isEmailAllowed(share, cookie.email)) return notFound();
    recipientEmail = cookie.email;
  }

  const attachment = await getAttachment(env, attachmentId);
  if (!attachment) return notFound();
  // Cross-doc enumeration defence: attachment must live on the same doc
  // as the share. Otherwise a recipient on share X could enumerate
  // attachment IDs from share Y on another doc.
  if (attachment.document_id !== share.document_id) return notFound();

  const obj = await env.DOCS_BUCKET.get(attachment.r2_key);
  if (!obj) return notFound();

  // Fire-and-forget download log with per-viewer attribution. We never
  // block the response on this; if Supabase is slow or down the
  // recipient still gets their file.
  //
  // Viewer lookup: when we have a verified email, we resolve the
  // existing viewers row by (share_id, email). When we don't (anonymous
  // share), viewer_id stays null and the row attributes via session_id
  // (set client-side by the tracker; we don't see it here without a
  // separate lookup, so for v1 we leave it null too — the recipient_email
  // + ip_hint + timestamp are usually enough).
  const geo = geoFromRequest(request);
  void (async () => {
    const viewerId = recipientEmail
      ? await getViewerIdByShareEmail(env, share.id, recipientEmail)
      : null;
    await logAttachmentDownload(env, {
      attachment_id: attachment.id,
      share_id: share.id,
      recipient_email: recipientEmail,
      country_code: geo?.country ?? null,
      device_type: null,
      user_agent: request.headers.get('User-Agent'),
      viewer_id: viewerId,
      session_id: null,
      filename: attachment.filename,
      size_bytes: attachment.size_bytes,
    });
    // Mirror into app_events so downloads reach the analytics funnel —
    // attachment_downloads is the product table, this is the telemetry.
    await logAppEvent(env, share.owner_id, 'attachment.downloaded', {
      share_id: share.id,
      document_id: share.document_id,
      filename: attachment.filename,
      size_bytes: attachment.size_bytes,
    });
  })();

  // Force download: Content-Disposition: attachment with the sanitised
  // filename. The filename was already sanitised at upload time
  // (ASCII-printable only — see lib/attachments.ts sanitizeFilename), so
  // no header-injection risk here. Double-quote escape the inner quote
  // just in case the upload-time sanitiser ever changes.
  const safeName = attachment.filename.replace(/"/g, '');
  const headers = new Headers();
  headers.set('Content-Type', attachment.mime_type);
  headers.set('Content-Disposition', `attachment; filename="${safeName}"`);
  headers.set('Content-Length', String(attachment.size_bytes));
  headers.set('X-Content-Type-Options', 'nosniff');
  // No caching by intermediaries — every download must hit our gate.
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  return new Response(obj.body, { status: 200, headers });
}
