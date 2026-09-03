// /about — the entity page. Not a marketing page: it exists so a human
// or an answer engine asking "what is HTMLRadar, who makes it, under what
// licence, where does the code live" gets one page of checkable facts
// instead of inferring them from landing copy.
//
// Every fact below is verifiable from a public source and each is linked
// to it. Nothing aspirational goes on this page.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'About HTMLRadar — What It Is and Who Builds It',
  description:
    'HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link. Licence, source, package, and contact, in one place.',
  path: '/about',
});

const LINK = 'text-signal-dark hover:underline';

// "What it is" is deliberately absent: the DirectAnswer directly above this
// list already carries the canonical sentence verbatim, and repeating it two
// inches lower is padding, not clarity.
const FACTS: { k: string; v: React.ReactNode }[] = [
  {
    k: 'Who builds it',
    v: (
      <>
        The HTMLRadar team. Reach us at{' '}
        <a href="mailto:hello@htmlradar.com" className={LINK}>
          hello@htmlradar.com
        </a>
        , or open an issue on GitHub.
      </>
    ),
  },
  {
    k: 'Since',
    v: 'The first commit landed on 13 May 2026. The hosted service has run since then.',
  },
  {
    k: 'Licence',
    v: (
      <>
        AGPL-3.0-or-later, for the tracker, the proxy worker, the database schema, and the web app.
        A{' '}
        <a
          href="https://github.com/htmlradar/htmlradar/blob/main/COMMERCIAL-LICENSE.md"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          commercial licence
        </a>{' '}
        exists for anyone who cannot accept the AGPL&apos;s terms.
      </>
    ),
  },
  {
    k: 'Source code',
    v: (
      <>
        <a
          href="https://github.com/htmlradar/htmlradar"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          github.com/htmlradar/htmlradar
        </a>{' '}
        — the whole product, including the parts that run the hosted service.
      </>
    ),
  },
  {
    k: 'Package',
    v: (
      <>
        The MCP server is published on npm as{' '}
        <a
          href="https://www.npmjs.com/package/htmlradar-mcp"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          htmlradar-mcp
        </a>
        , and listed in the Model Context Protocol registry as{' '}
        <code className="font-mono text-[13.5px]">com.htmlradar/share</code>. A remote connector
        runs at <code className="font-mono text-[13.5px]">mcp.htmlradar.com/mcp</code>. See{' '}
        <Link href="/mcp" className={LINK}>
          /mcp
        </Link>
        .
      </>
    ),
  },
  {
    k: 'Where documents are served',
    v: (
      <>
        Tracked links are served from a second domain,{' '}
        <code className="font-mono text-[13.5px]">htmlradar.page</code>, so a recipient&apos;s
        browsing of a shared document never shares cookies with the marketing site or the dashboard.
        Recipient documents are never indexed. The reasoning is in the{' '}
        <Link href="/privacy" className={LINK}>
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    k: 'How it runs',
    v: (
      <>
        Cloudflare Pages, Workers and R2 for serving and storage; Supabase for the database and
        sign-in. The same stack self-hosts in your own accounts — see{' '}
        <Link href="/self-hosted" className={LINK}>
          /self-hosted
        </Link>
        .
      </>
    ),
  },
  {
    k: 'What it costs',
    v: (
      <>
        Free for two tracked links, then $15 a month or $150 a year for unlimited links.
        Self-hosting is free and always will be.{' '}
        <Link href="/pricing" className={LINK}>
          Full pricing
        </Link>
        .
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'About', url: '/about' },
            ]}
          />
          <SectionMark>HTMLRadar · About</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            About HTMLRadar.
          </h1>
          <DirectAnswer updated="September 2026">
            HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a
            tracked link, and seeing who opened it, which sections they read, and for how long. It
            is AGPL-3.0, built by the HTMLRadar team, and the whole thing runs on your own
            Cloudflare and Supabase accounts if you would rather host it yourself.
          </DirectAnswer>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The facts, in one place
            </h2>
            <dl className="mt-6 space-y-6">
              {FACTS.map(({ k, v }) => (
                <div key={k} className="border-l-2 border-line pl-5">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                    {k}
                  </dt>
                  <dd className="mt-1.5 break-words text-[16px] leading-relaxed text-ink-soft">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why it exists
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The documents that matter stopped being PDFs. A spec, a report, a design mock, a deck
              — more of them are HTML now, because that is what an LLM hands you. But the tools for
              sending a document and learning whether it was read were all built around uploading a
              file, so an HTML document goes out as an attachment or a bare link and then goes
              silent. HTMLRadar is the missing half of that: send the link, and get back who opened
              it and which sections held them.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The longer version is on{' '}
              <Link href="/why" className={LINK}>
                the why page
              </Link>
              , and the engineering is written up on{' '}
              <Link href="/blog" className={LINK}>
                the blog
              </Link>
              .
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Corrections
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              If anything on this site is wrong — a claim about a competitor, a number, a licence
              term — tell us at{' '}
              <a href="mailto:hello@htmlradar.com" className={LINK}>
                hello@htmlradar.com
              </a>{' '}
              and we will correct it and say what changed. Comparison pages name our own product as
              ours wherever a comparison is made.
            </p>
          </section>
        </article>
        <V2Footer />
      </main>
    </>
  );
}
