// /blog index. Lists posts in reverse chronological. Each post is a
// hand-written TSX page under /blog/[slug]/; no MDX, no CMS. Simple.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'HTML Document Tracking: Audits and Build Notes | HTMLRadar',
  description:
    "What HTMLRadar's blog covers: recipient-side audits of seven deck-sharing tools, how the read tracking is built, and what the reading data actually shows.",
  path: '/blog',
});

interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingTime: string;
}

const POSTS: Post[] = [
  {
    slug: 'share-html-from-claude-code',
    title: 'Share an HTML page from Claude Code, then ask who read it',
    description:
      'Add the HTMLRadar MCP server to Claude Code in one line, publish the HTML your agent wrote as a tracked link, then ask which sections the reader stayed on.',
    date: '2026-08-31',
    readingTime: '8 min',
  },
  {
    slug: 'why-i-built-read-tracking-for-html',
    title: 'Decks moved to HTML. I built the read tracking for it.',
    description:
      'Decks and proposals are HTML now, so I built the read tracking: time per section, active reading time, scroll depth. No session replay. Open source, AGPL-3.0.',
    date: '2026-08-30',
    readingTime: '4 min',
  },
  {
    slug: 'how-we-built-htmlradar',
    title: 'How I built HTMLRadar',
    description:
      'How HTMLRadar is built: a Next.js app, two Cloudflare Workers, an 8 KB browser tracker, and a Supabase schema. What each part owns and why.',
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
            Recipient-side audits of the tools we compete with, the 8 KB tracker explained, and what
            the reading data on real sends actually came back as.
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
