// /compare/docsend — SEO target "DocSend alternative" (~5K/mo).
// Honest feature + pricing comparison. AGPL angle as differentiator.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';
import { Check, X } from 'lucide-react';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Open-Source DocSend Alternative for HTML | HTMLRadar',
  description:
    'Looking for a DocSend alternative? HTMLRadar tracks HTML decks and proposals with section-level read analytics. Open-source, self-hostable, free to start.',
  path: '/compare/docsend',
});

interface Row {
  feature: string;
  htmlradar: string | boolean;
  docsend: string | boolean;
  note?: string;
}

const ROWS: Row[] = [
  {
    feature: 'Source format',
    htmlradar: 'HTML files or public URLs',
    docsend: 'PDF, presentations, documents, media, and spreadsheets',
  },
  { feature: 'Open source', htmlradar: 'AGPL-3.0', docsend: false },
  {
    feature: 'Deployment',
    htmlradar: 'Own Cloudflare and Supabase accounts',
    docsend: 'Hosted service',
  },
  {
    feature: 'Reading analysis',
    htmlradar: 'Section-level dwell',
    docsend: 'Page-based analytics',
  },
  { feature: 'License audit', htmlradar: 'Read the tracker source', docsend: false },
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-signal-dark">
        <Check className="size-4" aria-hidden /> Yes
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-graphite">
        <X className="size-4" aria-hidden /> No
      </span>
    );
  }
  return <span className="text-ink">{v}</span>;
}

export default function ComparePage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs DocSend', url: '/compare/docsend' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            The open-source DocSend alternative built for HTML.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            DocSend is an established document-tracking product, and it supports PDFs,
            presentations, documents, media, and spreadsheets. HTMLRadar is different on purpose: it
            tracks HTML files and URLs, and it is open source and self-hostable. If you send HTML
            decks, that difference matters. If you do not, DocSend may be the better fit.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The headline difference
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  HTMLRadar
                </h3>
                <p className="mt-3 font-serif text-[20px] leading-snug text-ink">
                  HTML-first, open source, $15/mo or $150/yr flat.
                </p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
                  Track HTML decks from Claude, ChatGPT, v0, reveal.js, or hand-rolled HTML.
                  Self-host the whole thing or use the hosted plan. AGPLv3.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  DocSend
                </h3>
                <p className="mt-3 font-serif text-[20px] leading-snug text-ink">
                  Multi-format document tracking.
                </p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
                  A hosted product for PDFs, presentations, documents, media, and spreadsheets. It
                  does not list HTML among its accepted upload formats.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Where the products differ
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Feature</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">DocSend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map((r) => (
                    <tr key={r.feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{r.feature}</td>
                      <td className="px-5 py-3.5 align-top">
                        <Cell v={r.htmlradar} />
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <Cell v={r.docsend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When DocSend is the right choice
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                You send PDFs, presentations, office documents, media, or spreadsheets rather than
                HTML.
              </li>
              <li>You need a mature hosted product built around broader document sharing.</li>
              <li>
                You prefer not to think about open source licensing or self-hosting at all. Fair.
              </li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When HTMLRadar is the right choice
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                You send HTML decks (Claude artifacts, reveal.js builds, hand-rolled pages) and want
                to keep them as HTML when you track them.
              </li>
              <li>
                You want to read the tracker code or run the product in your own Cloudflare and
                Supabase accounts.
              </li>
              <li>
                You want section-level dwell time, not just scroll depth. Knowing the recipient
                spent 4 minutes on the Ask slide is materially different from knowing they scrolled
                to 80%.
              </li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Migrating from DocSend
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              HTMLRadar does not import existing DocSend files. For new HTML decks, bring a Claude
              artifact, reveal.js build, or hand-written page; upload it to HTMLRadar; and create
              per-recipient share links. The workflow stays in HTML from start to finish.
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
              If you need help with the cutover, email{' '}
              <a
                href="mailto:hello@htmlradar.com"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                hello@htmlradar.com
              </a>{' '}
              and we'll walk through it. Free.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Is HTMLRadar a free DocSend alternative?',
                a: 'The hosted free tier covers 2 tracked links with full section-level analytics. Past that it is $15/mo flat, or $150/yr if you pay annually — or self-host the AGPL-3.0 source for free on your own infrastructure.',
              },
              {
                q: 'Does HTMLRadar track PDFs like DocSend does?',
                a: 'HTMLRadar is HTML-first. PDFs, spreadsheets, and ZIPs ride along as attachments under the same tracked link, with every download logged per recipient — but section-level dwell tracking is for HTML documents.',
              },
              {
                q: 'Can I self-host HTMLRadar?',
                a: 'Yes. The full source is AGPL-3.0 on GitHub and runs in your own Cloudflare and Supabase accounts. The repository includes a self-hosting guide with the required setup steps.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Try HTMLRadar free
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 2 tracked links free. No credit card. AGPLv3 source on{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                GitHub
              </a>
              .
            </p>
          </section>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/compare/papermark" className="text-signal-dark hover:underline">
                HTMLRadar vs Papermark
              </Link>
              ,{' '}
              <Link
                href="/compare/docsend-vs-papermark"
                className="text-signal-dark hover:underline"
              >
                DocSend vs Papermark compared
              </Link>
              ,{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
              </Link>
              , and{' '}
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking for founders
              </Link>
              .
            </p>
            <Link
              href="/"
              className="link-slide mt-6 inline-block font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
