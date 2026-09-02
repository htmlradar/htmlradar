import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest is for unit tests. Playwright owns e2e/** — those specs talk
// to prod over the network and need NEXT_PUBLIC_SUPABASE_URL set, which
// CI deliberately doesn't expose. Default vitest globbing was picking
// up `e2e/smoke.spec.ts` and failing CI on every push.
export default defineConfig({
  // The `@/` alias tsconfig gives the app, so route files can be tested.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // tsconfig says "preserve", because Next compiles the JSX itself. A test
  // that calls a server component and looks at what it returned needs the JSX
  // actually compiled, and the automatic runtime needs no React import.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
