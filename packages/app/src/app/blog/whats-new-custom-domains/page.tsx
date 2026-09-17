// Blog post #5 — the short "what's new" note for custom domains. Under 250
// words on purpose: the full explanation lives at /custom-domains, and the
// announcement e-mail this links back to is the longer version of the same
// three steps.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

const TITLE = 'Tracked links, now on your own domain';
const PATH = '/blog/whats-new-custom-domains';
const PUBLISHED = '2026-09-17';

export const metadata = pageMeta({
  title: 'Custom Domains for Tracked Links | HTMLRadar',
  description:
    'Pro accounts can now serve tracked links from their own subdomain instead of htmlradar.page. One CNAME record, three steps, nothing else changes.',
  path: PATH,
});

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <ArticleLd headline={TITLE} datePublished={PUBLISHED} url={PATH} />
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              { name: TITLE, url: PATH },
            ]}
          />
          <SectionMark>HTMLRadar · What&rsquo;s new</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[52px]">
            {TITLE}
          </h1>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            {PUBLISHED} &nbsp;·&nbsp; 2 min read &nbsp;·&nbsp; Product
          </p>

          <div className="mt-12 space-y-8 text-[16.5px] leading-[1.7] text-ink-soft">
            <p>
              Pro accounts can now serve tracked links from their own subdomain instead of
              htmlradar.page. A customer asked for this last week: he wanted the link he sent to
              read as his company&rsquo;s, not ours.
            </p>

            <figure>
              <img
                src="/brand/email/custom-domains-announcement.png"
                srcSet="/brand/email/custom-domains-announcement.png 1x, /brand/email/custom-domains-announcement@2x.png 2x"
                width={1200}
                height={675}
                loading="eager"
                alt="Settings showing decks.acme.com go from Waiting for DNS to Live, then a tracked link opened on that domain with its read report"
                className="w-full max-w-full rounded-xl border border-line"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
            </figure>

            <p>
              Setting it up is three steps: type the subdomain you want in Settings, add the one
              CNAME record we show you, and wait a few minutes — it turns Live on its own. From then
              on, every new link goes out on it.
            </p>

            <p>
              Tracking, gates and read reports work exactly as before, and links you have already
              sent keep working exactly where they are. It is included in Pro at $15 a month or $150
              a year — nothing about the price changes.
            </p>

            <p>
              The full walkthrough and FAQ are on the{' '}
              <Link href="/custom-domains" className="text-signal-dark hover:underline">
                custom domains page
              </Link>
              .
            </p>

            <p>
              Cheers,
              <br />
              Abhinandan
            </p>
          </div>

          <div className="mt-20 border-t border-line pt-10">
            <Link
              href="/blog"
              className="link-slide font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to the blog
            </Link>
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
