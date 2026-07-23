// /for/reveal-js is about a specific, tested source shape: a standalone deck
// or a public deck whose assets resolve independently. Relative multi-file
// builds are not rewritten by the proxy and must not be promised here.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'reveal.js Deck Analytics by Slide | HTMLRadar',
  description:
    'Share a portable reveal.js deck through a tracked link. Keep the HTML presentation and see active attention by slide or heading.',
  path: '/for/reveal-js',
});

export default function RevealJsPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'reveal.js', url: '/for/reveal-js' },
            ]}
          />
          <SectionMark>HTMLRadar · Works with</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Track attention on a reveal.js deck, slide by slide.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            reveal.js is an open-source HTML presentation framework. When your deck is already a
            browser experience, keep it that way: share the working HTML instead of flattening it to
            PDF, then see which slides or sections earned sustained attention.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Prepare the deck for a tracked link
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                Use a standalone HTML file with styles, scripts, fonts, and images inlined, or a
                public deck whose assets use absolute URLs.
              </li>
              <li>
                Put one useful <span className="font-mono text-[14px] text-ink">h1</span>,{' '}
                <span className="font-mono text-[14px] text-ink">h2</span>, or{' '}
                <span className="font-mono text-[14px] text-ink">h3</span> in each slide when you
                want those exact labels in the dashboard.
              </li>
              <li>
                Upload the HTML, or paste the public URL, then send the generated tracked link.
              </li>
            </ol>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
              HTMLRadar prefers meaningful headings for reporting and falls back to slide containers
              when headings are absent. That means the title a reader sees can also be the title you
              use to judge interest.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What stays intact
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              HTMLRadar serves your deck and injects its tracker at delivery time. It does not ask
              you to add a reveal.js plugin or tracking snippet. Your deck&apos;s own transitions,
              keyboard navigation, and plugins keep working when their scripts and styles are
              available to the shared page. Free links also show a small &ldquo;Powered by
              HTMLRadar&rdquo; badge.
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
              reveal.js plugins are normal document scripts registered during initialization; its
              official documentation covers plugins and the built-in speaker-notes plugin.{' '}
              <a
                href="https://revealjs.com/plugins/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal-dark hover:underline"
              >
                reveal.js plugin docs
              </a>
              .
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What the dashboard measures
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Each viewer gets a separate reading record with active read time, scroll depth, and
              time attributed to visible sections. A section needs sustained, meaningful visibility
              before it counts, and the tracker stops crediting time after five seconds without
              reader activity. That keeps a background tab from looking like a long read.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The multi-file build caveat
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              HTMLRadar does not rewrite relative asset paths when it serves a URL source. A local
              reveal.js build that depends on{' '}
              <span className="font-mono text-[14px] text-ink">dist/</span> files beside it should
              be exported as one portable HTML file first. For a hosted deck, use absolute URLs for
              the reveal.js assets. This is the difference between a share link that renders cleanly
              and one that loses its theme or plugins.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Do vertical slide stacks get separate analytics?',
                a: 'Give each slide a meaningful heading for the clearest labels. Without headings, HTMLRadar falls back to the slide containers it finds in the deck.',
              },
              {
                q: 'Can I keep reveal.js speaker notes and plugins?',
                a: 'Yes when the deck remains portable: inline the required files for an upload, or use public absolute URLs for a hosted source. HTMLRadar injects its tracker alongside the delivered page instead of changing your saved deck.',
              },
              {
                q: 'Can I upload a whole reveal.js project folder?',
                a: 'Not directly. Upload one self-contained HTML file, or host the deck publicly and use a URL whose assets resolve through absolute URLs.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track your deck free
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 2 tracked links free. No credit card. AGPLv3 source on{' '}
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
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track any HTML deck
              </Link>
              ,{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                track a Claude artifact
              </Link>
              , and{' '}
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking
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
