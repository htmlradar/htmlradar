// Next.js route handler that emits robots.txt. Allows everything except
// the authenticated app routes and the proxy share routes (which are
// short-lived URLs we don't want indexed). Points crawlers at the
// sitemap for the canonical list of indexable pages.

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://htmlradar.com';

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
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
