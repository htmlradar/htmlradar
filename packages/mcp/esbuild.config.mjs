// One bundled file with a shebang, because `bin` has to be a single runnable
// script and Claude Code plugins may not reference files outside the plugin
// directory (see plugins/htmlradar/README.md) — so the same bundle is copied
// there and kept in sync by this build.

import { copyFile, chmod, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const OUTFILE = 'dist/index.js';
const PLUGIN_COPY = '../../plugins/htmlradar/server/index.js';

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUTFILE,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

await chmod(OUTFILE, 0o755);
await mkdir(new URL('../../plugins/htmlradar/server/', import.meta.url), { recursive: true });
await copyFile(OUTFILE, PLUGIN_COPY);
await chmod(PLUGIN_COPY, 0o755);
