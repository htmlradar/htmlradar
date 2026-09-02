import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The OAuth library imports `cloudflare:workers`, a module that only exists
    // inside workerd. Inlining it brings it through Vite's resolver, where the
    // alias below can answer.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
  resolve: {
    alias: {
      // See tests/cloudflare-workers.stub.ts.
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/cloudflare-workers.stub.ts', import.meta.url),
      ),
    },
  },
});
