// Next.js route handler that emits robots.txt. Allows everything except
// the authenticated app routes and the proxy share routes (which are
// short-lived URLs we don't want indexed). Points crawlers at the
// sitemap for the canonical list of indexable pages.

import type { MetadataRoute } from 'next';

// See sitemap.ts for why we hardcode rather than read NEXT_PUBLIC_APP_URL.
const SITE_URL = 'https://htmlradar.com';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = SITE_URL;

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/r/', // proxy share URLs — viewer-specific, not indexable
          '/auth/', // OAuth callback
          '/docs', // authenticated user document library
          '/dashboard',
          '/new',
          '/settings',
          '/upgrade',
          '/admin', // founder-only, auth-gated — defense in depth
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
