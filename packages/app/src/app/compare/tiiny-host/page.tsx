// /compare/tiiny-host — Tiiny.host hosts a static HTML file from an upload.
// Every Tiiny.host cell below is a verbatim quote from tiiny.host, read 30 Aug 2026.
// Competitor statements are quotes from their public pages, checked on the date shown.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Tiiny.host Alternative for Tracked HTML Links | HTMLRadar',
  description:
    'HTMLRadar is a Tiiny.host alternative for tracked HTML links: section-level read tracking, open source, and free for two links.',
  path: '/compare/tiiny-host',
});

const ROWS: [string, string, string][] = [
  [
    'What it is',
    'A tracked link for one HTML file or URL',
    'Their Host HTML File page: “Tiiny Host is the simplest and easiest way to host your HTML page. Simply drag & drop your static HTML file to publish it in seconds.”',
  ],
  [
    'How the link is made',
    'Upload an HTML file or paste a URL, then create a separate link for each recipient',
    'Their Host HTML File page: “Enter a subdomain for your hosted HTML file” and “Click launch & share your unique link!”',
  ],
  [
    'Who can open it',
    'Optional email gate, password, expiry, allow-list, and revocation',
    'Their FAQ: “Yes, all content you upload is publicly available on your link. If you prefer to keep it private, we recommend adding a password to your link through one of our subscription plans.”',
  ],
  [
    'Reading detail',
    'Which sections or slides were read, active time, and scroll depth inside the HTML',
    'Their pricing block lists “Built-in analytics” from the Tiny plan; what its built-in analytics report is not stated on their site.',
  ],
  [
    'Price, checked 30 August 2026',
    'Free for 2 tracked links, then $15 a month or $150 a year',
    'Their pricing block, yearly billing: “Tiny — $ 5 / month (USD), Billed $60 /year”, “Solo — $ 13 / month (USD), Billed $156 /year”, “Pro — $ 31 / month (USD), Billed $372 /year”, “Pro Max — $ 74 / month (USD), Billed $888 /year”',
  ],
  [
    'Licence and self-hosting',
    'Open source under AGPL-3.0; self-hostable on Cloudflare and Supabase',
    'Not stated on their site',
  ],
];

const FAQ = [
  {
    q: 'Should I use Tiiny.host or HTMLRadar?',
    a: 'Use Tiiny.host when the job is publishing: their site describes dragging a static HTML file in, entering a subdomain, and getting a link in seconds, across HTML, ZIP, PHP, PDF and many other formats. Use HTMLRadar when the job is measurement: one link per recipient and a record of which sections of the page were read.',
  },
  {
    q: 'Can I use both together?',
    a: 'Yes. HTMLRadar accepts a public URL as well as an uploaded file, so a page you already publish elsewhere can be tracked without moving it.',
  },
  {
    q: 'What does HTMLRadar report that a plain host link does not?',
    a: 'Who opened the link, which sections or slides they read, how long they were actively reading, and how far they scrolled, with a separate link per recipient so the reading is attributable. You also get an email alert on the first open, and an optional email gate, password, expiry, allow-list, or revocation.',
  },
];

export default function CompareTiinyHostPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs Tiiny.host', url: '/compare/tiiny-host' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Tiiny.host hosts the file. HTMLRadar tracks who reads it.
          </h1>
          <DirectAnswer updated="August 2026">
            Tiiny.host calls itself the simplest way to host and share your work online: drag an
            HTML file in and it publishes to a subdomain, with built-in analytics from its Tiny
            plan. HTMLRadar is a tracked link for one HTML file: section-level read tracking,
            per-recipient links, open source, free for two links. Want the simplest way to publish?
            Tiiny.host. Want to know which sections each recipient read? HTMLRadar.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Tiiny.host is very good at the thing it advertises. Their own page says you drag and
            drop a static HTML file, pick a subdomain, and share the link in seconds, and their FAQ
            lists HTML, ZIP, PHP, PDF and most common image, document, PowerPoint and Excel formats.
            If what you need is a URL for a file, that is a two-minute job there.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar answers a different question. You upload the HTML file, or paste a URL you
            already host, and send a separate link to each recipient. Afterwards you can see who
            opened it, which sections or slides they read, how long they were actively reading, and
            how far down they got.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Side by side
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Feature</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">Tiiny.host, in their own words</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map(([feature, htmlradar, tiiny]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{tiiny}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-graphite">
              Checked 30 August 2026 on tiiny.host: the homepage, including its pricing block and
              FAQ, and the Host HTML File page. Every Tiiny.host cell is quoted from those pages.
              Where their site does not say something, the cell says so rather than guessing.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When to use each product
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  Use Tiiny.host
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You want a page on the web with no build step: a prototype, something you are
                  testing, a ZIP of a static site. One drag, one subdomain, done.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Use HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  The page is going to specific people and you need to know what happened after you
                  sent it: who opened it, which sections held them, and how long they stayed. Add an
                  email gate, password, or expiry when the page is not for everyone.
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
              <Link href="/compare/stacktree" className="text-signal-dark hover:underline">
                HTMLRadar vs Stacktree
              </Link>
              ,{' '}
              <Link href="/compare/hummingdeck" className="text-signal-dark hover:underline">
                HTMLRadar vs HummingDeck
              </Link>
              ,{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track an HTML deck
              </Link>
              , and{' '}
              <Link href="/for/reveal-js" className="text-signal-dark hover:underline">
                reveal.js deck analytics
              </Link>
              .
            </p>
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
