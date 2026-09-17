#!/usr/bin/env node
/* eslint-env node, browser */
/* eslint-disable no-console */
// Generate the hero image for the custom-domains announcement e-mail from
// scripts/custom-domains-hero.html into public/brand/email/.
//
// Same build-time-render reasoning as generate-onboarding-cards.mjs: an
// e-mail cannot run JavaScript or load a font it does not have, so the
// visual has to be a flat PNG on a URL that will still resolve in a year.
// Served from https://htmlradar.com/brand/email/custom-domains-announcement.png.
//
// Two files, because an e-mail needs both: the 1200x675 one the HTML points
// at, and a @2x for retina, referenced by width="560" in the markup.
//
// Run: `pnpm gen:cd-hero` (from packages/app).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dirname, 'custom-domains-hero.html');
const outputDir = resolve(__dirname, '..', 'public', 'brand', 'email');

const WIDTH = 1200;
const HEIGHT = 675;

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [scale, name] of [
      [1, 'custom-domains-announcement.png'],
      [2, 'custom-domains-announcement@2x.png'],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: scale,
      });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(templatePath).href, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
      await page.evaluate(() => document.fonts.ready);
      const out = resolve(outputDir, name);
      await page.locator('.card').screenshot({ path: out });
      console.log(`  ${name} (${WIDTH * scale}x${HEIGHT * scale})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
