import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const target = fileURLToPath(new URL(`../public/pdfjs/${version}/`, import.meta.url));
await rm(fileURLToPath(new URL('../public/pdfjs/', import.meta.url)), {
  recursive: true,
  force: true,
});
await mkdir(target, { recursive: true });
for (const asset of [
  'build/pdf.mjs',
  'build/pdf.worker.mjs',
  'cmaps',
  'standard_fonts',
  'wasm',
  'iccs',
  'LICENSE',
]) {
  await cp(join(source, asset), join(target, asset.replace('build/', '')), {
    recursive: true,
    // The converter never instantiates the PDF scripting sandbox.
    filter: (path) => !path.includes('quickjs-eval'),
  });
}
