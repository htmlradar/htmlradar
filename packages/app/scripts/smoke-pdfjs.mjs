// Cheap deployed converter checks, with no browser download. Run: node scripts/smoke-pdfjs.mjs https://preview-host
/* eslint-env node */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
const page = await fetch(`${origin}/convert`);
assert.equal(page.status, 200, '/convert');
await page.body.cancel();
process.stdout.write(`Converter page and both JavaScript assets passed at ${origin}.\n`);
