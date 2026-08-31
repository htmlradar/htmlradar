// Worker entry.
//
// HOSTS. Recipient documents are served from their own registrable domain,
// `SHARE_HOST` (htmlradar.page in production). A customer's HTML therefore
// never shares an origin with the application's session cookies, and a
// phishing page pushed through us cannot wear the primary domain's
// certificate or its reputation with the blocklists.
//
// `LEGACY_HOSTS` (htmlradar.com in production) is where every link sent
// before the move points. Those links keep working — see the legacy-host block
// at the top of handleRequest.
//
// Routes (on SHARE_HOST, and on a legacy host for POST only):
//   GET  /r/{slug}            serves the document, gates as needed
//   POST /r/{slug}/auth       password submission
//   POST /r/{slug}/email      email submission for allow-list shares
//   GET  /r/{slug}/report     the recipient's abuse report form
//   POST /r/{slug}/report     the report itself
//   GET  /r/{slug}/frame      the document, inside the trust wrapper's frame
//   GET  /r/{slug}/print      the document unframed, behind a signed grant
//   GET  /r/{slug}/m/{att_id} downloads a supporting-material attachment
//   GET  /r/_doc/{doc_id}     sender-side raw-doc preview (HMAC-gated)
//   GET  /v1/tracker.js       the tracker, first-party to the document
//   GET  /robots.txt          Disallow: / — SHARE_HOST is not a website
//
// THE TRUST WRAPPER. With TRUST_WRAPPER off — its shipped state — /r/{slug}
// answers exactly as it always has and /frame and /print are not-found. Turned
// on for a slug, /r/{slug} instead returns HTMLRadar's own thin page (see
// wrapper.ts) with the document in a frame above a strip the sender cannot
// remove, cover or intercept. The design is
// docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md.
//
// WHICH HOST SERVES WHAT. Every share carries a stored hostname, `host_handle`
// (schema/043), and routing follows THAT value rather than the owner's current
// handle, so no link that has already been sent ever moves. See resolveHost
// and enforceStoredHost below for the design's five rules; the check runs on
// every route carrying a share identifier, not only the document route.
//
// Anything else on SHARE_HOST is a 404, and every response carries
// X-Robots-Tag: noindex (see withNoIndex).
//
// The share route also carries the recipient's own switch for read tracking:
//   GET  /r/{slug}?optout=1|0 asks the question and mints a token
//   POST /r/{slug}            with `optout` + `token` writes the cookie
// See handleOptOutSubmit below for why the GET must not write.
//
// Gate order: password → allow-list email → content. Each gate issues an
// HMAC-signed cookie on success (see auth.ts); subsequent requests with the
// cookie skip the gate. The document body is only ever streamed when all
// applicable gates have passed.

import type { Env } from './env.js';
import {
  getShareBySlug,
  getDocument,
  reportAbuse,
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
  hashReporterAddress,
  issueAuthCookie,
  issueEmailCookie,
  issueOptOutToken,
  issuePrintGrant,
  isTrackingOptedOut,
  newPrintSecret,
  printCookie,
  readPrintCookie,
  verifyAuthCookie,
  verifyEmailCookie,
  verifyOptOutToken,
  verifyOwnerDocPreviewToken,
  verifyOwnerPreviewToken,
  verifyPrintGrant,
  OPT_OUT_CLEAR_COOKIE,
  OPT_OUT_COOKIE,
} from './auth.js';
import { fetchDocumentHtml } from './fetch-html.js';
import { geoFromRequest, injectTracker } from './inject.js';
import { wrapperPage, FRAME_SANDBOX, OWN_PAGE_HEADER } from './wrapper.js';
import {
  emailGateForm,
  expired,
  notFound,
  optOutConfirm,
  passwordForm,
  reportForm,
  reportSent,
  revoked,
  sourceUnreachable,
  NOTE_MAX_LENGTH,
  REPORT_REASONS,
} from './responses.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Defaults, so `wrangler dev` and the tests behave without configuration.
// Production values are the [vars] block in wrangler.toml.
const SHARE_HOST_DEFAULT = 'htmlradar.page';
const LEGACY_HOSTS_DEFAULT = 'htmlradar.com';

const shareHostOf = (env: Env): string => env.SHARE_HOST ?? SHARE_HOST_DEFAULT;

