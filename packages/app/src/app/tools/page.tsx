// /tools index. The four free tools, one line each. Exists so "Tools" in
// the header and footer has a single target instead of pointing at one of
// the three tools and hoping the visitor finds the other two.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';
import { customDomainsPublished } from '@/lib/custom-domains';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Free Tools | HTMLRadar',
  description:
    'Free tools from HTMLRadar: turn an HTML file into a shareable link, share a Claude artifact as a link, save a Claude artifact as a PDF, or turn a PDF deck into a web page.',
  path: '/tools',
});

const TOOLS = [
  {
    href: '/tools/html-to-link',
    title: 'HTML file to link',
    description: 'Drop an HTML file, preview it, and get a link that shows who opened it.',
  },
  {
    href: '/tools/claude-artifact-to-link',
    title: 'Claude artifact to link',
    description: 'Share a Claude artifact as a link that works without a Claude account.',
  },
  {
    href: '/tools/claude-artifact-to-pdf',
    title: 'Claude artifact to PDF',
    description: 'Save a Claude artifact as a PDF you can attach or print.',
  },
  {
    href: '/convert',
    title: 'PDF deck to web page',
    description: 'Convert a PDF deck into an HTML web page, free in your browser.',
  },
];

export default function ToolsIndexPage() {
  // Not a free tool like the four above — a Pro feature — but it belongs on
  // this page for the same reason: one page a visitor can find it from, and
  // /tools already ranks for the free-tools intent nearby. Gated the same as
  // the pricing page and /custom-domains itself: off until the pilot's two
  // drills pass (see src/lib/custom-domains.ts).
  const tools = customDomainsPublished()
    ? [
        ...TOOLS,
        {
          href: '/custom-domains',
          title: 'Your own domain for tracked links',
          description:
            'Serve links from decks.yourcompany.com instead of htmlradar.page. Included in Pro.',
        },
      ]
    : TOOLS;
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Tools', url: '/tools' },
            ]}
          />
          <SectionMark>HTMLRadar · Free tools</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Free tools.
          </h1>
          <p className="mt-6 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
            No account needed to start. Each one runs in your browser until you ask for a tracked
            link.
          </p>

          <ul className="mt-16 divide-y divide-line">
            {tools.map((t) => (
              <li key={t.href} className="py-8 first:pt-0">
                <Link href={t.href} className="group block">
                  <h2 className="font-serif text-[28px] leading-snug text-ink transition group-hover:text-signal-dark md:text-[32px]">
                    {t.title}
                  </h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{t.description}</p>
                  <span className="link-slide mt-4 inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.16em] text-signal-dark">
                    Open →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
