// /use-case/track-html-deck — "own-HTML" engine page. For people who
// already have an HTML deck (Claude artifact, reveal.js, hand-rolled)
// and want read analytics without a PDF export. (Gamma/Tome/Pitch were
// removed 2026-07-03 — none of them exports HTML; the old claim here
// was wrong.)

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Track an HTML Deck — Read Analytics for Web Decks | HTMLRadar',
  description:
    'Built a deck in Claude, reveal.js, or plain HTML? Share it as a tracked link and see who read each slide. No PDF export. Open-source.',
  path: '/use-case/track-html-deck',
});

export default function TrackHtmlDeckPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Track an HTML deck', url: '/use-case/track-html-deck' },
            ]}
          />
          <SectionMark>HTMLRadar · Use case</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Track the HTML deck you already built.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Your deck is already HTML — a Claude artifact, a reveal.js build, a ChatGPT one-pager, a
            hand-rolled page. The old workflow says: flatten it to PDF so a tracker can handle it.
            HTMLRadar says: keep the HTML, send a tracked link, see who read each section.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How do you share an HTML file as a tracked link?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Upload the file or paste a URL. You get a link like{' '}
              <span className="font-mono text-[14px] text-ink">htmlradar.com/r/swift-falcon</span>{' '}
              about sixty seconds after signing in. Replace the file later and every link you
              already sent serves the new version — old links keep working.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What do you see when someone reads it?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A live dashboard, per recipient: active read time, scroll depth, and time per section
              — down to which heading they parked on and for how long. A three-second dwell floor
              keeps scroll-pasts from counting as reads, and an email lands the moment a real read
              happens.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Does it work with AI-generated decks?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              That&apos;s the point. A{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                Claude artifact
              </Link>{' '}
              is a single HTML file; a{' '}
              <Link href="/for/reveal-js" className="text-signal-dark hover:underline">
                reveal.js deck
              </Link>{' '}
              always was HTML; so is anything ChatGPT, v0, or your own editor produced. If it opens
              in a browser, HTMLRadar can serve it through a tracked link — single-file HTML with
              embedded assets works out of the box.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Does HTMLRadar host the file?',
                a: 'Yes. Upload the HTML and it is hosted and versioned for you — replace the file and old links keep working. Or paste a URL and the proxy serves it through your tracked link.',
              },
              {
                q: 'Do I have to add a tracking snippet to my deck?',
                a: 'No. The tracker is injected automatically when the deck is served through your tracked link. Your original file stays untouched.',
              },
              {
                q: 'What counts as a read?',
                a: "Active time with a three-second dwell floor per section — scroll-pasts and accidental opens don't count as reads.",
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
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking for founders
              </Link>
              ,{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
              </Link>
              , and{' '}
              <Link
                href="/blog/how-we-built-htmlradar"
                className="text-signal-dark hover:underline"
              >
                how we built HTMLRadar
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
