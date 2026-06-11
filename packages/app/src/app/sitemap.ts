// Next.js route handler that emits sitemap.xml. Lists every public,
// indexable route. The proxy `/r/{slug}` routes are intentionally
// excluded — each is a private share, not search content.

import type { MetadataRoute } from 'next';

// Hardcoded canonical URL. NEXT_PUBLIC_APP_URL used to be the source,
// but Next.js inlines NEXT_PUBLIC_* at build time, and `.env.local`
// sets it to localhost:3000 for dev — which then got baked into the
// production bundle. Google Search Console picked up the localhost
// URLs and the site was effectively un-indexable. Hardcoding here
// means dev sitemaps technically have prod URLs, which is harmless
// (nobody fetches dev sitemaps).
const SITE_URL = 'https://htmlradar.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;
  const lastModified = new Date();

  const routes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/why`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/pricing`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/feedback`, lastModified, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/sign-in`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    {
      url: `${baseUrl}/compare/papermark`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    { url: `${baseUrl}/compare/docsend`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/compare/pitch`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    {
      url: `${baseUrl}/use-case/pitch-deck-tracking`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/use-case/track-html-deck`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    { url: `${baseUrl}/self-hosted`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/blog`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${baseUrl}/blog/how-we-built-htmlradar`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  return routes;
}
