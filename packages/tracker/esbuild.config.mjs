import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'dist/tracker.js',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: !watch,
  sourcemap: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  // eslint-disable-next-line no-console
  console.log('tracker: watching…');
} else {
  await build(options);
}
