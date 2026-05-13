// Next.js route handler that emits sitemap.xml. Lists every public,
// indexable route. The proxy `/r/{slug}` routes are intentionally
// excluded — each is a private share, not search content.

import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://htmlradar.com';
  const lastModified = new Date();

  const routes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/why`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    {
      url: `${baseUrl}/compare/papermark`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  return routes;
}
