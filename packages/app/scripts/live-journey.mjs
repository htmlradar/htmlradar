#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
// Daily live-journey check: walk a real user's path through production and
// fail loudly when it breaks.
//
// Why this exists: from 4 to 16 September 2026, every e-mail sign-in link
// landed the person on the page SIGNED OUT, and nothing noticed for twelve
// days. The five-minute monitor only asks whether pages return HTTP 200, and
// a sign-in that silently drops the session returns a perfectly healthy 200.
// The only check that would have caught it is one that actually signs in and
// actually opens a shared document, which is what this script does.
//
//   node packages/app/scripts/live-journey.mjs
//
// Runs daily from .github/workflows/live-journey.yml. Four steps:
//
//   sign-in     — mint a magic-link token with the Supabase admin API and walk
//                 it through /auth/callback exactly as the e-mail link does.
//   api         — create a tracked link, fetch it on the content domain, read
//                 its activity, then revoke it.
//   custom-host — the same journey on the account's own domain, when it has a
//                 live one. Skipped, not failed, when it has none.
//   cleanup     — delete yesterday's journey documents, so a daily check does
//                 not leave a year of clutter on a real account.
//
// JOURNEY_EMAIL is required and must be a PRO or COMPED account. A free
// account is capped at two tracked links for its lifetime by the
// enforce_share_cap trigger (schema/027_free_tier_share_cap.sql), revoked
// links included, so a free account would start failing on the third day
// with a 402 and the failure would say nothing about production.
//
// The e-mail TEMPLATE contract (`{{ .RedirectTo }}&token_hash={{ .TokenHash
// }}&type=email`) is verified separately, in the Supabase dashboard — an API
// cannot read the template back. This script verifies the other half: that
// the door the template points at still opens.

import { pathToFileURL } from 'node:url';

const REDIRECT_PATH = '/auth/callback?next=%2Fdocs';

/** Everything the run needs, read from the environment. */
export function config(source = process.env) {
  const trim = (value) => (value ?? '').replace(/\/+$/, '');
  return {
    baseUrl: trim(source.BASE_URL) || 'https://htmlradar.com',
    supabaseUrl: trim(source.SUPABASE_URL),
    serviceKey: source.SUPABASE_SERVICE_ROLE_KEY ?? '',
    apiKey: source.HTMLRADAR_API_KEY ?? '',
    resendKey: source.RESEND_API_KEY ?? '',
    alertTo: source.ALERT_TO || 'hello@htmlradar.com',
    journeyEmail: source.JOURNEY_EMAIL ?? '',
  };
}

/**
 * Step 1 — the sign-in contract.
 *
 * Mints a magic-link token through the Supabase admin API (which does NOT
 * send an e-mail) and presents it to /auth/callback the way the link in the
 * e-mail does. A pass means the callback redirected to /docs AND set a
 * Supabase session cookie. The September outage failed both halves: it
 * redirected to /docs with no cookie at all, or bounced to /sign-in.
 */
