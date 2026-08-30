// /compare/stacktree — Stacktree (stacktr.ee) publishes HTML as a private link.
// Every Stacktree cell below is a verbatim quote from stacktr.ee, read 30 Aug 2026.
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
  title: 'Stacktree Alternative for Tracked HTML Links (2026) | HTMLRadar',
  description:
    'Stacktree and HTMLRadar both track how an HTML page is read. HTMLRadar is open source, self-hostable, $15 a month, and free for two links that do not expire; Stacktree is $19 a month on Solo with client portals and custom domains.',
  path: '/compare/stacktree',
});

const ROWS: [string, string, string][] = [
  [
    'What it is',
    'A tracked link for one HTML file or URL',
    'Their homepage: “Turn reports, decks, audits and proposals into private pages on your own domain.”',
  ],
  [
    'Getting the HTML in',
    'Upload an HTML file or paste a URL you already host',
    'Their developer page: “Add the MCP server and your agent publishes to a private link. No build, no DNS.”',
  ],
  [
    'Reading detail',
    'Which sections or slides were read, active time, and scroll depth inside the HTML',
    'Their homepage: “Know when it was opened, how long they stayed, and which sections held them.”',
  ],
  [
    'Controls on the link',
    'Optional email gate, password, expiry, allow-list, and revocation',
    'Their homepage: “Unguessable links and passcodes as standard, on every plan. From $19 a month, add a verified-email gate or your own domain in seconds.” and “Set an expiry so access ends with the engagement, or revoke it outright.”',
  ],
  [
    'Price, checked 30 August 2026',
    'Free for 2 tracked links, then $15 a month or $150 a year',
    'Their pricing block: “Free — $0 no card — 3 pages in total … Pages come down after 7 days … Carries a Stacktree footer”, “Solo — $19 /month”, “Studio — $79 /month”, “Firm — $249 /month”',
  ],
  [
    'Licence and self-hosting',
    'Open source under AGPL-3.0; self-hostable on Cloudflare and Supabase',
    'Stacktree’s developer page describes a source-available option; an open-source licence is not named on the pages we read.',
  ],
];

const FAQ = [
  {
    q: 'Should I use Stacktree or HTMLRadar?',
    a: 'Use Stacktree when the deliverable needs to live somewhere: their site describes private pages on your own domain, one address per client where the work collects, and publishing straight from an agent through their MCP server. Use HTMLRadar when you are sending one HTML file to named people and the question is which sections they read.',
  },
  {
    q: 'Both products mention sections. Are they measuring the same thing?',
    a: 'Stacktree describes its analytics as knowing when a page was opened, how long people stayed, and which sections held them. HTMLRadar reports section-level dwell inside the HTML too, alongside active time and scroll depth, and gives each recipient their own link so the reading is attributable per person. Read both descriptions before choosing.',
  },
  {
    q: 'Can I self-host either one?',
    a: 'HTMLRadar is AGPL-3.0 on GitHub and runs in your own Cloudflare and Supabase accounts, with a self-hosting guide in the repository. Stacktree links a page describing running the whole stack yourself as source-available, and lists running in your own cloud under its Enterprise plan. Check their current terms directly.',
  },
];

export default function CompareStacktreePage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs Stacktree', url: '/compare/stacktree' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Stacktree and HTMLRadar both track HTML. Here is the difference.
          </h1>
          <DirectAnswer updated="August 2026">
            Both track reading: Stacktree&apos;s site says it shows which sections held a reader,
            and HTMLRadar reports the same. HTMLRadar is open source, self-hostable, and free for
            two links that do not expire; Stacktree&apos;s free plan caps at 3 pages that come down
            after 7 days. Want client portals on your own domain? Stacktree. Want open source and
            two free links that do not expire? HTMLRadar.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Stacktree&apos;s site describes one address per client where everything collects, a
            single passcode that covers the whole address, your own domain and branding on the page,
            and an MCP server so an agent can publish without a build step or DNS. If your problem
            is that the work keeps arriving as attachments, that is a real answer to it.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar does not try to be a place your work lives. It is a tracked link for one HTML
            file or one URL, sent per recipient, with the reading reported back section by section.
            If you already have somewhere to put the page, this is the measurement layer.
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
                    <th className="px-5 py-3">Stacktree, in their own words</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map(([feature, htmlradar, stacktree]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{stacktree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-graphite">
              Checked 30 August 2026 on stacktr.ee: the homepage, including its pricing block, and
              the developer page. Every Stacktree cell is quoted from those pages. Where their site
              does not say something, the cell says so rather than guessing.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When to use each product
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  Use Stacktree
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You want a client portal on your own custom domain, with one passcode covering the
                  whole address and an MCP server so your agent can publish directly. That starts at
                  $19 a month on Solo; their free plan tops out at 3 pages that expire after 7 days
                  and carry a Stacktree footer.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Use HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You are sending one HTML file, whether uploaded or a URL you already host, to
                  named people and want section-level reading reported back per recipient. The free
                  tier is two tracked links that do not expire, then $15 a month or $150 a year, and
                  the source is open under AGPL-3.0 so you can self-host it.
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
              <Link href="/compare/peony" className="text-signal-dark hover:underline">
                HTMLRadar vs Peony
              </Link>
              ,{' '}
              <Link href="/compare/tiiny-host" className="text-signal-dark hover:underline">
                HTMLRadar vs Tiiny.host
              </Link>
              ,{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track an HTML deck
              </Link>
              , and{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
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
