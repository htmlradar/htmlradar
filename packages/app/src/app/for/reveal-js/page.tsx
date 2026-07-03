// /for/reveal-js — tool page. reveal.js decks are already HTML; the
// tracker's section detection handles <section> slide containers
// natively. Queries: "reveal.js analytics", "track reveal.js
// presentation", "share reveal.js deck".

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'reveal.js Deck Analytics — See Who Read Each Slide | HTMLRadar',
  description:
    'Share a reveal.js presentation as a tracked link and see who opened it, which slides they read, and how long they stayed. No PDF export, no plugin.',
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
            Slide-level analytics for your reveal.js deck.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            A reveal.js deck is already what every tracking tool wishes documents were: clean HTML
            with one <span className="font-mono text-[14px] text-ink">&lt;section&gt;</span> per
            slide. Don&apos;t flatten it to PDF to find out whether anyone read it — send it as a
            tracked link and keep the transitions, the code highlighting, and the speaker polish.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How it works
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                Build your deck as a single HTML file (inline your assets, or use the static export
                you already have).
              </li>
              <li>Upload it to HTMLRadar — or paste the URL where the deck is already hosted.</li>
              <li>
                Send the tracked link. Slides are auto-detected from your{' '}
                <span className="font-mono text-[14px] text-ink">&lt;section&gt;</span> containers
                and headings — no plugin, no snippet, no changes to the deck.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What the dashboard shows
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Per viewer: which slides they dwelled on and for how long, scroll depth, total active
              time, and when they came back for a second look. Engaged time uses a five-second idle
              watchdog — a tab parked in the background stops counting — and a three-second floor
              per section keeps flick-throughs from registering as reads.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Built by people who like their tools open
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              reveal.js is open source; so is HTMLRadar — AGPL-3.0, self-hostable on Cloudflare +
              Supabase free tiers. The tracker is a small script you can read end to end: section
              dwell, scroll depth, and active time, nothing else. No mouse tracking, no keystrokes,
              no session replay.{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                Run it on your own infrastructure
              </Link>{' '}
              if you&apos;d rather not trust anyone&apos;s hosted anything.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Does it work with multi-file reveal.js builds?',
                a: 'Single-file HTML with inlined assets works out of the box. For a multi-file build, host it anywhere and paste the URL — the deck is served through your tracked link.',
              },
              {
                q: 'Do vertical slide stacks count as separate sections?',
                a: 'Sections are detected from anchored headings first, then slide containers. Nested stacks resolve to their headings when present — decks with one heading per slide get the cleanest per-slide breakdown.',
              },
              {
                q: 'Can I keep using reveal.js speaker notes and plugins?',
                a: 'Yes. The file is served as-is with the tracker injected alongside; your deck code is not modified.',
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
                share a Claude artifact
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
