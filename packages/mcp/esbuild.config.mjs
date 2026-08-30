// One bundled file with a shebang, because `bin` has to be a single runnable script.

import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

const OUTFILE = 'dist/index.js';

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUTFILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  minify: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

await chmod(OUTFILE, 0o755);