// Where the injected <script> points, and the path this worker answers it on.
// Relative, so the tracker is always first-party to the document that loads
// it: same host, no second DNS lookup, and nothing for a third-party script
// blocker to recognise. env.TRACKER_URL is the upstream this worker fetches
// it from (Cloudflare Pages, on the application domain).
const TRACKER_PATH = '/v1/tracker.js';

const isLocal = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

function isLegacyHost(hostname: string, env: Env): boolean {
  return (env.LEGACY_HOSTS ?? LEGACY_HOSTS_DEFAULT)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(hostname.toLowerCase());
}

/**
 * The move off the primary domain, for links that were already sent.
 *
 * A GET or HEAD on a legacy host is answered with a permanent redirect to the
 * same path and query on SHARE_HOST, so a recipient who kept an old email
 * still opens the document — one extra hop, nothing else changes.
 *
 * A POST is served in place instead. Three things post to /r/: the password
 * gate, the email gate, and the opt-out confirmation. A 301 turns a POST into
 * a GET and drops the body, so redirecting them would break the gate for
 * anyone whose tab was already open when the switch happened. Serving them
 * where they were sent keeps those tabs working.
 *
 * WINDOW: this in-place POST handling only matters while pre-switch tabs are
 * still open. Thirty days after the switch — from 30 September 2026 — it can
 * be deleted, and the redirect can cover every method. The redirect itself
 * stays for as long as old links are in circulation, which is indefinitely.
 *
 * A recipient who submits a gate on a legacy host after the switch sets the
 * cookie on that host, is redirected to SHARE_HOST on the following GET, and
 * is asked once more there. One retype, not a dead end.
 */

// Every response this worker produces is a recipient-facing page for somebody
// else's document, and none of it should ever appear in a search result.
// robots.txt asks crawlers not to fetch /r/, but robots.txt only governs
// crawling — a memorable address found somewhere else (a forwarded email, a
// pasted link in a public channel) can still be indexed from that reference
// alone. X-Robots-Tag is the instruction that actually removes it. Applied
// here, once, rather than in responses.ts, so no future response shape can be
// added without it.
function withNoIndex(res: Response, env: Env): Response {
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Deploy verification reads this back from the live route to prove the
  // commit it just uploaded is the one the edge serves.
  out.headers.set('X-HTMLRadar-Version', env.GIT_SHA ?? 'dev');

  // Sandbox every proxy response into an opaque origin.
  //
  // Customer-uploaded HTML is served from this worker on the same origin as
  // the application, and inject.ts intentionally does not constrain
  // script-src, because customer documents legitimately carry their own
  // scripts. Omitting allow-same-origin gives those documents an opaque
  // origin, so they cannot reach application storage or make same-origin
  // requests to it. Their own scripts still run.
  //
  // Applied here rather than in inject.ts because the owner preview route
  // builds its own Response and never calls injectTracker; this helper wraps
  // every response, including the error path.
  //
  // append, not set: a response may already carry a policy from inject.ts,
  // and multiple CSP headers combine restrictively.
  //
  // Interim hardening. Recipient documents should move to an origin that
  // holds no application cookies.
  //
  // THE ONE EXEMPTION is the trust wrapper, HTMLRadar's own page, which holds
  // no customer HTML and must keep a real origin: an opaque origin has no
  // registrable domain, and the browser decides a request's "same-site"
  // question from the top-level document's site, so a sandboxed wrapper would
  // make its own frame request cross-site and the gate cookies would not be
  // sent with it. wrapper.ts sets the marker; it never reaches the reader.
  // Everything else on this worker — every response carrying customer HTML,
  // frame and print alike, and the error path — is sandboxed here, once, so no
  // future response shape can be added without it.
  if (out.headers.has(OWN_PAGE_HEADER)) {
    out.headers.delete(OWN_PAGE_HEADER);
  } else {
    out.headers.append('Content-Security-Policy', `sandbox ${FRAME_SANDBOX}`);
  }
  return out;
}

/**
 * Which hostname this request arrived on, in the only three shapes that mean
 * anything: the apex, exactly one handle label under it, or a shape we refuse.
 *
 * Rule 4 of the design's routing: hostnames are accepted only as the apex or
 * exactly one handle label. Extra levels and malformed labels get the same
 * not-found response as an unknown handle and a mismatched owner, so probing
 * the wildcard reveals nothing about who exists.
 *
 * Anything that is not the apex and not under it — a legacy host being served
 * in place, a self-hoster's own host, localhost under `wrangler dev` — is
 * treated as the apex, which is what those hosts have always been. This
 * function only classifies hosts BELOW the share host, because those are the
 * only ones the wildcard record can create.
 */
