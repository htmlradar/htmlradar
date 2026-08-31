// JSON-LD structured data, server-rendered. Values must stay
// consistent with the real entity: sameAs below lists only profiles
// that are actually live and public (no X/LinkedIn/Bluesky — links
// that 404 weaken entity resolution), and aggregateRating stays out
// until there are real public reviews; fabricated schema is a policy
// risk.

const SITE_URL = 'https://htmlradar.com';
const GITHUB_URL = 'https://github.com/htmlradar/htmlradar';
const SAME_AS = [
  GITHUB_URL,
  'https://www.npmjs.com/package/htmlradar-mcp',
  'https://glama.ai/mcp/servers/htmlradar/htmlradar',
  'https://www.crunchbase.com/organization/htmlradar',
  'https://www.trustpilot.com/review/htmlradar.com',
  'https://stackshare.io/htmlradar',
];

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

// Site-wide, rendered once in the root layout.
export function OrganizationLd() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'HTMLRadar',
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        description: 'Open-source read tracking for HTML decks, briefs, and proposals.',
        foundingDate: '2026',
        sameAs: SAME_AS,
      }}
    />
  );
}

// Homepage only.
export function SoftwareApplicationLd() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'HTMLRadar',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description:
          'Track who reads your HTML decks, briefs, and proposals with section-level dwell analytics. Open-source, AGPL-3.0.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      }}
    />
  );
}

export interface FaqItem {
  q: string;
  a: string;
}

export function FaqLd({ items }: { items: FaqItem[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      }}
    />
  );
}

export function BreadcrumbLd({ items }: { items: Array<{ name: string; url: string }> }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.name,
          item: `${SITE_URL}${it.url}`,
        })),
      }}
    />
  );
}

// Blog posts. Author is the Organization, not a Person — there is no
// public author identity to link yet.
export function ArticleLd(props: {
  headline: string;
  datePublished: string;
  dateModified?: string;
  url: string;
}) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: props.headline,
        datePublished: props.datePublished,
        dateModified: props.dateModified ?? props.datePublished,
        url: `${SITE_URL}${props.url}`,
        author: { '@type': 'Organization', name: 'HTMLRadar', url: SITE_URL },
        publisher: {
          '@type': 'Organization',
          name: 'HTMLRadar',
          logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.svg` },
        },
      }}
    />
  );
}
