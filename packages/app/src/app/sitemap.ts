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

  const routes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/why`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/pricing`, changeFrequency: 'monthly', priority: 0.7 },
    // /sign-in and /feedback are utility pages, not search results.
    // Their page metadata sets noindex, so they are deliberately omitted.
    { url: `${baseUrl}/privacy`, changeFrequency: 'yearly', priority: 0.4 },
    {
      url: `${baseUrl}/compare/papermark`,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    { url: `${baseUrl}/compare/docsend`, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${baseUrl}/compare/docsend-vs-papermark`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/use-case/pitch-deck-tracking`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/use-case/proposal-tracking`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/use-case/track-html-deck`,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/for/claude-artifacts`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    { url: `${baseUrl}/for/reveal-js`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/self-hosted`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/blog`, changeFrequency: 'weekly', priority: 0.6 },
    {
      url: `${baseUrl}/blog/how-we-built-htmlradar`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  return routes;
}
