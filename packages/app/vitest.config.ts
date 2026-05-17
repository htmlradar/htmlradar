import { defineConfig } from 'vitest/config';

// Vitest is for unit tests. Playwright owns e2e/** — those specs talk
// to prod over the network and need NEXT_PUBLIC_SUPABASE_URL set, which
// CI deliberately doesn't expose. Default vitest globbing was picking
// up `e2e/smoke.spec.ts` and failing CI on every push.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
