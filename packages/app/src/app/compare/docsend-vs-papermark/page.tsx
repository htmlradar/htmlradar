// /compare/docsend-vs-papermark answers the direct comparison query. It is
// intentionally separate from the two HTMLRadar-vs-competitor pages: the
// useful decision here is which document model the sender has, before a
// product choice is made.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'DocSend vs Papermark for Document Sharing | HTMLRadar',
  description:
    'Compare DocSend and Papermark for shareable documents, then see when a live HTML deck needs a different kind of tracker.',
  path: '/compare/docsend-vs-papermark',
});

export default function DocsendVsPapermarkPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'DocSend vs Papermark', url: '/compare/docsend-vs-papermark' },
            ]}
          />
          <SectionMark>HTMLRadar · Comparison</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            DocSend vs Papermark for document sharing.
          </h1>
          <DirectAnswer updated="August 2026">
            DocSend and Papermark are both built around uploading a file and tracking that file;
            Papermark is the open-source one. HTMLRadar is built around HTML: if what you send is a
            web page, an HTML deck or a Claude artifact, it keeps that format and reports reading by
            section. This page compares all three.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            This is a decision between two document-sharing products, not a claim that one is always
            better. Start with the thing you need to send. If it is an uploaded office file, compare
            DocSend and Papermark. If it is a live HTML deck, brief, or proposal, use a tracker
            built to preserve that format.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The deciding question: file or live web page?
            </h2>
            <div className="mt-5 overflow-x-auto border-y border-line">
              <table className="w-full min-w-[620px] border-collapse text-left text-[15px] leading-relaxed text-ink-soft">
                <thead className="border-b border-line text-[12px] uppercase tracking-[0.1em] text-graphite">
                  <tr>
                    <th className="py-3 pr-5 font-medium">Your starting point</th>
                    <th className="py-3 pr-5 font-medium">Best fit</th>
                    <th className="py-3 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="py-4 pr-5 text-ink">
                      PDF, PowerPoint, Word, Keynote, or a file library
                    </td>
                    <td className="py-4 pr-5 text-ink">DocSend or Papermark</td>
                    <td className="py-4">Both are built around sharing uploaded documents.</td>
                  </tr>
                  <tr className="border-b border-line">
                    <td className="py-4 pr-5 text-ink">
                      Self-hosted document sharing is a hard requirement
                    </td>
                    <td className="py-4 pr-5 text-ink">Papermark</td>
                    <td className="py-4">
                      Its public project describes a self-hosted, open-source document-sharing
                      product.
                    </td>
                  </tr>
                  <tr>
                    <td className="py-4 pr-5 text-ink">
                      An HTML deck, brief, proposal, or product page
                    </td>
                    <td className="py-4 pr-5 text-ink">HTMLRadar</td>
                    <td className="py-4">
                      The recipient reads the original HTML, with section-level read analytics added
                      when it is served.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
              DocSend&apos;s supported-upload list includes PDFs, PowerPoint, Word, Keynote, media,
              and spreadsheets, but not HTML. Papermark&apos;s public repository describes its own
              self-hosted document-sharing model.{' '}
              <a
                href="https://help.docsend.com/hc/en-us/articles/206344058-Upload-files"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal-dark hover:underline"
              >
                DocSend source
              </a>{' '}
              and{' '}
              <a
                href="https://github.com/papermark/papermark"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal-dark hover:underline"
              >
                Papermark source
              </a>
              .
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When DocSend is the stronger choice
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Pick DocSend when the source is a conventional document and your team needs its mature
              file workflow: uploaded documents, spaces, access controls, watermarks, or
              e-signatures. Its accepted-file list is broad. That is useful when fidelity means a
              recipient sees a managed viewer for a familiar file format.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When Papermark is the stronger choice
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Pick Papermark when the same document-sharing model is right, but source access and
              self-hosting matter to you. Its public project offers shareable document links,
              analytics, custom domains, and a self-hosted deployment path. Evaluate it on the
              workflow you will actually run, not on a generic feature checklist.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The case neither file tracker solves
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A growing number of decks and client documents start as HTML: a Claude artifact, a
              reveal.js presentation, or a hand-built page. Turning one into a PDF removes the
              interactions and layout it was made for. HTMLRadar stores or fetches the HTML, serves
              it through a tracked link, and reports the sections that held attention.{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                See the HTML deck workflow
              </Link>
              .
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Do I need to replace DocSend or Papermark to use HTMLRadar?',
                a: 'No. They solve the file-sharing case. HTMLRadar is for the separate case where the document itself is HTML and should stay that way for the reader.',
              },
              {
                q: 'Does DocSend accept HTML files?',
                a: 'DocSend’s published accepted-file list does not include HTML. It accepts common document, presentation, media, image, and spreadsheet formats instead.',
              },
              {
                q: 'How should I test the right product quickly?',
                a: 'Send one real document. If a PDF or office file is the source of truth, test DocSend and Papermark. If the browser version is the source of truth, test the same HTML through HTMLRadar before converting it.',
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
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
