// One-shot auth setup. Signs in qa-bot via Supabase password auth
// REST, then manually constructs the @supabase/ssr cookie and saves
// storageState to .auth/qa-bot.json. Subsequent Playwright runs load
// that storageState to authenticate as the QA bot.
//
// Implementation notes:
// - Uses raw fetch (avoids the supabase-js v2.105 realtime/WebSocket
//   crash on Node 20).
// - Uses password auth directly because magic-link with a custom
//   redirectTo lands on the implicit-flow hash URL when the host
//   isn't in the Supabase redirect allow-list, which means the app's
//   /auth/callback never runs and cookies never set.
// - @supabase/ssr v0.3 stores the session as a single JSON cookie
//   named `sb-{projectRef}-auth-token` (later versions chunk it; we
//   stay on v0.3 per packages/app/package.json).
//
// Run against prod (default):
//   pnpm exec playwright test e2e/auth-setup.spec.ts
//
// Run against local dev:
//   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
//     pnpm exec playwright test e2e/auth-setup.spec.ts

import { test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env.local') });

test('auth-setup: password sign-in, save storageState', async ({ context }) => {
  const SUPABASE_URL = need('NEXT_PUBLIC_SUPABASE_URL');
  const ANON_KEY = need('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const EMAIL = process.env['QA_BOT_EMAIL'] ?? 'qa-bot@htmlradar.com';
  const PASSWORD = need('QA_BOT_PASSWORD');
  const BASE = process.env['PLAYWRIGHT_BASE_URL'] ?? 'https://htmlradar.com';

  // Password sign-in via REST. Returns the same session shape that
  // @supabase/ssr writes to its cookie.
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Password sign-in failed: ${tokenRes.status} ${text}`);
  }
  const session = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
    token_type: string;
    user: unknown;
  };

  // Compute the cookie name. Supabase URL is like
  // https://ewennjnxuqjzsgawbzur.supabase.co → projectRef = first
  // hostname segment.
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;

  // @supabase/ssr v0.3 stores the session as a JSON string in one
  // cookie. v0.5+ would chunk + base64-prefix; deps say 0.3.0 so the
  // single-JSON shape applies.
  const cookieValue = JSON.stringify(session);

  // Set the cookie on the app domain. Playwright stores cookies via
  // context.addCookies, then storageState() persists them.
  const url = new URL(BASE);
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: url.hostname,
      path: '/',
      // Long expiry — storageState is regenerated per run anyway.
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      httpOnly: false,
      // Secure when over HTTPS; local dev uses http so secure=false.
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);

  // Save storageState.
  const outDir = path.resolve(__dirname, '.auth');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'qa-bot.json');
  await context.storageState({ path: outPath });

  // Validate by hitting /docs — should NOT redirect to /sign-in.
  const page = await context.newPage();
  const docsRes = await page.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
  const finalUrl = page.url();
  if (finalUrl.includes('/sign-in')) {
    throw new Error(
      `Auth cookie didn't authenticate — landed on ${finalUrl}. Cookie format may have changed.`,
    );
  }
  console.log(
    `storageState saved to ${outPath} | /docs status ${docsRes?.status()} | final URL ${finalUrl}`,
  );
});

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`auth-setup: missing env ${name}`);
  return v;
}
