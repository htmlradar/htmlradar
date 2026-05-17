import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pre-deploy smoke test harness. Runs against PROD by default
// (https://htmlradar.com) so it catches CDN / deploy / cache issues
// that mocked local tests can't see. Override with PLAYWRIGHT_BASE_URL
// if you want to point it at a preview deploy.
//
// Architecture:
//   - One project: Mobile Chromium with iPhone 14 Pro touch emulation.
//     90% of HTMLRadar recipients open links on mobile, and the bugs
//     we keep finding are mobile-specific (Lenis-style smooth scroll,
//     swipe decks, momentum scroll suppressing events).
//   - globalSetup mints a one-shot magic link for qa-bot@htmlradar.com
//     via the Supabase Admin API and consumes it in a Playwright
//     context, saving authenticated cookies to e2e/.auth/qa-bot.json.
//     Smoke tests reuse this storageState for the owner-dashboard half
//     of the run.
//
// Run with: pnpm qa:smoke (or `npx playwright test e2e/smoke.spec.ts`).

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://htmlradar.com';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  // We hit prod — don't hammer it. One worker keeps state predictable
  // (each test creates a session row; running parallel would mix
  // viewer rows in the dashboard assertion).
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  // No global setup in v1 — auth-required tests are deferred. All
  // assertions either don't need auth (proxy responses, recipient
  // flow) or query Supabase REST directly with service-role. When
  // the dashboard UI test gets added back, restore this line:
  //   globalSetup: path.resolve(__dirname, './e2e/setup.ts'),
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Useful when a test fails mid-flow — open trace.zip in
    // `npx playwright show-trace` to see exactly what the user saw.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // Use Pixel 7 (Chromium-based) instead of iPhone 14 Pro
      // (WebKit) — Chromium is what the vast majority of HTMLRadar
      // viewers run, and we need predictable touch-event behavior
      // without WebKit's additional install/cache. The viewport +
      // userAgent + hasTouch flag are still mobile.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
