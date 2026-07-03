// /for/claude-artifacts — tool page for the core wedge: decks and docs
// made in Claude (Artifacts) are HTML; HTMLRadar tracks them without a
// PDF export. Zero-competition queries: "share claude artifact",
// "track claude artifact", "claude artifact analytics".

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Share a Claude Artifact as a Tracked Link | HTMLRadar',
  description:
    'Made a deck, report, or one-pager as a Claude artifact? Send it as a tracked link and see who opened it, which sections they read, and for how long.',
  path: '/for/claude-artifacts',
});

export default function ClaudeArtifactsPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Claude Artifacts', url: '/for/claude-artifacts' },
            ]}
          />
          <SectionMark>HTMLRadar · Works with</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Track who reads your Claude artifact.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            You asked Claude for a deck, a report, a proposal — and got a polished HTML artifact.
            Then comes the awkward part: how do you send it to someone and know they actually read
            it? Screenshot it and lose the interactivity? Flatten it to PDF? HTMLRadar keeps the
            artifact exactly as Claude made it and adds read analytics on top.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How do you share a Claude artifact as a tracked link?
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                In Claude, open the artifact and copy its code (or download it) — it&apos;s a single
                HTML file.
              </li>
              <li>
                Upload that file to HTMLRadar. You get a link like{' '}
                <span className="font-mono text-[14px] text-ink">htmlradar.com/r/swift-falcon</span>{' '}
                in about a minute.
              </li>
              <li>
                Send the link. The recipient sees the artifact pixel-for-pixel — no signup, no
                viewer chrome over your content.
              </li>
            </ol>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              When Claude revises the artifact, upload the new version — every link you already sent
              serves the update, and the version history keeps the old ones.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What do you see when they open it?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A per-viewer dashboard: who opened it, active read time, scroll depth, and time per
              section — sections are auto-detected from the artifact&apos;s own headings. A
              three-second dwell floor separates a real read from a scroll-past, and you get an
              email the moment the first real read happens.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why not just publish the artifact?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Claude&apos;s own publish link is great for broadcasting — but it tells you nothing
              about who read it. HTMLRadar gives each recipient their own link with its own gate:
              email-gate it, password it, expire it, or revoke it after the deal closes. Read
              analytics only work when you know who the reader is.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Does the artifact need any changes or tracking code?',
                a: 'No. Upload the HTML exactly as Claude produced it — the tracker is injected when the doc is served through your tracked link, and your original file stays untouched.',
              },
              {
                q: 'Do interactive artifacts work?',
                a: 'Single-file HTML with inline scripts, styles, and embedded assets works out of the box — if it opens in a browser as one file, it can be served through a tracked link.',
              },
              {
                q: 'Can the recipient tell it is tracked?',
                a: 'Free-tier links carry a small "Powered by HTMLRadar" badge in the corner; the document itself is byte-identical to your upload. No mouse tracking, no keystrokes, no session replay — section dwell, scroll depth, and active time only, and recipients can opt out.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track your artifact free
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
              <Link href="/for/reveal-js" className="text-signal-dark hover:underline">
                reveal.js deck analytics
              </Link>
              , and{' '}
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking for founders
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
