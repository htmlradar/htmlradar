#!/usr/bin/env node
/* eslint-env node, browser */
/* eslint-disable no-console */
// Render the onboarding e-mail (schema/048_onboarding_email.sql) to PNG at
// desktop 600px and mobile 375px, so a copy or layout change can be looked
// at before it is sent to anyone.
//
// The HTML is NOT duplicated here. It is read out of the migration, which
// is the thing that actually sends, between its two $html$ markers — one
// copy of the e-mail exists and it is the one in the send path.
//
// Image sources are rewritten from https://htmlradar.com/brand/email/... to
// the local public/ files, so the preview is honest about layout even
// before the PNGs are deployed.
//
// Run: `pnpm gen:email-preview` (from packages/app). Writes into
// ../../docs is NOT possible from the repo (docs/ lives outside git), so
// output goes to public/../.preview by default; pass an output directory to
// put it somewhere else:
//   node scripts/render-onboarding-email.mjs /path/to/out

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(__dirname, '..', '..', '..', 'schema', '048_onboarding_email.sql');
const publicDir = resolve(__dirname, '..', 'public');
const outDir = resolve(process.argv[2] || resolve(__dirname, '..', '.email-preview'));

const WIDTHS = [
  { name: 'onboarding-email-desktop-600.png', width: 600 },
  { name: 'onboarding-email-mobile-375.png', width: 375 },
];

function extractHtml(sql) {
  const parts = sql.split('$html$');
  if (parts.length < 3) throw new Error('could not find the $html$ block in the migration');
  return parts[1];
}

async function main() {
  const sql = await readFile(migrationPath, 'utf8');
  const html = extractHtml(sql).replaceAll(
    'https://htmlradar.com/brand/email/',
    `${pathToFileURL(publicDir).href}/brand/email/`,
  );

  await mkdir(outDir, { recursive: true });
  const scratchHtml = resolve(outDir, 'onboarding-email.html');
  await writeFile(scratchHtml, html, 'utf8');

  const browser = await chromium.launch();
  try {
    for (const { name, width } of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(scratchHtml).href, { waitUntil: 'networkidle' });
      await page.screenshot({ path: resolve(outDir, name), fullPage: true });
      await ctx.close();
      console.log(`  ${name} (${width}px)`);
    }
  } finally {
    await browser.close();
  }
  console.log(`previews written -> ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
