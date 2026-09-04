// /why — the longer essay. v2: rewritten per the editorial brief.
// Title is now a single declarative sentence ("HTML quietly won."), not an
// "X / Y" punchline. The throat-clearing line is gone. The standalone
// pull-quote with the "X. Y. Stayed there." reversal is folded into prose.
// The "That piece is what this is." closer is replaced with a 2-sentence
// specific claim about what HTMLRadar does. Third-person editorial.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import { DwellThreshold } from '@/components/mocks/DwellThreshold';
import { pageMeta } from '@/lib/seo';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export const dynamic = 'force-static';

export const metadata = pageMeta({
  title: 'Why HTMLRadar Exists',
  description:
    'Why HTML is a better format for decks, briefs, and proposals, and how HTMLRadar shows what happens after you send one.',
  path: '/why',
});

export default function WhyPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <Reveal reveal={false}>
            <SectionMark>Why HTMLRadar exists</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 text-balance font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
              HTML{' '}
              <span className="italic text-signal" style={{ fontVariationSettings: '"opsz" 144' }}>
                quietly won.
              </span>
            </h1>
          </Reveal>

          <div className="mt-14 space-y-7 text-[18px] leading-[1.7] text-ink-soft">
            <Reveal delay={0.1}>
              <p>
                For two decades, the documents that mattered ended in .pdf. Investor decks. Briefs.
                Board updates. Research reports. One-pagers. The receipt for the work, in the format
                the work was filed under.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <p>
                Founders started writing investor decks as one-page HTML files — styled documents
                typed into Claude or ChatGPT and dropped into a WhatsApp thread. Designers replaced
                static mocks with interactive prototypes. Researchers published reports that
                rendered on phones, scaled to a screenshot, and adapted to whichever browser opened
                them. Engineers wrote planning documents with embedded diffs and call-graphs no
                markdown table could carry.
              </p>
            </Reveal>

            <Reveal delay={0.24}>
              <p>
                PDFs were built to be printed. HTML was built to render &mdash; and a page that
                renders is interactive, fits a phone, and can change after it has been sent. That
                difference was ignored for years, because PDFs were "the document format." More of
                these documents are written with AI tools now, but the format is the point, not who
                typed it.
              </p>
            </Reveal>

            <Reveal delay={0.32}>
              <p>
                DocSend, PandaDoc, Brevo. The tools that grew up around document analytics were
                built when PDFs were the answer, and stayed loyal to it. Every one of them is built
                around uploading a file and tracking that file, which is a different job from
                keeping an HTML document alive and reporting which section your investor read.
              </p>
            </Reveal>

            <Reveal delay={0.4}>
              <p>
                The piece that always sat missing was the one that tells you what happened after the
                link went out. Who opened it. From which city. On a phone or a laptop. Whether they
                stayed on the page you cared about, or skipped past it. Whether they came back the
                next morning.
              </p>
            </Reveal>

            <Reveal delay={0.48}>
              <p className="border-t border-line pt-7 text-ink">
                HTMLRadar tracks who reads HTML at the section level. It emails you on the first
                real read — five seconds on the page, not a bounce.
              </p>
            </Reveal>

            {/* Draws the sentence that used to end this page: a section only
                counts as read once the reader stays past three seconds. */}
            <Reveal delay={0.54}>
              <DwellThreshold />
            </Reveal>
          </div>

          <Reveal delay={0.56}>
            <div className="mt-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t border-line pt-10">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-[14px] text-ink-soft underline decoration-line decoration-2 underline-offset-[6px] transition hover:text-signal-dark hover:decoration-signal"
              >
                <ArrowLeft className="size-3.5" />
                Back to home
              </Link>
              <Link
                href="/sign-in"
                data-cta="why.start_free"
                className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
              >
                Start free
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
