// /blog index. Lists posts in reverse chronological. Each post is a
// hand-written TSX page under /blog/[slug]/; no MDX, no CMS. Simple.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';

export const runtime = 'edge';

export const metadata = {
  title: 'Blog',
  description: 'Engineering, design, and product writing from the HTMLRadar team.',
  alternates: { canonical: 'https://htmlradar.com/blog' },
};

interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingTime: string;
}

const POSTS: Post[] = [
  {
    slug: 'how-we-built-htmlradar',
    title: 'How I built HTMLRadar in three packages',
    description:
      'The shape of HTMLRadar: a Next.js app, a Cloudflare Worker, a 14 KB browser tracker, six SQL files. What each part owns and the calls behind them.',
    date: '2026-05-14',
    readingTime: '5 min',
  },
];

export default function BlogIndex() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <SectionMark>HTMLRadar · Blog</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[60px]">
            Notes from the build.
          </h1>
          <p className="mt-6 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
            Architecture choices, product reasoning, lessons from running a small open-source SaaS.
          </p>

          <ul className="mt-16 divide-y divide-line">
            {POSTS.map((p) => (
              <li key={p.slug} className="py-8 first:pt-0">
                <Link href={`/blog/${p.slug}`} className="group block">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                    {p.date} · {p.readingTime}
                  </p>
                  <h2 className="mt-3 font-serif text-[28px] leading-snug text-ink transition group-hover:text-signal-dark md:text-[32px]">
                    {p.title}
                  </h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{p.description}</p>
                  <span className="link-slide mt-4 inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.16em] text-signal-dark">
                    Read →
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
