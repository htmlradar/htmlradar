import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sitemap from './sitemap';

// Public routes that are deliberately excluded from the sitemap because
// their own page metadata sets `robots: { index: false }`, or (for /admin)
// because the route is auth-gated and disallowed in robots.ts. Keep this
// in sync with the "deliberately omitted" comments in sitemap.ts.
const NOINDEX_ROUTES = new Set(['/sign-in', '/feedback', '/connect']);

function pageFileToRoute(file: string): string {
  // "src/app/compare/docsend/page.tsx" -> "/compare/docsend"; "src/app/page.tsx" -> "/"
  const trimmed = file.replace(/^src\/app\//, '').replace(/(^|\/)page\.tsx$/, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

describe('sitemap coverage', () => {
  it('has a sitemap entry for every tracked, public page.tsx', () => {
    // Cheapest durable guard against a shipped page.tsx that never gets
    // crawled (TECHNICAL-SEO-AUDIT-2026-08-31.md, P2-5). Uses `git
    // ls-files`, not a filesystem glob, so an untracked, in-progress page
    // from another lane's uncommitted work never trips this test.
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const tracked = execSync('git ls-files "src/app/**/page.tsx" "src/app/page.tsx"', {
      cwd: appRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const publicRoutes = tracked
      .filter((file) => !file.startsWith('src/app/(app)/')) // authenticated app, not search content
      .map(pageFileToRoute)
      .filter((route) => !NOINDEX_ROUTES.has(route) && !route.startsWith('/admin'));

    const sitemapPaths = new Set(
      sitemap().map((entry) => {
        const pathname = new URL(String(entry.url)).pathname;
        return pathname === '/' ? '/' : pathname.replace(/\/$/, '');
      }),
    );

    for (const route of publicRoutes) {
      expect(sitemapPaths, `sitemap.ts is missing an entry for ${route}`).toContain(route);
    }
  });
});
