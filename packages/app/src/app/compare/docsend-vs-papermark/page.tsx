// /compare/docsend-vs-papermark — third-party comparison play. People
// choosing between the two incumbents search "docsend vs papermark";
// neither incumbent will write a fair version of this page. We can —
// and mention where the HTML-native option fits at the end.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'DocSend vs Papermark — an Honest Comparison | HTMLRadar',
  description:
    'Choosing between DocSend and Papermark for document tracking? How they differ on licensing, self-hosting, pricing model, and analytics — from a third open-source project.',
  path: '/compare/docsend-vs-papermark',
});

export default function DocsendVsPapermarkPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'DocSend vs Papermark', url: '/compare/docsend-vs-papermark' },
            ]}
          />
          <SectionMark>HTMLRadar · Comparison</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            DocSend vs Papermark, judged fairly.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            We build a third document tracker, so read this with that in mind — but it also means
            we&apos;ve studied both of these products closely and don&apos;t need to flatter either.
            Here&apos;s how they actually differ, and how to pick.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The short version
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              <strong className="text-ink">DocSend</strong> (acquired by Dropbox in 2021) is the
              incumbent: proprietary, per-seat pricing, deeply established with VCs and sales teams,
              built around uploading files — overwhelmingly PDFs — and tracking who viewed them,
              with e-signature and data-room features attached.
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
              <strong className="text-ink">Papermark</strong> is the open-source challenger:
              AGPL-3.0, self-hostable, same core file-upload-and-track model, with data rooms and
              custom domains, at a lower price point than DocSend. If your requirement is
              &ldquo;DocSend, but open source and cheaper,&rdquo; Papermark is the obvious pick.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How to choose
            </h2>
            <ul className="mt-4 list-disc space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                <strong className="text-ink">Pick DocSend</strong> if you need the enterprise
                surface: e-signatures, mature data rooms, an org that already standardized on it, or
                investors who expect docsend.com links. You pay per seat for that maturity.
              </li>
              <li>
                <strong className="text-ink">Pick Papermark</strong> if you want DocSend&apos;s
                model without the lock-in — open source you can audit or self-host, flat pricing,
                data rooms included. The trade is a younger product with a smaller team.
              </li>
              <li>
                <strong className="text-ink">Neither fits</strong> if your documents aren&apos;t
                files anymore. Both products are built around uploading a file and tracking that
                file. If your decks, briefs, and proposals are HTML pages — written with Claude or
                ChatGPT, built in reveal.js, shipped as living documents — flattening them to PDF so
                a file-tracker can handle them throws away exactly what made them good.
              </li>
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Where HTMLRadar fits
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              HTMLRadar is what Papermark is to DocSend, aimed at HTML instead of PDF: AGPL-3.0 open
              source, self-hostable, $15/mo flat hosted. You upload an HTML file (or paste a URL),
              send a tracked link, and get section-level dwell analytics — which parts got read, not
              just whether the file was opened. If your documents are still PDFs, use Papermark; if
              they&apos;ve moved to HTML,{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                that&apos;s the case we built for
              </Link>
              .
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Is Papermark really open source?',
                a: 'Yes — AGPL-3.0, same license HTMLRadar uses. Both codebases are public and self-hostable; both companies sell hosting so you don’t have to run it yourself.',
              },
              {
                q: 'Does DocSend track HTML documents?',
                a: 'DocSend is built around uploaded files — PDFs, decks, and similar formats — viewed inside its viewer. Tracking a live HTML page as itself is the gap HTML-native tools exist to fill.',
              },
              {
                q: 'What does section-level tracking add over page-level?',
                a: 'Page-level tells you the document was opened and how long it stayed open. Section-level tells you which parts held attention — pricing read twice, case studies skipped — which is what actually times your follow-up.',
              },
            ]}
          />

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                HTMLRadar vs DocSend
              </Link>
              ,{' '}
              <Link href="/compare/papermark" className="text-signal-dark hover:underline">
                HTMLRadar vs Papermark
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
