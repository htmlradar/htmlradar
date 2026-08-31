// Free tool page: drop an HTML file, preview it, sign in, get a tracked link.
// The tool sits above the fold because the search intent behind
// "html file to link converter online free" is to do the thing, not read
// about it. The copy below exists for the same reason every other marketing
// page has copy: so the page can rank and be cited.
//
// Sol's messaging review, 31 Aug 2026: four pages describe this same upload
// workflow, so each opening has to claim a different job. This one owns the
// transactional intent — the file is already on disk, the link is wanted now,
// and the browser-side preview is what only the tool pages offer.
// /use-case/track-html-deck owns the buyer story for a deck you already
// built, and /for/claude-artifacts owns the keep-revising workflow.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';
import { serverClient } from '@/lib/supabase-server';
import { createDocument } from '@/app/(app)/new/actions';
import { HtmlToolPanel } from '../HtmlToolPanel';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Share an HTML File as a Link (Free) | HTMLRadar',
  description:
    'Share an HTML file as a link: drop the file, preview it in your browser, and get a shareable link that shows who opened it and which sections they read. Free HTML-to-link tool.',
  path: '/tools/html-to-link',
});

const FAQ = [
  {
    q: 'How do I share an HTML file as a link?',
    a: 'Drop the file on this page, sign in, and HTMLRadar hosts it behind a tracked link you can send by email or chat. The recipient opens a normal web page, with no account on their side.',
  },
  {
    q: 'Is this HTML to link converter free?',
    a: 'The first 2 tracked links are free, with no credit card. Unlimited links are $15 a month or $150 a year. HTMLRadar is also open source under AGPL-3.0, so you can run the whole thing yourself instead.',
  },
  {
    q: 'Does my file get uploaded before I sign in?',
    a: 'The file itself is never uploaded to HTMLRadar until you sign in: the preview is rendered by your own browser, and the file is held in your browser storage across the sign-in. If the HTML references images, fonts or stylesheets on other websites, your browser fetches those to render the preview, exactly as it would on any web page. Scripts, forms and navigation are blocked in the preview.',
  },
];

type SearchParams = Promise<{ resume?: string }>;

export default async function HtmlToLinkToolPage({ searchParams }: { searchParams: SearchParams }) {
  const resumeToken = (await searchParams).resume ?? null;
  // Only the resume load pays for the auth round-trip; every other visit here
  // is an anonymous search visitor with no session to look up. The token still
  // has to match the staged record before anything is created.
  const signedIn = resumeToken ? Boolean((await serverClient().auth.getUser()).data.user) : false;

  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-16 pt-28 md:pb-20 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTML file to link', url: '/tools/html-to-link' },
            ]}
          />
          <SectionMark>HTMLRadar · Free tool</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Share an HTML file as a link, and see who reads it.
          </h1>
          <DirectAnswer updated="August 2026">
            To share an HTML file as a link, drop it on this page. Nothing is uploaded while you
            look: your own browser renders the preview, and the file reaches HTMLRadar only once you
            sign in. The link you get back reports who opened it, which sections they read, and for
            how long. Free for two tracked links, then $15 a month. Open source.
          </DirectAnswer>

          <div className="mt-8">
            <HtmlToolPanel
              tool="html-to-link"
              action={createDocument}
              resumeToken={resumeToken}
              signedIn={signedIn}
            />
          </div>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How it works, in three steps
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                Drop the .html or .htm file above. Your browser renders the preview, so you can
                check it looks right before anyone else sees it.
              </li>
              <li>
                Press &ldquo;Get your tracked link&rdquo; and sign in. That is the moment the file
                is uploaded — never before.
              </li>
              <li>
                Create a share link on the document page and send it. You can add an email gate, a
                password, or an expiry date to any link.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What you get with the link
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A plain URL tells you nothing about the reader. A tracked link tells you who opened
              it, which sections they read, and how long they spent on each one. You can give each
              recipient their own link, so you know which of them read the pricing section and which
              stopped at the first page.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Every link can carry an optional email gate, a password, and an expiry date. Revoke it
              and the link stops working.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why not just host the file somewhere?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              You can. Dropbox, S3, GitHub Pages, or your own server will all serve an HTML file at
              a URL, and if all you need is a public page, host it there. HTMLRadar answers a
              different question: whether the person you sent it to actually read it, which sections
              they read, and for how long. Each recipient gets their own link, so the answer is per
              person.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Already hosting the page yourself? You can paste that URL into HTMLRadar instead of
              uploading a file, and track the page where it lives.
            </p>
          </section>

          <Faq items={FAQ} />

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link
                href="/tools/claude-artifact-to-link"
                className="text-signal-dark hover:underline"
              >
                share a Claude artifact as a link
              </Link>
              ,{' '}
              <Link
                href="/tools/claude-artifact-to-pdf"
                className="text-signal-dark hover:underline"
              >
                Claude artifact to PDF
              </Link>
              , and{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track an HTML deck
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
