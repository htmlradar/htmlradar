// /tools index. The three free tools, one line each. Exists so "Tools" in
// the header and footer has a single target instead of pointing at one of
// the three tools and hoping the visitor finds the other two.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Free Tools | HTMLRadar',
  description:
    'Free tools from HTMLRadar: turn an HTML file into a shareable link, share a Claude artifact as a link, or save a Claude artifact as a PDF.',
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
];

export default function ToolsIndexPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Tools', url: '/tools' },
            ]}
          />
          <SectionMark>HTMLRadar · Free tools</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[60px]">
            Free tools.
          </h1>
          <p className="mt-6 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
            No account needed to start. Each one runs in your browser until you ask for a tracked
            link.
          </p>

          <ul className="mt-16 divide-y divide-line">
            {TOOLS.map((t) => (
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

          <div className="mt-20 border-t border-line pt-10">
            <Link
              href="/"
              className="link-slide font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
