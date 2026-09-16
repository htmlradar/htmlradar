import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, expect, it } from 'vitest';
import pdfjs from 'pdfjs-dist/package.json';

const run = promisify(execFile);

beforeAll(async () => {
  await run(process.execPath, [
    fileURLToPath(new URL('../../scripts/copy-pdfjs.mjs', import.meta.url)),
  ]);
});

it.each(['pdf.mjs', 'pdf.worker.mjs'])(
  'ships %s with the compatibility features needed by Safari',
  async (file) => {
    const asset = new URL(`../../public/pdfjs/${pdfjs.version}/${file}`, import.meta.url);
    // Isolate each asset: the engine tests import legacy pdf.js, which patches
    // globals and would otherwise hide missing features in the shipped build.
    const result = await run(process.execPath, [
      '--input-type=module',
      '--eval',
      `delete globalThis.Iterator;
       delete Map.prototype.getOrInsertComputed;
       delete Promise.try;
       await import(${JSON.stringify(asset.href)});
       const assert = (await import('node:assert/strict')).default;
       assert.equal(typeof Iterator, 'function');
       assert.equal(new Map().getOrInsertComputed('key', () => 42), 42);
       assert.equal(await Promise.try(() => 42), 42);`,
    ]);
    expect(result.stderr).toBe('');
  },
);
