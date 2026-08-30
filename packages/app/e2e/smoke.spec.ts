// Pre-deploy smoke test — runs against prod: the application on
// https://htmlradar.com, recipient documents on https://htmlradar.page.
//
// What this catches (and why each assertion exists):
//
//   1. Cache-Control on error pages. The proxy's SHELL helper now
//      sets `private, no-store, max-age=0` on expired/revoked/404.
//      Without this, browsers + Cloudflare cache HTTP 410, and
//      extending an expiry on a share doesn't reach the recipient
//      (error-page cache-header regression).
//
//   2. Recipient flow on mobile. Visits /r/qa-smoke-deck in an
//      iPhone 14 Pro viewport. The deck loads, tracker boots,
//      IntersectionObserver observes sections. Asserts NO console
//      errors and the doc renders. Catches "wrong CDN bundle served"
//      and tracker-IIFE-breakage.
//
//   3. Section dwell + scroll depth invariants. Scrolls through 4
//      sections with dwell, then queries Supabase directly (service-
//      role) to assert the session + section_events rows reflect the
//      activity. Catches:
//        - 0% scroll depth on real mobile (viewer2's prod bug)
//        - Section dwell sum ≈ active time (the 33m-vs-5m bug)
//        - No meta-pattern section titles in DB rows
//
// The test deck (qa-smoke-deck) was provisioned in Supabase once and
// is owned by qa-bot@htmlradar.com. Each test run creates a fresh
// viewer + session via the recipient flow; the data assertions
// validate against those rows directly. Viewer rows from this test
// have email `smoke-viewer-<run-id>@example.com` so they're easy to
// identify and clean up.

import { test, expect } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env.local') });

const SUPABASE_URL = need('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_ROLE = need('SUPABASE_SERVICE_ROLE_KEY');
const TEST_SHARE_SLUG = process.env.QA_TEST_SHARE_SLUG ?? 'qa-smoke-deck';
const TEST_SHARE_ID = process.env.QA_TEST_SHARE_ID ?? '';
// Recipient documents are served from the content domain, not from the
// application domain the rest of this file's baseURL points at. Absolute on
// purpose: a relative /r/ would hit the legacy host and be redirected here,
// which tests the redirect rather than the document.
const SHARE_BASE = process.env.PLAYWRIGHT_SHARE_BASE ?? 'https://htmlradar.page';
const SHARE_URL = `${SHARE_BASE}/r/${TEST_SHARE_SLUG}`;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`smoke: missing env ${name}`);
  return v;
}

// Helpers for hitting Supabase REST as service-role. Used for the
// data-invariant assertions (read after recipient flow writes).
async function supabaseQuery(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
  });
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as unknown[];
}