type HostKind = { kind: 'apex' } | { kind: 'handle'; handle: string } | { kind: 'refused' };

const APEX: HostKind = { kind: 'apex' };

// The handle format, matching the check constraint in schema/043 exactly:
// three to twenty-four characters, no leading or trailing hyphen, no
// consecutive hyphens, ASCII only. A hostname with an extra level fails it on
// the dot, which is what makes rule 4 fall out of the same test.
const HANDLE_LABEL = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;

function resolveHost(hostname: string, env: Env): HostKind {
  const apex = shareHostOf(env).toLowerCase();
  const host = hostname.toLowerCase();
  if (host === apex) return APEX;
  if (!host.endsWith(`.${apex}`)) return APEX;
  const label = host.slice(0, -(apex.length + 1));
  if (!HANDLE_LABEL.test(label) || label.includes('--')) return { kind: 'refused' };
  return { kind: 'handle', handle: label };
}

/**
 * The stored-hostname check, run on every route carrying a share identifier —
 * the gates, the report form, the frame, print and attachment downloads — and
 * not only on the document route, which would leave the others as ways to
 * reach a share from the wrong host.
 *
 * Returns a response when the request must be answered here, and null when it
 * may continue. The three rules it enforces:
 *
 *   1. Apex request, share stores no hostname: served in place. These are the
 *      links already sent, and they work forever — no redirect, no repeated
 *      gate. Every share that exists today is one of these.
 *   2. Apex request, share stores a hostname: permanent redirect to it. Those
 *      links were only ever printed in handle form, so no session is
 *      disturbed. A method that carries a body redirects with 308, never 301,
 *      which would turn a gate submission into a GET and drop what was typed.
 *   3. A handle host that does not match the share's stored hostname: not
 *      found, and identically so. Without this an abuser could have their own
 *      document served on a rival's host, or on microsoft.htmlradar.page, and
 *      poison a name they do not own.
 */
function enforceStoredHost(
  host: HostKind,
  share: Share,
  url: URL,
  method: string,
  env: Env,
): Response | null {
  if (host.kind === 'refused') return notFound();
  if (host.kind === 'handle') {
    return share.host_handle === host.handle ? null : notFound();
  }
  if (!share.host_handle) return null;
  const target = new URL(url.toString());
  target.hostname = `${share.host_handle}.${shareHostOf(env)}`;
  target.protocol = 'https:';
  const status = method === 'GET' || method === 'HEAD' ? 301 : 308;
  return new Response(null, { status, headers: { Location: target.toString() } });
}

// Back to the badge. Every refusal on the frame and print routes lands here
// rather than dead-ending, because the wrapper is where a live grant is minted
// and where the strip is. 302, not 301: the frame address is not permanently
// the wrapper, it is only not one right now.
const toWrapper = (slug: string): Response =>
  new Response(null, { status: 302, headers: { Location: `/r/${slug}` } });

/**
 * The trust layer's gate, and the whole of its rollback.
 *
 * Empty or unset is off, and off means the deployed behaviour is what it was
 * before any of this existed: /r/{slug} serves the document, /frame and
 * /print are not-found. A comma-separated list turns it on for those slugs
 * alone, which is how it reaches QA shares first; "*" turns it on for
 * everybody.
 */