export async function signInStep(cfg) {
  const link = await fetch(`${cfg.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: cfg.journeyEmail,
      options: { redirect_to: `${cfg.baseUrl}${REDIRECT_PATH}` },
    }),
  });
  if (!link.ok) throw new Error(`generate_link returned ${link.status}: ${await link.text()}`);
  const token = (await link.json())?.hashed_token;
  if (!token) throw new Error('generate_link returned no hashed_token');

  const callback = await fetch(
    `${cfg.baseUrl}${REDIRECT_PATH}&token_hash=${encodeURIComponent(token)}&type=email`,
    { redirect: 'manual' },
  );
  const location = callback.headers.get('location') ?? '';
  const destination = location.startsWith('http') ? new URL(location).pathname : location;
  // getSetCookie keeps the cookies separate; the fallback is for stubbed
  // Headers in tests and any runtime that predates it.
  const cookies = (
    callback.headers.getSetCookie?.() ?? [callback.headers.get('set-cookie') ?? '']
  ).join(' ');

  if (callback.status < 300 || callback.status > 399) {
    throw new Error(`callback returned ${callback.status}, not a redirect`);
  }
  if (!destination.startsWith('/docs')) {
    throw new Error(
      `callback redirected to ${destination || '(nowhere)'}, not /docs — the token_hash door is broken`,
    );
  }
  if (!cookies.includes('sb-')) {
    throw new Error('callback redirected to /docs but set no sb- session cookie — signed OUT');
  }
  return `${callback.status} to ${destination}, sb- session cookie set`;
}

/**
 * Step 2 — the document journey, over the public HTTP API.
 *
 * Creates a tracked link, opens it on the content domain the way a recipient
 * does, reads the activity report, then revokes the link. There is no
 * document-delete route in the v1 API, so the tiny document stays on the
 * account; only the link is switched off.
 */
export async function apiStep(cfg, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const { title, html } = journeyDocument();

  // require_email: false — the gate would serve a form instead of the
  // document, and what this step is checking is that the document is served.
  const share = await api(cfg, 'POST', '/api/v1/shares', { html, title, require_email: false });
  const notes = [];
  try {
    const page = await fetch(share.url);
    const body = await page.text();
    if (page.status !== 200) throw new Error(`${share.url} returned ${page.status}`);
    if (!body.includes(title)) {
      throw new Error(`${share.url} returned 200 but not the document — title missing from body`);
    }
    notes.push(`${new URL(share.url).host} served the document`);

    await sleep(5000);
    const activity = await api(cfg, 'GET', `/api/v1/shares/${share.share_id}/activity`);
    notes.push(
      activity.opened
        ? 'open recorded in activity'
        : 'open NOT recorded, as expected: opens are counted by the browser tracker, which a plain fetch never runs — the 200 carrying the document body is the pass here',
    );
  } finally {
    try {
      await api(cfg, 'POST', `/api/v1/shares/${share.share_id}/revoke`, {});
      notes.push('link revoked (no document-delete route in v1, so the document stays)');
    } catch (error) {
      notes.push(`CLEANUP FAILED: ${error.message}`);
    }
  }
  return notes.join('; ');
}

/** The tiny document every step of the journey creates. */
function journeyDocument() {
  const title = `live-journey ${new Date().toISOString()}`;
  return {
    title,
    html:
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>` +
      `<h1>${title}</h1>` +
      `<section><h2>Why this document exists</h2><p>Automated daily check of the live journey.</p></section>` +
      `<section><h2>What it proves</h2><p>A link was created, served and revoked.</p></section>` +
      `</body></html>`,
  };
}

/** The journey account's own id, which the API never returns. */
async function journeyOwnerId(cfg) {
  const owners = await rest(
    cfg,
    'GET',
    `/profiles?email=eq.${encodeURIComponent(cfg.journeyEmail)}&select=id`,
  );
  const ownerId = owners[0]?.id;
  if (!ownerId) throw new Error(`no profiles row for ${cfg.journeyEmail}`);
  return ownerId;
}

/**
 * Step 3 — the same journey, on the customer's own hostname.
 *
 * A link on a customer domain (schema/052) is served by the same worker
 * through a different hostname, a different Cloudflare custom-hostname
 * certificate and a different SSL renewal clock. Every one of those can lapse
 * on its own while htmlradar.page keeps answering perfectly, so the api step
 * above proves nothing about them.
 *
 * It SKIPS rather than fails when the journey account has no live domain,
 * because that is the ordinary state of the feature before an internal
 * account is enrolled, and a step that goes red for being switched off is a
 * step the founder learns to ignore.
 */
export async function customHostStep(cfg) {
  const ownerId = await journeyOwnerId(cfg);
  const domains = await rest(
    cfg,
    'GET',
    `/custom_domains?owner_id=eq.${ownerId}&state=eq.live&select=id,hostname&limit=1`,
  );
  const domain = domains[0];
  if (!domain) return 'SKIP custom-host — no live domain on the journey account';

  const { title, html } = journeyDocument();
  const share = await api(cfg, 'POST', '/api/v1/shares', {
    html,
    title,
    require_email: false,
    domain_id: domain.id,
  });
  const notes = [];
  try {
    // The address is the assertion: a link created with a domain_id that came
    // back on htmlradar.page would be a link the recipient opens somewhere
    // the customer never agreed to, and it would fetch a healthy 200.
    const expected = `https://${domain.hostname}/`;
    if (!share.url.startsWith(expected)) {
      throw new Error(`share url is ${share.url}, not on ${domain.hostname}`);
    }
    const page = await fetch(share.url);
    const body = await page.text();
    if (page.status !== 200) throw new Error(`${share.url} returned ${page.status}`);
    if (!body.includes(title)) {
      throw new Error(`${share.url} returned 200 but not the document — title missing from body`);
    }
    notes.push(`${domain.hostname} served the document`);
  } finally {
    try {
      await api(cfg, 'POST', `/api/v1/shares/${share.share_id}/revoke`, {});
      notes.push('link revoked');
    } catch (error) {
      notes.push(`CLEANUP FAILED: ${error.message}`);
    }
  }
  return notes.join('; ');
}