// ──────────────────────────────────────────────────────────────────
// 1. Proxy error responses — Cache-Control no-store (cache-header regression)
// ──────────────────────────────────────────────────────────────────
test.describe('proxy error responses', () => {
  test('404 / not-found returns Cache-Control no-store', async ({ request }) => {
    const res = await request.get(`${SHARE_BASE}/r/this-share-definitely-does-not-exist-xyz`);
    expect(res.status()).toBe(404);
    const cc = res.headers()['cache-control'] ?? '';
    expect(cc, 'error pages must not be cached — see proxy/src/responses.ts SHELL').toMatch(
      /no-store/,
    );
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. Recipient flow on mobile — renders without console errors
// ──────────────────────────────────────────────────────────────────
test.describe('recipient flow @ mobile', () => {
  test('share renders, tracker boots, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(SHARE_URL);
    await page.waitForLoadState('networkidle');

    // Pass the email gate so we land on the actual doc.
    const gate = page.locator('input[name="email"]');
    if (await gate.isVisible().catch(() => false)) {
      await gate.fill(`smoke-render-${Date.now()}@example.com`);
      await page.locator('button[type="submit"]').click();
      await page.waitForLoadState('networkidle');
    }

    // Tracker exposed via window.HTMLRadar = bundle loaded + IIFE ran.
    const trackerVersion = await page.evaluate(() => {
      const r = (window as unknown as { HTMLRadar?: { version?: string; flush?: () => unknown } })
        .HTMLRadar;
      return r && typeof r.flush === 'function' ? (r.version ?? 'unversioned') : null;
    });
    expect(trackerVersion, 'tracker did not boot — recipients have no analytics').toBeTruthy();

    // Doc body actually rendered (proxy injection didn't break the doc).
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByText('Why we test')).toBeVisible();

    expect(errors, 'console errors during share view').toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. Scrolling produces session row + section dwell (data invariants)
// ──────────────────────────────────────────────────────────────────
test.describe('analytics invariants', () => {
  // One identity per test run so we can find OUR rows in the DB.
  const runId = randomUUID().slice(0, 8);
  const viewerEmail = `smoke-viewer-${runId}@example.com`;

  test('scrolling 4 sections produces a session with non-zero scroll + dwell', async ({ page }) => {
    test.skip(!TEST_SHARE_ID, 'QA_TEST_SHARE_ID not set in .env.local');

    await page.goto(SHARE_URL);
    await page.waitForLoadState('networkidle');

    // The smoke test share requires email so we get a deterministic
    // viewer.email value to assert against. Fill the gate.
    const emailGate = page.locator('input[name="email"]');
    await expect(
      emailGate,
      'email gate not shown — share require_email may have flipped',
    ).toBeVisible({ timeout: 10_000 });
    await emailGate.fill(viewerEmail);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');

    // Walk through 4 sections with realistic dwell so IO transitions
    // happen and minDwellMs threshold is crossed.
    const sections = page.locator('h2');
    const count = await sections.count();
    expect(count, 'test deck must have at least 4 h2 sections').toBeGreaterThanOrEqual(4);
    // Dwell 4s per section. Default minDwellMs is 3000ms — anything
    // below the threshold gets dropped at snapshot time and we'd see
    // an empty sections array in the flush payload.
    for (let i = 0; i < 4; i++) {
      await sections.nth(i).scrollIntoViewIfNeeded();
      await page.waitForTimeout(4000);
    }

    // Force a flush so the session row reflects our session in DB
    // before we query. Without this we'd race the heartbeat interval.
    await page.evaluate(async () => {
      const r = (window as unknown as { HTMLRadar?: { flush?: () => Promise<void> } }).HTMLRadar;
      if (r?.flush) await r.flush();
    });

    // Give Supabase a beat to write — the proxy flush returns before
    // the row is durable in Postgres.
    await page.waitForTimeout(1500);

    // Now query Supabase: find OUR viewer (by email), then the most
    // recent session for that viewer.
    const viewers = (await supabaseQuery(
      `viewers?share_id=eq.${TEST_SHARE_ID}&email=eq.${encodeURIComponent(viewerEmail)}&select=id,email,is_internal`,
    )) as Array<{ id: string; email: string; is_internal: boolean }>;

    expect(viewers.length, `no viewer row for ${viewerEmail} — tracker flush didn't write`).toBe(1);
    const viewer = viewers[0]!;

    // smoke-viewer-...@example.com isn't @htmlradar.com so it should
    // NOT auto-flag as internal. If it does, migration 012's predicate
    // got too aggressive.
    expect(viewer.is_internal, 'external email auto-flagged as internal').toBe(false);

    const sessions = (await supabaseQuery(
      `sessions?viewer_id=eq.${viewer.id}&select=id,active_time_seconds,max_scroll_depth&order=started_at.desc&limit=1`,
    )) as Array<{ id: string; active_time_seconds: number; max_scroll_depth: number }>;

    expect(sessions.length, 'no session row written').toBe(1);
    const session = sessions[0]!;

    // The four bugs we're guarding against:

    // (a) Active time recorded — confirms tracker heartbeat ran.
    expect(session.active_time_seconds, 'no active time recorded').toBeGreaterThan(5);

    // (b) Scroll depth > 0.2 — guards against viewer2's "0% scroll on
    // 26m session" bug. We scrolled through 4 sections of a ~5-section
    // deck, so depth should be at least ~50%.
    expect(
      session.max_scroll_depth,
      'scroll depth stayed at 0 — Lenis/momentum scroll regression?',
    ).toBeGreaterThan(0.2);

    // (c) Section events were captured.
    const events = (await supabaseQuery(
      `section_events?session_id=eq.${session.id}&select=section_id,section_title,time_seconds`,
    )) as Array<{ section_id: string; section_title: string; time_seconds: number }>;

    expect(events.length, 'no section_events captured').toBeGreaterThanOrEqual(2);

    // (d) No section title is a meta pattern — guards against the
    // sample deck "01 / 14" regression.
    const META =
      /^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$|^\s*\d{1,3}\s*$|^page\s+\d+|^slide\s+\d+\s+of\s+\d+/i;
    for (const ev of events) {
      expect(
        ev.section_title,
        `section title looks like a meta pattern: ${ev.section_title}`,
      ).not.toMatch(META);
    }

    // (e) Section dwell sum ≤ active time (data invariant). Guards
    // against the "33m active vs 5m dwell" UI confusion we hit in prod.
    const dwellSum = events.reduce((acc, e) => acc + (e.time_seconds ?? 0), 0);
    expect(
      dwellSum,
      `section dwell sum (${dwellSum}s) exceeds active time (${session.active_time_seconds}s) — credit bug?`,
    ).toBeLessThanOrEqual(session.active_time_seconds + 5); // 5s tolerance for clock skew
  });
});
