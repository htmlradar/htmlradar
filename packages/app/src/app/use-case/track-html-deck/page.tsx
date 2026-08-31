// /use-case/track-html-deck — "own-HTML" engine page. For people who
// already have an HTML deck (Claude artifact, reveal.js, hand-rolled)
// and want read analytics without a PDF export. (Gamma/Tome/Pitch were
// removed 2026-07-03 — none of them exports HTML; the old claim here
// was wrong.)

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { DashboardMock } from '@/components/mocks/DashboardMock';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Track an HTML Deck — Read Analytics | HTMLRadar',
  description:
    'Upload an HTML deck or paste a URL, then see which sections people read. Built for Claude artifacts, reveal.js decks, and hand-written HTML.',
  path: '/use-case/track-html-deck',
});

export default function TrackHtmlDeckPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
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
          <DirectAnswer updated="August 2026">
            To track an HTML deck, upload the file or paste the URL you already host, and HTMLRadar
            gives you a tracked link that keeps the deck as a live page. You see who opened it,
            which sections or slides they read, active time and scroll depth. Free for two tracked
            links, open source.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Your deck is already HTML — a Claude artifact, a reveal.js build, a ChatGPT one-pager,
            or a hand-rolled page. HTMLRadar keeps it that way: send a tracked link and see which
            sections people read.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How do you share an HTML file as a tracked link?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Upload a <span className="font-mono text-[14px] text-ink">.html</span> or{' '}
              <span className="font-mono text-[14px] text-ink">.htm</span> file, or paste a URL you
              already host. HTMLRadar gives you a share link for each recipient. Replace an uploaded
              file later and every existing link serves the new version.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What do you see when someone reads it?
            </h2>
            {/* The heading asks for a picture. It used to get a paragraph
                describing one; now it gets the picture. */}
            <div className="mt-6">
              <DashboardMock />
            </div>
            <p className="mt-6 text-[16px] leading-relaxed text-ink-soft">
              The tracker attributes reading time to the headings and slides the recipient actually
              viewed. A three-second dwell floor keeps quick scroll-pasts from counting as reads.
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
              you can export as portable HTML, or a{' '}
              <Link href="/for/reveal-js" className="text-signal-dark hover:underline">
                reveal.js deck
              </Link>{' '}
              bundled as a standalone page, can go straight into HTMLRadar. You do not need to
              convert it to PDF first.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Does HTMLRadar host the file?',
                a: 'Yes. Upload the HTML and it is hosted and versioned for you. Replace the file and old links keep working. Or paste a URL you already host and share it through a tracked link.',
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
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
