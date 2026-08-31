// /compare/peony — Peony (peony.ink) ranks for sharing a Claude artifact.
// Every Peony cell below is a verbatim quote from peony.ink, read 30 Aug 2026.
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
  title: 'Peony Alternative for Tracked HTML Links (2026) | HTMLRadar',
  description:
    'HTMLRadar is a Peony alternative for tracked HTML links: section-level read tracking, open source, and free for two links.',
  path: '/compare/peony',
});

const ROWS: [string, string, string][] = [
  [
    'What it is',
    'A tracked link for one HTML file or URL',
    'Their homepage: “The virtual data room (VDR) for M&A, finance, commercial real estate (CRE), healthcare, biotech, pharma, and legal teams”',
  ],
  [
    'HTML handling',
    'Serves your HTML as a live page and adds the tracker when it is served',
    'Their HTML viewer page: “Peony renders .html and .htm files natively in the viewer — with JavaScript executing”',
  ],
  [
    'Reading detail',
    'Which sections or slides were read, active time, and scroll depth inside the HTML',
    'Their features list: “Page Analytics — See exactly who opened the artifact, when, and how long they engaged with it.”',
  ],
  [
    'Controls on the link',
    'Optional email gate, password, expiry, allow-list, and revocation',
    'Their HTML viewer page: “per-viewer watermark, screenshot protection, NDA gate, granular permissions, analytics, and instant revoke”',
  ],
  [
    'Price, checked 30 August 2026',
    'Free for 2 tracked links, then $15 a month or $150 a year',
    'Their pricing page: “Free — $0/admin/month”, “Business — $30/admin/month”, “Data Room — $52/admin/month”, “Deal Team — $64/admin/month”',
  ],
  [
    'Licence and self-hosting',
    'Open source under AGPL-3.0; self-hostable on Cloudflare and Supabase',
    'Not stated on their site',
  ],
];

const FAQ = [
  {
    q: 'Should I use Peony or HTMLRadar for a Claude artifact?',
    a: 'Use Peony if the artifact is going into a deal and needs the controls their site describes: per-viewer watermarks, screenshot protection, an NDA gate, and granular permissions. Use HTMLRadar if what you need is one tracked link per recipient and a record of which sections of the HTML they actually read.',
  },
  {
    q: 'Do both products keep the HTML interactive?',
    a: 'Peony states on its HTML viewer page that it renders .html and .htm files natively in the viewer with JavaScript executing. HTMLRadar serves your HTML as the page you uploaded and adds its tracker when the page is served.',
  },
  {
    q: 'Is HTMLRadar open source?',
    a: 'Yes. HTMLRadar is AGPL-3.0 end to end: the tracker, the proxy worker, the schema, and the web app are on GitHub, and you can run the whole thing in your own Cloudflare and Supabase accounts. Peony does not state a licence or a self-hosting option on the pages we read.',
  },
];

export default function ComparePeonyPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs Peony', url: '/compare/peony' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Peony is a data room. HTMLRadar tracks one HTML file.
          </h1>
          <DirectAnswer updated="August 2026">
            Peony calls itself a virtual data room, and its site says it renders .html files
            natively with JavaScript executing, wrapped in watermarks, NDA gating and page-level
            analytics. HTMLRadar does one thing: a tracked link for one HTML file, with
            section-level read tracking, open source, free for two links. Need deal-grade control?
            Peony. Need to know which sections were read? HTMLRadar.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Peony is good at the thing it says it is good at. Its HTML viewer page makes a specific
            promise: your artifact keeps running. In its own words, the file is rendered natively in
            the viewer with JavaScript executing, and the control layer — watermark, NDA gate,
            permissions, revoke — is applied to that live render.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar is a smaller product with a narrower question. You upload an HTML file or
            paste a URL, you send a link per recipient, and afterwards you can see who opened it,
            which sections or slides they read, how long they were actually active, and how far they
            scrolled. That is the whole product.
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
                    <th className="px-5 py-3">Peony, in their own words</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map(([feature, htmlradar, peony]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{peony}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-graphite">
              Checked 30 August 2026 on peony.ink: the homepage, the pricing page, and the HTML and
              AI artifact viewer page. Every Peony cell is quoted from those pages. Where their site
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
                  Use Peony
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  The artifact is going to investors, bidders, or a board, and it needs the controls
                  their site describes around it: a per-viewer watermark, screenshot protection, an
                  NDA gate, granular per-file permissions, and a data room to sit in.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Use HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You are sending one HTML page to a handful of people and the question you care
                  about is which sections they read and for how long. You also want to read the
                  tracker source or run the whole thing yourself.
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
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                share a Claude artifact and see who opened it
              </Link>
              ,{' '}
              <Link href="/compare/stacktree" className="text-signal-dark hover:underline">
                HTMLRadar vs Stacktree
              </Link>
              ,{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                HTMLRadar vs DocSend
              </Link>
              , and{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
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
