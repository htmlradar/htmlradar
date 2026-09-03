// JSON-LD structured data, server-rendered. Values must stay
// consistent with the real entity: sameAs below lists only profiles
// that are actually live and public (no X/LinkedIn/Bluesky — links
// that 404 weaken entity resolution), and aggregateRating stays out
// until there are real public reviews; fabricated schema is a policy
// risk.

const SITE_URL = 'https://htmlradar.com';
const GITHUB_URL = 'https://github.com/htmlradar/htmlradar';
// Trustpilot was removed on 4 Sep 2026: Sol's review found the listing's
// categories and country wrong, and a directory entry that misdescribes us is
// negative entity evidence, not positive. It goes back only once corrected.
//
// Standing rule from the same review: an HTTP 200 from a directory proves a
// page answered, not that it carries a correct HTMLRadar listing. Check the
// rendered entry before adding or keeping any URL below.
const SAME_AS = [
  GITHUB_URL,
  'https://www.npmjs.com/package/htmlradar-mcp',
  'https://glama.ai/mcp/servers/htmlradar/htmlradar',
  // Smithery went genuinely live with the seven-tool 0.2.0 republish on
  // 31 Aug and was the one presence missing from this list (recorded as an
  // open follow-up in SEO-PLAN-DECISION-2026-08-31.md). Verified 200 on
  // 4 Sep 2026. The Model Context Protocol registry lists us as
  // com.htmlradar/share but publishes no per-server human page, so there is
  // no honest URL to add for it here.
  'https://smithery.ai/servers/htmlradar/share',
  'https://www.crunchbase.com/organization/htmlradar',
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
        description:
          'HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link, and seeing who opened it, which sections they read, and for how long.',
        email: 'hello@htmlradar.com',
        // First commit, 13 May 2026.
        foundingDate: '2026-05-13',
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
        url: SITE_URL,
        description:
          'HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link, and seeing who opened it, which sections they read, and for how long.',
        license: 'https://spdx.org/licenses/AGPL-3.0-or-later.html',
        // The free tier is real (two tracked links), so a 0-price Offer is
        // honest. Paid plans are named too rather than hidden behind it.
        offers: [
          {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
            name: 'Free',
            description: 'Two tracked links. Not an unlimited free tier.',
          },
          { '@type': 'Offer', price: '15', priceCurrency: 'USD', name: 'Pro — monthly' },
          { '@type': 'Offer', price: '150', priceCurrency: 'USD', name: 'Pro — yearly' },
        ],
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
