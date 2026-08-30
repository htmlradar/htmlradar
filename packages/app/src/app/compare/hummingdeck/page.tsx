// /compare/hummingdeck — HummingDeck shares decks with engagement analytics.
// Every HummingDeck cell below is a verbatim quote from hummingdeck.com, read 30 Aug 2026.
// Their pricing page renders a currency-dependent figure, so no monthly price is quoted.
// Competitor statements are quotes from their public pages, checked on the date shown.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'HummingDeck Alternative for Tracked HTML Links (2026) | HTMLRadar',
  description:
    'HummingDeck shares documents and branded rooms with per-page engagement analytics. HTMLRadar is a HummingDeck alternative for tracked HTML links with section-level read tracking, open source and free for two links.',
  path: '/compare/hummingdeck',
});

const ROWS: [string, string, string][] = [
  [
    'What it is',
    'A tracked link for one HTML file or URL',
    'Their homepage: “Send files or create whole branded rooms on your own domain, all behind one link. Track who opens them and which pages they read.”',
  ],
  [
    'HTML handling',
    'Serves your HTML as a live page and adds the tracker when it is served',
    'Their pricing FAQ: “Standalone HTML is available on every plan. Multi-file HTML ZIP bundles are available on Starter and above.”',
  ],
  [
    'Reading detail',
    'Which sections or slides were read, active time, and scroll depth inside the HTML',
    'Their homepage: “You get time per page, completion, return visits, and a separate read history for everyone who opens it.”',
  ],
  [
    'Controls on the link',
    'Optional email gate, password, expiry, allow-list, and revocation',
    'Their homepage: “Verified-email allowlists, expiring links, and per-recipient download control. Set it per share.”',
  ],
  [
    'Price, checked 30 August 2026',
    'Free for 2 tracked links, then $15 a month or $150 a year',
    'Their pricing page: “Just exploring? Start on the Free plan. 5 documents and 5 links, forever.” and “All plans include a 7-day free trial.” Their paid figure changes with the currency selector on that page, so no single monthly price is quoted here.',
  ],
  [
    'Licence and self-hosting',
    'Open source under AGPL-3.0; self-hostable on Cloudflare and Supabase',
    'Not stated on their site',
  ],
];

const FAQ = [
  {
    q: 'Should I use HummingDeck or HTMLRadar?',
    a: 'Use HummingDeck when you are running a sales or fundraising process across many formats: their site describes PDFs, PowerPoint, Word, Excel and Google files, branded deal rooms, bot filtering, and integrations with Slack, Close CRM and Zapier. Use HTMLRadar when the document is HTML and the question is which sections were read.',
  },
  {
    q: 'Does HummingDeck accept HTML?',
    a: 'Their pricing FAQ says standalone HTML is available on every plan and multi-file HTML ZIP bundles on Starter and above, and their homepage lists Interactive HTML among the file types it works with. If HTML is one of several formats you send, that breadth is worth reading about on their own pages before you choose.',
  },
  {
    q: 'What does section-level tracking mean in HTMLRadar?',
    a: 'HTMLRadar reads the headings and slides inside your HTML and uses them as labels, so the dashboard reports active reading time against the parts of the document you named. Knowing a recipient spent four minutes on the pricing section is a different signal from knowing they reached the bottom of the page.',
  },
];

export default function CompareHummingDeckPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs HummingDeck', url: '/compare/hummingdeck' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            HummingDeck reports pages. HTMLRadar reports sections.
          </h1>
          <DirectAnswer updated="August 2026">
            HummingDeck sends documents and branded rooms behind one link and reports, in its own
            words, time per page, completion and a read history for each recipient. HTMLRadar is
            HTML-only and reports reading against the headings and slides inside the file, is open
            source, and is free for two links. Need branded rooms behind one link? HummingDeck. Need
            an open-source tool for one HTML file? HTMLRadar.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HummingDeck is the broader product, and its own pages are specific about what that
            breadth buys you: PDFs, PowerPoint, Word, Excel and Google files behind one link,
            branded rooms on your own domain, a read history per recipient, and filtering of the
            security scanners that open links before a human does. If you are running a pipeline
            rather than sending one page, that matters.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar is deliberately narrow. One HTML file or one URL, a link per recipient, and
            reading reported against the headings and slides inside the document. It is also
            AGPL-3.0, so you can read the tracker or run the whole thing in your own Cloudflare and
            Supabase accounts.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Side by side
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Feature</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">HummingDeck, in their own words</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map(([feature, htmlradar, hummingdeck]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{hummingdeck}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-graphite">
              Checked 30 August 2026 on hummingdeck.com: the homepage and the pricing page,
              including its plan comparison and FAQ. Every HummingDeck cell is quoted from those
              pages. Where their site does not say something, the cell says so rather than guessing.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When to use each product
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  Use HummingDeck
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You send several file formats, want them grouped into a branded room on your own
                  domain, and want the engagement data flowing into Slack or Close CRM. Their
                  bot-filtering claim is worth reading if your links go through corporate mail
                  scanners.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Use HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  The document is already HTML and you want the reading reported against its own
                  headings and slides, with a link per recipient. You also want an open-source
                  licence you can audit and the option to self-host.
                </p>
              </div>
            </div>
          </section>

          <Faq items={FAQ} />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track an HTML file free
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 2 tracked links free. No credit card. AGPL-3.0 source on{' '}
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
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                HTMLRadar vs DocSend
              </Link>
              ,{' '}
              <Link href="/compare/peony" className="text-signal-dark hover:underline">
                HTMLRadar vs Peony
              </Link>
              ,{' '}
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking for founders
              </Link>
              , and{' '}
              <Link href="/use-case/proposal-tracking" className="text-signal-dark hover:underline">
                proposal tracking
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
