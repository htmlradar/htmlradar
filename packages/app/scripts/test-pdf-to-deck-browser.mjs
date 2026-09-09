// Browser integration check used locally and in CI; no external PDF fixture.
/* eslint-env browser, node */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const trackerRequire = createRequire(join(app, '../tracker/package.json'));
const { build } = trackerRequire('esbuild');
const { version } = require('pdfjs-dist/package.json');
const temporary = await mkdtemp(join(tmpdir(), 'htmlradar-pdf-smoke-'));
const bundle = join(temporary, 'converter.mjs');
await build({
  entryPoints: [join(app, 'src/lib/pdf-to-deck.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 4; i++) {
  const page = source.addPage([720, 450]);
  page.drawRectangle({ x: 0, y: 0, width: 720, height: 450, color: rgb(0.95, 0.95, 1) });
  if (i > 0)
    page.drawText(`Company overview and next steps ${i}`, { x: 40, y: 370, font, size: 28 });
}
const bytes = [...(await source.save())];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body></body></html>');
    return;
  }
  let file;
  if (path === '/converter.mjs') file = bundle;
  else if (path.startsWith(`/pdfjs/${version}/`)) file = resolve(app, 'public', `.${path}`);
  if (!file) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    response.setHeader(
      'Content-Type',
      file.endsWith('.mjs') || file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PDF_BROWSER_EXECUTABLE,
  });
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  const workerUrls = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const result = await page.evaluate(async (bytes) => {
    const { convertPdfToDeck } = await import('/converter.mjs');
    const progress = [];
    let previews = 0;
    const start = performance.now();
    const deck = await convertPdfToDeck(
      new File([new Uint8Array(bytes)], 'Smoke deck.pdf', { type: 'application/pdf' }),
      {
        onProgress: (event) => progress.push(event),
        onPreview: () => previews++,
      },
    );
    return {
      html: await deck.html.text(),
      bytes: deck.bytes,
      types: deck.slides.map((slide) => slide.image.type),
      titles: deck.slides.map((slide) => slide.title),
      dimensions: deck.slides.map(({ width, height }) => [width, height]),
      progress,
      previews,
      elapsedMs: performance.now() - start,
    };
  }, bytes);
  assert.equal(result.titles.length, 4);
  assert.equal(result.titles[0], 'Slide 1: Untitled');
  assert.equal(result.titles[1], 'Slide 2: Company overview and next steps 1');
  assert.equal(result.titles[3], 'Slide 4: Company overview and next steps 3');
  assert.equal(result.previews, 1);
  assert.deepEqual(result.dimensions, [
    [1600, 1000],
    [1600, 1000],
    [1600, 1000],
    [1600, 1000],
  ]);
  assert.equal(result.bytes, Buffer.byteLength(result.html));
  assert.ok(workerUrls.some((url) => url.endsWith(`/pdfjs/${version}/pdf.worker.mjs`)));
  assert.ok(requests.every((url) => url.startsWith(origin)));
  const offline = await browser.newContext({ offline: true });
  const output = await offline.newPage();
  await output.setContent(result.html);
  await output.locator('img').last().scrollIntoViewIfNeeded();
  await output.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth === 1600),
  );
  assert.equal(await output.locator('section.slide').count(), 4);
  assert.equal(await output.locator('script,iframe,link').count(), 0);
  assert.equal(await output.locator('body > details:not([open]) + main').count(), 1);
  assert.equal(await output.locator('details a[href^="#slide-"]').count(), 3);
  assert.equal(await output.locator('details a[href="#slide-1"]').count(), 0);
  for (const width of [390, 1280]) {
    await output.setViewportSize({ width, height: 800 });
    await output.locator('summary').click();
    assert.equal(await output.locator('details[open]').count(), 1);
    assert.ok(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await output.locator('a[href="#slide-3"]').click();
    assert.equal(await output.evaluate(() => location.hash), '#slide-3');
    await output.locator('summary').click();
    assert.equal(await output.locator('details[open]').count(), 0);
  }
  const boxes = await output.locator('section.slide').evaluateAll((sections) =>
    sections.map((section) => {
      const heading = section.querySelector('h2').getBoundingClientRect();
      const parent = section.getBoundingClientRect();
      return { width: heading.width, height: heading.height, atTop: heading.top === parent.top };
    }),
  );
  assert.ok(boxes.every((box) => box.width === 1 && box.height === 1 && box.atTop));
  assert.deepEqual(errors, []);
  const summary = { ...result };
  delete summary.html;
  process.stdout.write(
    JSON.stringify(
      { browser: browser.version(), ...summary, workerUrls, requests, errors },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
