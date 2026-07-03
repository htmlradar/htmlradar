// Shared per-page metadata builder. Next.js shallow-merges metadata
// per segment — a page-level `openGraph` replaces the layout's
// wholesale (images included), so every page override must carry the
// full OG/Twitter set or that page silently loses its share card.

import type { Metadata } from 'next';

const SITE_URL = 'https://htmlradar.com';

// public/og-card.png is 2400×1260 — exactly 2× the 1200×630 OG spec.
const OG_IMAGE = {
  url: '/og-card.png',
  width: 2400,
  height: 1260,
  alt: 'HTMLRadar — track who reads your HTML decks',
};

export function pageMeta(opts: { title: string; description: string; path: string }): Metadata {
  const { title, description, path } = opts;
  return {
    title: { absolute: title },
    description,
    // Canonical pins every page to the apex host — www.htmlradar.com
    // serves the same content and Search Console indexes both, splitting
    // ranking signal between two hosts without this.
    alternates: { canonical: `${SITE_URL}${path}` },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: 'HTMLRadar',
      url: `${SITE_URL}${path}`,
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}
