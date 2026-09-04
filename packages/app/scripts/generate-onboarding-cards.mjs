#!/usr/bin/env node
/* eslint-env node, browser */
/* eslint-disable no-console */
// Generate the five images used by the onboarding e-mail (schema/048)
// from scripts/onboarding-email-cards.html into public/brand/email/.
//
// Same build-time-render reasoning as generate-og-card.mjs: an e-mail
// cannot run JavaScript or load a font it does not have, so every visual
// has to be a flat PNG on a URL that will still resolve in a year. These
// are served from https://htmlradar.com/brand/email/<id>.png.
//
// Each element with class="card" is clipped at its own bounding box at
// deviceScaleFactor 2, so a 528x320 card lands as a 1056x640 PNG that the
// e-mail displays at 264x160 — retina-sharp on a phone, half-size in the
// HTML so it never overflows the 600px shell.
//
// Run: `pnpm gen:email-cards` (from packages/app).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dirname, 'onboarding-email-cards.html');
const outputDir = resolve(__dirname, '..', 'public', 'brand', 'email');

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1300, height: 1200 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(templatePath).href, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);

    const cards = page.locator('.card');
    const count = await cards.count();
    if (count === 0) throw new Error('no .card elements found in the template');

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const id = await card.getAttribute('id');
      if (!id) throw new Error(`card ${i} has no id; it names the output file`);
      const out = resolve(outputDir, `${id}.png`);
      await card.screenshot({ path: out });
      console.log(`  ${id}.png`);
    }
    console.log(`${count} onboarding e-mail cards written -> ${outputDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
