// /why — the longer essay. v2: rewritten per the Example Co writing prompt.
// Title is now a single declarative sentence ("HTML quietly won."), not an
// "X / Y" punchline. The throat-clearing line is gone. The standalone
// pull-quote with the "X. Y. Stayed there." reversal is folded into prose.
// The "That piece is what this is." closer is replaced with a 2-sentence
// specific claim about what HTMLRadar does. Third-person editorial.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export const runtime = 'edge';

export default function WhyPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <Reveal reveal={false}>
            <SectionMark>Why HTMLRadar exists</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 text-balance font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[68px]">
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
                Founders started writing investor decks as one-page HTML files exported from Pitch,
                or as styled documents typed into Claude and dropped into a WhatsApp thread.
                Designers replaced static mocks with interactive prototypes. Researchers published
                reports that rendered on phones, scaled to a screenshot, and adapted to whichever
                browser opened them. Engineers wrote planning documents with embedded diffs and
                call-graphs no markdown table could carry.
              </p>
            </Reveal>

            <Reveal delay={0.24}>
              <p>
                PDFs were built to be printed. HTML was built to render. That difference, ignored
                for years because PDFs were "the document format," compounded into something obvious
                in retrospect. Anything you would send to someone you care about reads better as
                HTML on every modern surface.
              </p>
            </Reveal>

            <Reveal delay={0.32}>
              <p>
                DocSend, PandaDoc, Brevo. The tools that grew up around document analytics were
                built when PDFs were the answer, and stayed loyal to it. None of them tells you who
                opened your HTML deck, which section your investor read, or whether the brief you
                sent to a client landed at all.
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
                HTMLRadar tracks who reads HTML at the section level. It sends an email the moment a
                real read happens, and tells you which sections kept them past three seconds.
              </p>
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

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
            <div className="font-mono text-[12px] tracking-wide text-graphite">
              HTML<span className="text-signal">Radar</span>. Document tracking for HTML.
            </div>
            <nav className="flex flex-wrap items-center gap-x-7 gap-y-3 font-mono text-[12px] text-graphite">
              <Link href="/why" className="link-slide hover:text-signal-dark">
                Why this exists
              </Link>
              <Link href="/blog" className="link-slide hover:text-signal-dark">
                Blog
              </Link>
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="link-slide hover:text-signal-dark"
                target="_blank"
                rel="noopener"
              >
                GitHub
              </a>
              <Link href="/pricing" className="link-slide hover:text-signal-dark">
                Pricing
              </Link>
              <Link href="/privacy" className="link-slide hover:text-signal-dark">
                Privacy
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  );
}