function wrapperEnabled(slug: string, env: Env): boolean {
  const setting = (env.TRUST_WRAPPER ?? '').trim();
  if (!setting) return false;
  if (setting === '*') return true;
  return setting
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(slug);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return withNoIndex(await handleRequest(request, env, ctx), env);
    } catch (err) {
      // A transient Supabase failure must not masquerade as a deleted/missing
      // share ("this link doesn't open anything") — show the recipient the
      // try-again page. Genuine bugs still surface as a 500.
      if (err instanceof UpstreamError) return withNoIndex(sourceUnreachable(), env);
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // Two reasons to send the reader somewhere else, answered in one hop.
  //
  // Wrong host: a legacy host only redirects, and only for methods that
  // survive a redirect (see the note above).
  //
  // Wrong scheme: a recipient document must never travel in the clear. The
  // .page top-level domain is HTTPS-only by browser policy anyway, so in
  // production this fires only for a client that asked for http:// itself.
  // `wrangler dev` serves plain HTTP on localhost, which is exempt so local
  // runs behave.
  const wrongHost = isLegacyHost(url.hostname, env) && request.method !== 'POST';
  if (wrongHost) url.hostname = shareHostOf(env);
  const wrongScheme = url.protocol === 'http:' && !isLocal(url.hostname);
  if (wrongScheme) url.protocol = 'https:';
  if (wrongHost || wrongScheme) {
    return new Response(null, { status: 301, headers: { Location: url.toString() } });
  }

  // Rule 4, before anything else looks at the path: a hostname that is neither
  // the apex nor exactly one well-formed handle label under it answers the
  // standard not-found, whatever was asked for. Applied here so an extra
  // hostname level cannot reach a single route, share-bearing or not.
  const host = resolveHost(url.hostname, env);
  if (host.kind === 'refused') return notFound();

  if (url.pathname === TRACKER_PATH) {
    return fetch(env.TRACKER_URL);
  }

  // SHARE_HOST carries documents, not a website. Nothing on it should ever be
  // crawled; the 404 below covers every path that is not a share.
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

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
    const slug = downloadMatch[1]!.toLowerCase();
    const attachmentId = downloadMatch[2]!;
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    return handleAttachmentDownload(request, slug, attachmentId, host, env);
  }

  const match = /^\/r\/([a-z0-9-]+)(?:\/(auth|email|report|frame|print))?\/?$/i.exec(url.pathname);
  if (!match) return new Response('Not Found', { status: 404 });
  // Lowercased rather than redirected to the canonical form. Every stored
  // slug is lowercase (the format is enforced by the validate_share_slug
  // trigger, schema/033) while the route regex is case-insensitive and the
  // PostgREST lookup is not, so `/r/Acme-Proposal` retyped off a printed page
  // or an email client that title-cased it would otherwise 404.
  //
  // A redirect would canonicalise the URL, but it costs a round trip and the
  // two POST sub-routes (/auth, /email) would need 307/308 to keep their
  // method — extra machinery for a cosmetic gain. Lowercasing here instead
  // means one value flows through everything downstream: the lookup, the HMAC
  // cookie scope (issued and verified against this same string), and the form
  // targets. Duplicate-URL indexing is not a concern because every response
  // carries X-Robots-Tag: noindex.
  const slug = match[1]!.toLowerCase();
  const subroute = match[2]?.toLowerCase();
  // The two routes the trust wrapper adds. Both serve customer HTML and both
  // are gated exactly as the document route is; `framed` also chooses the
  // quieter answer at each gate, because a frame is not a page a person reads
  // an explanation on.
  const framed = subroute === 'frame' || subroute === 'print';

  // GATE. Off is how this ships, and off means these two routes do not exist:
  // the standard not-found, before any lookup, so nothing about the share
  // leaks and no disabled-open alert fires.
  if (framed && !wrapperEnabled(slug, env)) return notFound();

  // Read-tracking opt-out. Handled before the share lookup: the preference is
  // browser-wide, not per-share, so it should not depend on this particular
  // link still being live — and asking the question must not fire the
  // disabled-open alert below.
  if (!subroute) {
    if (request.method === 'POST') {
      const written = await handleOptOutSubmit(request, slug, env);
      if (written) return written;
    } else {
      const param = url.searchParams.get('optout');
      if (param === '1' || param === '0') {
        return optOutConfirm(slug, param, await issueOptOutToken(param, slug, env.SESSION_SECRET));
      }
    }
  }

  const share = await getShareBySlug(env, slug);
  if (!share) return notFound();

  // Which host may serve THIS share, before any gate answers. Covers the
  // document, both gate submissions, the report form, the frame and print;
  // the attachment route runs the same check against its own lookup.
  const wrongStoredHost = enforceStoredHost(host, share, url, request.method, env);
  if (wrongStoredHost) return wrongStoredHost;

  // The frame route refuses to be a top-level page.
  //
  // If a sender emails the frame address to skip the badge, the browser sends
  // Sec-Fetch-Dest: document — a header browsers write and page scripts cannot
  // forge. Anything other than `iframe`, its absence included, is sent to the
  // wrapper, which is where the badge is.
  //
  // After the stored-hostname check, not before it, so that a request on a
  // host this share was never created for gets the same not-found as every
  // other route rather than a redirect that says the route exists.
  if (subroute === 'frame' && request.headers.get('Sec-Fetch-Dest') !== 'iframe') {
    return toWrapper(slug);
  }

  // The print grant. Missing, expired, wrong-slug, wrong-hostname or
  // wrong-browser all land on the wrapper, where a live one is minted, so a
  // genuine reader whose grant simply aged out is never dead-ended — they are
  // put back in front of the badge, which is the point.
  if (subroute === 'print') {
    const granted = await verifyPrintGrant(
      url.searchParams.get('g'),
      slug,
      url.hostname,
      request.headers.get('cookie'),
      env.SESSION_SECRET,
    );
    if (!granted) return toWrapper(slug);
  }

  // The abuse report, answered before the revoked/expired branch below.
  //
  // A link that was turned off after it was sent is exactly the kind somebody
  // comes back to report, and a reporter who met the "sender turned this link
  // off" page instead of the form would have no way through. Answering here
  // also keeps a report from firing the owner's disabled-open alert — telling
  // a phishing sender that somebody just came back to their dead link is the
  // one thing this path must never do.
  if (subroute === 'report') {
    if (request.method === 'POST') return handleReportSubmit(request, share, env);
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
    return reportForm(slug);
  }

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

  const isDisabled =
    !!share.revoked_at || !!(share.expires_at && new Date(share.expires_at).getTime() < Date.now());

  // A revoked or expired share is answered on the wrapper's own address, where
  // the reader gets the explanation and the owner gets the one alert. The
  // frame and print routes are reachable only by someone who went round that,
  // so they answer not-found and fire nothing: a second alert per open would
  // be noise, and telling a phishing sender that somebody came back to their
  // dead link is the one thing this path must never do.
  if (framed && isDisabled) return notFound();

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
  //
  // The frame and print routes repeat every check the document route makes,
  // and answer not-found rather than a gate form: a gate rendered inside the
  // frame would ask for a password under a badge that says the document is
  // already open, and print is not a page anybody types into. Both are reached
  // only through the wrapper, which shows the gate at its own address.
  if (share.require_password && !isOwnerPreview) {
    const cookie = await verifyAuthCookie(request.headers.get('cookie'), slug, env.SESSION_SECRET);
    if (!cookie) return framed ? notFound() : passwordForm(slug);
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
    if (!cookie) return framed ? notFound() : emailGateForm(slug);
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
      return framed
        ? notFound()
        : emailGateForm(slug, 'This document is no longer shared with your address.');
    }
    verifiedEmail = cookie.email;
  }

  // Every gate has passed, so the wrapper may be served. It is HTMLRadar's own
  // page and needs nothing from the document: the frame route below fetches
  // that, one extra request on the same connection to the same worker.
  //
  // The owner's own preview is deliberately NOT wrapped. The badge is a
  // recipient-facing control, the preview token already bypasses every other
  // recipient gate, and a sender checking their own rendering should see their
  // own document.
  //
  // ponytail: no document check here, so a share whose document was deleted
  // shows the wrapper with a not-found inside the frame rather than a clean
  // not-found page. Buying the tidier answer costs a second database call on
  // every open, which is the call this design just removed.
  if (!subroute && !isOwnerPreview && wrapperEnabled(slug, env)) {
    // Printing is already blocked on a locked deck, so its strip carries no
    // Print link and no print cookie is minted for it.
    const existingSecret = readPrintCookie(request.headers.get('cookie'));
    const printSecret = share.lock_deck ? null : (existingSecret ?? newPrintSecret());
    const grant = printSecret
      ? await issuePrintGrant(slug, url.hostname, printSecret, env.SESSION_SECRET)
      : null;
    return wrapperPage({
      slug,
      printHref: grant ? `/r/${slug}/print?g=${grant}` : null,
      // Only when it is new. Re-minting on every load would kill the grant a
      // second tab on the same share is holding.
      setCookie: printSecret && printSecret !== existingSecret ? printCookie(printSecret) : null,
    });
  }

  const doc = await getDocument(env, share.document_id);
  if (!doc || doc.deleted_at) return notFound();

  const html = await fetchDocumentHtml(doc, env);
  if (!html) return sourceUnreachable();

  // Came back with the share, from share_lookup. A missing profile row leaves
  // it null, which reads as free — the safe direction for the badge decision
  // to fail, since the other way silently gives the paid feature away.
  const tier = share.owner_tier ?? 'free';
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

  // An opted-out recipient gets the document itself, the free-tier badge and
  // the same sandbox CSP — just no tracker, and therefore no session.
  const optedOut = isTrackingOptedOut(request.headers.get('cookie'));

  return injectTracker(html, {
    share,
    tier,
    // frame-ancestors 'self' and no X-Frame-Options, on that route alone.
    framed: subroute === 'frame',
    // Print is a second view of a document the reader already opened, so it
    // does not start a session of its own. Today's Cmd+P on the unwrapped page
    // does not either, and a print address that carried a viewer's identity
    // would be a worse thing to leave in a browser's history.
    trackingEnabled: subroute !== 'print' && !isOwnerPreview && !optedOut,
    trackerUrl: TRACKER_PATH,
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    ...(verifiedEmail ? { email: verifiedEmail } : {}),
    ...(geo && Object.keys(geo).length > 0 ? { geo } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

/**
 * The opt-out write. Returns null when this POST is not one, so anything else
 * posted to /r/{slug} keeps whatever behaviour it had.
 *
 * This is the whole reason the GET stopped writing. `hr_optout` has
 * `Path=/r/`, so it governs every share on the host, and the old `?optout=`
 * query parameter set it on a plain navigation. A shared document may
 * navigate its own browsing context even from the opaque sandbox origin it
 * runs in, so a sender's script could have switched tracking off for every
 * other sender's links — or, worse, switched it back ON after the recipient
 * had opted out. A mailed link did the same thing to anyone who clicked it.
 *
 * Routing is by the presence of both fields rather than by a sub-path so the
 * form can post back to the document's own address, which is the only address
 * the recipient has.
 */
async function handleOptOutSubmit(
  request: Request,
  slug: string,
  env: Env,
): Promise<Response | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const optout = form.get('optout');
  const token = form.get('token');
  if ((optout !== '1' && optout !== '0') || typeof token !== 'string') return null;

  if (!(await verifyOptOutToken(token, optout, slug, env.SESSION_SECRET))) {
    // Ask again with a fresh token rather than dead-ending: the common cause
    // is a confirmation page left open for more than ten minutes.
    return optOutConfirm(
      slug,
      optout,
      await issueOptOutToken(optout, slug, env.SESSION_SECRET),
      400,
    );
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: `/r/${slug}`,
      'Set-Cookie': optout === '1' ? OPT_OUT_COOKIE : OPT_OUT_CLEAR_COOKIE,
    },
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

/**
 * The report write.
 *
 * The reason is checked here as well as in the RPC so a mistyped menu value
 * comes back as a sentence on the form rather than as a silent nothing, and
 * the note is cut to the length the form advertises rather than refused —
 * somebody who typed six hundred characters about a fake login page should
 * not lose them to a validation message.
 *
 * The connecting address is hashed before it goes anywhere. It is the
 * rate-limit identity and nothing else; the raw address never leaves this
 * worker, and no part of the report identifies the reporter.
 *
 * NO CONFIRMATION TOKEN, unlike the opt-out POST a few functions down. That
 * one needs a token because the thing it writes is the recipient's own
 * setting across every sender's links, so a forged submission changes
 * something the recipient owns. A forged report changes nothing anybody
 * owns: it writes a row we read by hand, five an hour per address, and the
 * worst it can do is make us look at a document. A token would buy a page of
 * machinery for that.
 */
async function handleReportSubmit(request: Request, share: Share, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reportForm(share.slug, 'Something went wrong sending that. Please try again.');
  }

  const reason = form.get('reason');
  if (typeof reason !== 'string' || !REPORT_REASONS.some(([value]) => value === reason)) {
    return reportForm(share.slug, 'Please choose a reason.');
  }

  const rawNote = form.get('note');
  const note =
    typeof rawNote === 'string' ? rawNote.trim().slice(0, NOTE_MAX_LENGTH) || null : null;

  const ipHash = await hashReporterAddress(
    request.headers.get('CF-Connecting-IP') ?? '',
    env.SESSION_SECRET,
  );

  const verdict = await reportAbuse(env, { slug: share.slug, reason, note, ipHash });
  if (verdict === 'rate_limited') {
    return reportForm(
      share.slug,
      'That is several reports from here in the last hour. Try again a little later.',
    );
  }
  if (verdict !== 'ok') {
    return reportForm(share.slug, "That didn't send. Try again in a moment.");
  }
  return reportSent();
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
  host: HostKind,
  env: Env,
): Promise<Response> {
  const share = await getShareBySlug(env, slug);
  if (!share) return notFound();
  // The same stored-hostname check the document route makes. Without it this
  // route would be a way to reach a share from a host it was never created
  // for — which is exactly the gap the design says leaving the check on the
  // document route alone would leave.
  const wrongStoredHost = enforceStoredHost(host, share, new URL(request.url), request.method, env);
  if (wrongStoredHost) return wrongStoredHost;
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