/**
 * Step 4 — take yesterday's journey documents away.
 *
 * The v1 API has no delete route, so this goes at the database directly. It
 * is scoped three ways — the journey account's owner_id, a title that starts
 * with `live-journey `, and older than a day — because a service role key
 * pointed at `documents` with a loose filter is how you lose a customer's
 * work. Yesterday rather than now, so a run can never race its own document.
 *
 * Deleting the row is enough: every foreign key onto documents and its
 * children cascades — document_shares (schema/001), document_versions
 * (schema/018), attachments (schema/009), and through the shares to viewers,
 * sessions and section_events (schema/001, /003). The one thing it does NOT
 * remove is the HTML in R2, which the document row pointed at; these are a
 * few hundred bytes each and no API route deletes an object.
 *
 * Cleanup never fails the journey (see warnOnly below): a housekeeping error
 * is not production being broken, and waking the founder for it would teach
 * him to ignore the alert.
 */
export async function cleanupStep(cfg) {
  const ownerId = await journeyOwnerId(cfg);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const removed = await rest(
    cfg,
    'DELETE',
    `/documents?owner_id=eq.${ownerId}&title=like.live-journey%20*&created_at=lt.${cutoff}`,
  );
  return `removed ${removed.length} older journey documents`;
}

// Read by runJourney: a thrown error here is a WARN line, not a FAIL, and
// leaves the exit code alone.
cleanupStep.warnOnly = true;

// PostgREST, with the service role key. `return=representation` is what makes
// a DELETE answer with the rows it removed, which is the only way to count
// them.
async function rest(cfg, method, path) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      Prefer: 'return=representation',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function api(cfg, method, path, body) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Runs every step, times each one, and returns the report. */
export async function runJourney(
  cfg,
  steps = {
    'sign-in': signInStep,
    api: apiStep,
    'custom-host': customHostStep,
    cleanup: cleanupStep,
  },
) {
  const lines = [];
  let firstFailure = null;
  for (const [name, step] of Object.entries(steps)) {
    const started = Date.now();
    try {
      const detail = await step(cfg);
      // A step that had nothing to check says so itself and says why. No
      // timing, because nothing was timed.
      lines.push(
        String(detail).startsWith('SKIP ')
          ? detail
          : `PASS ${name} ${Date.now() - started}ms — ${detail}`,
      );
    } catch (error) {
      const level = step.warnOnly === true ? 'WARN' : 'FAIL';
      lines.push(`${level} ${name} ${Date.now() - started}ms — ${error.message}`);
      if (level === 'FAIL') firstFailure ??= name;
    }
  }
  return { report: lines.join('\n'), firstFailure };
}

async function alert(cfg, firstFailure, report) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.resendKey}`,
      'content-type': 'application/json',
      // Resend's WAF rejects default script user agents.
      'User-Agent': 'htmlradar-live-journey/1.0',
    },
    body: JSON.stringify({
      from: 'HTMLRadar <hello@htmlradar.com>',
      to: [cfg.alertTo],
      subject: `[HTMLRadar] live journey failed: ${firstFailure}`,
      text: report,
    }),
  });
  if (!res.ok) console.error(`alert e-mail failed: ${res.status} ${await res.text()}`);
}

// Only when run as a script, so the test can import the steps above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = config();
  if (!cfg.journeyEmail) {
    console.error(
      'JOURNEY_EMAIL is not set. Set it to the address of a Pro or comped account — a free ' +
        'account runs out of tracked links on the third day (schema/027_free_tier_share_cap.sql).',
    );
    process.exit(1);
  }
  // One retry of the whole journey: a single network blip at 03:17 UTC should
  // not put a red e-mail in the founder's inbox. A second failure is real.
  let { report, firstFailure } = await runJourney(cfg);
  if (firstFailure) ({ report, firstFailure } = await runJourney(cfg));
  console.log(report);
  if (firstFailure) {
    if (cfg.resendKey) await alert(cfg, firstFailure, report);
    process.exit(1);
  }
}
