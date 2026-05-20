#!/usr/bin/env node
/* eslint-env node, browser */
/* eslint-disable no-console */
// Generate packages/app/public/og-card.png from scripts/og-card.html.
//
// Why this lives as a build-time render instead of a /og-card route:
//   - The OG card is static by privacy design (no per-share content),
//     so a request-time route adds runtime risk for zero functional
//     benefit. WhatsApp / iMessage / Slack just see a plain .png.
//   - @vercel/og on Cloudflare Pages depends on edge-WASM
//     (yoga-wasm-web + Satori). When it works it's great; when it
//     doesn't, link unfurls break silently across every share. A
//     static asset has zero runtime surprises.
//   - Future copy / visual edits = edit og-card.html, run `pnpm gen:og`,
//     commit the new PNG. Same single-source-of-truth as a dynamic
//     route, no edge runtime in the loop.
//
// Run: `pnpm gen:og` (from packages/app) or `node scripts/generate-og-card.mjs`
//
// Requirements: Playwright + a Chromium binary. The smoke test suite
// already depends on Playwright so the binary is normally cached; if
// you see "Executable doesn't exist" run `pnpm exec playwright install
// chromium` once and retry.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
// `@playwright/test` re-exports the browser launchers — we don't have
// the bare `playwright` package installed, only the test runner.
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dirname, 'og-card.html');
const outputPath = resolve(__dirname, '..', 'public', 'og-card.png');

const WIDTH = 1200;
const HEIGHT = 630;

async function main() {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      // 2x deviceScaleFactor gives us a retina-sharp PNG for
      // platforms that upscale (iMessage, Slack desktop). The output
      // PNG ends up ~2400×1260 pixel-wise but presents as 1200×630.
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();

    // Track network idleness so we only screenshot after Google Fonts
    // CSS *and* WOFF2 binaries have landed. file:// is fine — the
    // template references absolute https URLs for fonts.
    await page.goto(pathToFileURL(templatePath).href, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Belt-and-braces: also wait on document.fonts.ready. Network-idle
    // can fire one tick before font-face install actually completes on
    // some Chromium builds.
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({
      path: outputPath,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      omitBackground: false,
    });

    console.log(`OG card written → ${outputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
