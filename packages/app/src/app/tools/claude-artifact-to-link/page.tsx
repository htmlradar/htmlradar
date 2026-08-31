// Free tool page: the same staging tool as /tools/html-to-link, framed for
// people who already have the exported HTML file and want the link right
// now — a transactional intent. /for/claude-artifacts owns the "how do I
// work with Claude artifacts" guide intent, so this opening stays short and
// verb-first rather than duplicating that framing. Deliberately says nothing
// about Claude's interface beyond saving or exporting the artifact as an
// HTML file.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
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
  title: 'Turn a Claude Artifact Into a Link (Free) | HTMLRadar',
  description:
    'Already have the artifact exported? Drop the HTML file here and get a tracked link in the time it takes to sign in — no build step, no hosting to set up.',
  path: '/tools/claude-artifact-to-link',
});

const FAQ = [
  {
    q: 'How do I share a Claude artifact with someone else?',
    a: 'Save or export the artifact as an HTML file, drop that file on this page, and sign in. HTMLRadar gives you a link anyone can open in a browser, with no account on their side.',
  },
  {
    q: 'Which artifacts work here?',
    a: 'Self-contained HTML pages. If the artifact depends on a build step, on assets it loads from elsewhere, or on Claude-hosted AI behaviour, prepare it as a single portable HTML file first or keep it where it is.',
  },
  {
    q: 'Does my artifact get uploaded before I sign in?',
    a: 'The file itself is never uploaded to HTMLRadar until you sign in: the preview is rendered by your own browser, and the file is held in your browser storage across the sign-in. If the HTML references images, fonts or stylesheets on other websites, your browser fetches those to render the preview, exactly as it would on any web page. Scripts, forms and navigation are blocked in the preview.',
  },
  {
    q: 'What does the tracked link tell me?',
    a: 'Who opened it, which sections they read, and how long they stayed. Each link can also carry an email gate, a password, and an expiry date. The first 2 tracked links are free, then $15 a month.',
  },
];

type SearchParams = Promise<{ resume?: string }>;

export default async function ClaudeArtifactToLinkToolPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resumeToken = (await searchParams).resume ?? null;
  // Only the resume load pays for the auth round-trip; every other visit here
  // is an anonymous search visitor with no session to look up. The token still
  // has to match the staged record before anything is created.
  const signedIn = resumeToken ? Boolean((await serverClient().auth.getUser()).data.user) : false;

  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Claude artifact to link', url: '/tools/claude-artifact-to-link' },
            ]}
          />
          <SectionMark>HTMLRadar · Free tool</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[52px]">
            Drop your Claude artifact here. Get a tracked link back.
          </h1>
          <DirectAnswer updated="August 2026">
            Drop the exported HTML file below and sign in: that&apos;s the whole tool. You get a
            tracked link to send instead of the artifact, and it reports who opened it, which
            sections they read, and how long they stayed. Free for two tracked links, then $15 a
            month.
          </DirectAnswer>

          <div className="mt-8">
            <HtmlToolPanel
              tool="claude-artifact-to-link"
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
              <li>Save or export the artifact as an HTML file.</li>
              <li>
                Drop that file above. Your browser renders the preview, so you can confirm the
                exported page still looks the way you expect.
              </li>
              <li>
                Press &ldquo;Get your tracked link&rdquo; and sign in. The file uploads at that
                moment, and you send the link instead of the artifact.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What you get with the link
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Sending an artifact usually ends the conversation: it either got read or it did not,
              and you never find out which. A tracked link reports who opened it, which sections
              they read, and how long they spent on each. Give each person their own link and the
              answer is per-person rather than a single view count.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Any link can require an email address before it opens, sit behind a password, or
              expire on a date you choose.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why not just send the artifact?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              If the recipient is happy opening it wherever it already lives, send it that way.
              Sending a tracked link instead is worth it when the document is a pitch, a proposal,
              or a brief and the reading matters as much as the sending — and when you want to be
              able to close access afterwards.
            </p>
          </section>

          <Faq items={FAQ} />

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link
                href="/tools/claude-artifact-to-pdf"
                className="text-signal-dark hover:underline"
              >
                Claude artifact to PDF
              </Link>
              ,{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                HTML file to link
              </Link>
              , and{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                tracking Claude artifacts
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
