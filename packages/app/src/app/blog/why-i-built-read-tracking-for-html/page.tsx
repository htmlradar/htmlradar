// Blog post #2 — the launch piece. v4, 30 Aug 2026: opens on the two things
// that changed (the writer, the reader), then what it does, how it works,
// what is recorded, the MCP server, and self-hosting. Body is word-for-word
// the dev.to/Hashnode launch post; this URL is the canonical one those
// syndications point at.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Decks moved to HTML. I built the read tracking for it.',
  description:
    'Decks and proposals are HTML now, so I built the read tracking: time per section, active reading time, scroll depth. No session replay. Open source, AGPL-3.0.',
  path: '/blog/why-i-built-read-tracking-for-html',
});

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <ArticleLd
            headline="Decks moved to HTML. I built the read tracking for it."
            datePublished="2026-08-30"
            url="/blog/why-i-built-read-tracking-for-html"
          />
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              {
                name: 'Decks moved to HTML. I built the read tracking for it.',
                url: '/blog/why-i-built-read-tracking-for-html',
              },
            ]}
          />
          <SectionMark>HTMLRadar · Product</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[52px]">
            Decks moved to HTML. I built the read tracking for it.
          </h1>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            2026-08-30 &nbsp;·&nbsp; 4 min read &nbsp;·&nbsp; Product
          </p>

          <div className="mt-12 space-y-10 text-[16.5px] leading-[1.7] text-ink-soft">
            <p>
              I&apos;m writing this to explain why HTMLRadar exists, because the reason came out of
              my own week, not a market map.
            </p>

            <p>
              I run an AI company. Last year I stopped sending investor decks as PDFs, and the
              specs, weekly updates, board pre-reads and client proposals followed. Most of what I
              send now was not typed by a person. An agent wrote the first pass, and what came back
              was HTML.
            </p>

            <p>That is not a quirk of one tool. Two things changed at once.</p>

            <p>
              <strong className="font-semibold text-ink">The writer changed.</strong> When an agent
              produces a document, HTML is the natural output, because it is the one format that
              holds everything a plan needs in a single file: a table that keeps its shape, a
              diagram as SVG, a chart that recalculates when you change a number, a section that
              unfolds when the reader wants the detail. It reflows on a phone and still prints if
              someone insists. Nobody reads a hundred-line markdown file. The HTML version gets
              read. PDF was built for the printer; the documents I send now never reach one.
            </p>

            <p>
              <strong className="font-semibold text-ink">The reader changed.</strong> A PDF arrives
              as an attachment. An HTML link is a page the recipient opens on a phone, in an inbox,
              and increasingly next to an assistant of their own: they hand it over, headings and
              tables intact, and ask questions about it. The documents that matter now end in .html,
              and they are read by people and by the tools those people bring with them.
            </p>

            <p>
              Then I wanted to know whether anyone had read one. That is the whole point of sending
              HTML, and I had no way to check. My document was a live page, not a file. So I built
              the tracking for HTML, and it is open source.
            </p>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What it does
              </h2>

              <figure className="mt-8">
                <img
                  src="/brand/dashboard-demo.webp"
                  width={960}
                  height={540}
                  loading="eager"
                  alt="HTMLRadar dashboard: one row per viewer, time per section, scroll depth, first-open email"
                  className="w-full max-w-full rounded-xl border border-line"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
                <figcaption className="mt-3 text-[13px] leading-relaxed text-graphite">
                  Demo dashboard with synthetic data
                </figcaption>
              </figure>

              <ul className="mt-8 ml-5 list-disc space-y-4 marker:text-signal-dark">
                <li>
                  Upload an HTML file or paste a URL you already host, create one tracked link per
                  recipient, send it.
                </li>
                <li>
                  The dashboard shows one row per viewer: which sections they read, how long they
                  actively read, how far they scrolled. An email arrives on the first open.
                </li>
                <li>
                  Each link has its own email gate, password, expiry, allow-list by domain or
                  address, and a revoke switch. One document, many links. Password, expiry and
                  allow-list stay editable after sending.
                </li>
                <li>
                  Attachments ride under the same link (the model, the cap table, a ZIP), and each
                  download is tagged to the recipient. Replace the file and every link you already
                  sent shows the new version.
                </li>
                <li>
                  The point is the follow-up: you write back about the section they re-read, not
                  &quot;just checking in&quot;.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                How it works
              </h2>
              <p className="mt-4">
                The mechanics, briefly, because they are what you are trusting.
              </p>
              <ul className="mt-4 ml-5 list-disc space-y-4 marker:text-signal-dark">
                <li>
                  A Cloudflare Worker serves your document at{' '}
                  <code className="font-mono text-[14px] text-signal-dark">/r/{'{slug}'}</code>,
                  checks the link&apos;s gates, and injects the tracker on the way through. The
                  recipient sees your document, not a re-rendered copy.
                </li>
                <li>The tracker is about 8 KB gzipped, and the source is public.</li>
                <li>
                  Sections come from your markup: headings first, then slide or page containers,
                  then paragraph buckets for plain prose.
                </li>
                <li>
                  A section starts counting only after it has stayed half visible for a full second,
                  and a read counts after three such seconds. Scrolling past a slide never counts. A
                  five-second idle watchdog stops the clock when nothing happens; mouse movement is
                  ignored on purpose.
                </li>
                <li>
                  Every document runs in a sandbox with no access to the application&apos;s storage.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What gets recorded
              </h2>
              <p className="mt-4">
                The whole list, so you can decide before you send anything: an email address when
                the recipient enters one at a gate, otherwise a random browser id; the time of each
                open, the referrer, the user-agent string and the device, browser and OS read from
                it, coarse location, time per section, scroll depth, active reading time, and which
                attachments were downloaded. No mouse tracking, no keystrokes, no DOM snapshots, no
                session replay, no raw IP address. A recipient can opt out with{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  window.HTMLRadar.optOut()
                </code>{' '}
                and confirm on the page that opens.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The part I did not expect to matter
              </h2>

              <figure className="mt-8">
                <img
                  src="/brand/mcp-transcript.png"
                  width={880}
                  height={1143}
                  loading="lazy"
                  alt='Claude Code with the HTMLRadar plugin answering "did anyone read the deck, and which sections?"'
                  className="w-full max-w-full rounded-xl border border-line"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
                <figcaption className="mt-3 text-[13px] leading-relaxed text-graphite">
                  A real Claude Code session with the HTMLRadar plugin
                </figcaption>
              </figure>

              <p className="mt-8">
                HTMLRadar ships an MCP server. The agent that wrote the HTML publishes it as a
                tracked link, and the next morning you ask the same agent whether anyone opened it.
                Three tools over stdio the day I shipped it (
                <code className="font-mono text-[14px] text-signal-dark">share_html</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">get_share_activity</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">whoami</code>; seven now),
                working in Claude Code, Cursor and Codex CLI; in Claude Code a plugin adds a skill
                so the agent knows when to offer a link. I built it as a side path. It is now the
                part I use most.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Self-hosting and price
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  The whole stack self-hosts on Cloudflare (Workers, R2, Pages) and Supabase, both
                  with free tiers, plus a domain on Cloudflare DNS; email through Resend is
                  optional. The schema is numbered SQL migrations you paste in order, the guide is
                  in the repo, and the hosted version deploys from the same repository. Hosted: free
                  for two tracked links, then $15 a month or $150 a year. Self-hosting has no
                  licence fee and never will; the code is AGPL.
                </p>
                <p>
                  Source, issues and roadmap:{' '}
                  <a
                    href="https://github.com/htmlradar/htmlradar"
                    className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                  >
                    https://github.com/htmlradar/htmlradar
                  </a>
                </p>
                <p>
                  I&apos;d like to hear where the section detection goes wrong on your documents.
                  Plain prose with no headings is the part I am least sure of, and someone reading
                  this probably has a better idea than paragraph buckets.
                </p>
                <p>
                  Cheers,
                  <br />
                  Abhinandan
                </p>
              </div>
            </section>
          </div>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Curious how the pieces fit together? Read{' '}
              <Link
                href="/blog/how-we-built-htmlradar"
                className="text-signal-dark hover:underline"
              >
                how I built HTMLRadar
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
