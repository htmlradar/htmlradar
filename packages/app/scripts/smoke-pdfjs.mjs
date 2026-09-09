// Deployed converter smoke check. Uses a generated, non-sensitive deck and
// stops before upload. Run: node scripts/smoke-pdfjs.mjs https://preview-host
/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { version } = require('pdfjs-dist/package.json');
const origin = new URL(process.argv[2]).origin;
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
  const response = await fetch(`${origin}/pdfjs/${version}/${file}`);
  assert.equal(response.status, 200, file);
  assert.match(
    response.headers.get('content-type') ?? '',
    /(?:application|text)\/javascript/,
    file,
  );
  await response.body.cancel();
}
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const title of ['Converter smoke test', 'Second slide for testing']) {
  pdf.addPage([720, 450]).drawText(title, { x: 40, y: 380, size: 24, font });
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto(`${origin}/convert`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file]').setInputFiles({
    name: 'smoke.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByText('Your HTML file is ready.', { exact: true }).waitFor({ timeout: 60_000 });
  assert.ok(workers.some((url) => url === `${origin}/pdfjs/${version}/pdf.worker.mjs`));
  assert.equal(await page.locator('figure img').count(), 1);
  assert.equal(await page.locator('[aria-label="Sample read report"] tbody tr').count(), 2);
  process.stdout.write(
    `Converter assets, worker startup and two-slide conversion passed at ${origin}.\n`,
  );
} finally {
  await browser.close();
}
