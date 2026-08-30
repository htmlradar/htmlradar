// Blog post #2 — the launch piece. v2, 30 Aug 2026: opens on why HTML became
// the format documents are generated in, states what is recorded as a spec
// rather than a defence. Body is the dev.to/Hashnode launch post; this URL is
// the canonical one those syndications point at.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Decks moved to HTML. I built the read tracking for it.',
  description:
    'Send-side analytics for HTML decks and proposals: section dwell, active read time, scroll depth. No session replay, no mouse tracking. Open source, AGPL-3.0.',
  path: '/blog/why-i-built-read-tracking-for-html',
});

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
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
              PDF was built for paper: a page meant to come out the same on every printer, back when
              the last thing to happen to a document was printing it. The layout froze because it
              was about to become a physical object.
            </p>

            <p>
              Printing isn&apos;t the last step any more, and a growing share of what I send was
              generated rather than typed. An agent writes the spec, the weekly update, the research
              summary, the first pass at the deck. What comes back is HTML, because HTML carries
              what a plan actually needs: a table that holds its shape, an SVG diagram, a layout
              that reflows on a phone.
            </p>

            <p>
              The Claude blog has a good public version of that argument, on why HTML beats markdown
              as what an agent gives you: a hundred-line markdown file doesn&apos;t get read, and
              the HTML version does.
            </p>

            <p>
              The other half is that HTML is legible to whatever sits in the next tab. A PDF arrives
              as an attachment. An HTML link is a page the recipient can read, hand to whichever
              assistant they use, and ask questions about.
            </p>

            <p>
              I run an AI company, and at some point last year I stopped sending investor decks as
              PDFs. The specs, the weekly updates, the board pre-reads and the client proposals
              followed. Then I wanted to know whether anybody had read one, since the argument for
              HTML is that it gets read. I had no way to check. My document was live HTML, and I
              wanted to see how it got read. So I built that, and it&apos;s open source.
            </p>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What it does
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  HTMLRadar is send-side analytics for HTML documents. You upload an HTML file or
                  paste a URL you already host, create one tracked link per recipient, and send it.
                  The dashboard gives you one row per viewer who opened it: which sections they
                  read, how much active reading time they spent, how far they scrolled. You also get
                  an email the first time someone opens it.
                </p>
                <p>
                  Every share carries its own controls - email gate, password, expiry date, an
                  allow-list by domain or exact address, and revocation. One document, many shares.
                  The password, expiry and allow-list can be changed after you&apos;ve sent the
                  link.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                How it works, in six sentences
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  The mechanics are the interesting part, so I&apos;ll keep this to six sentences.
                </p>
                <ol className="ml-5 list-decimal space-y-4 marker:font-mono marker:text-[13px] marker:text-signal-dark">
                  <li>
                    A Cloudflare Worker sits at{' '}
                    <code className="font-mono text-[14px] text-signal-dark">/r/{'{slug}'}</code>,
                    checks that share&apos;s gates, fetches your HTML, and injects the tracker with
                    HTMLRewriter on the way through, so the recipient sees <em>your</em> document,
                    not a re-rendered copy of it.
                  </li>
                  <li>
                    The tracker itself is roughly 8 KB gzipped, and since the source is public you
                    can read the whole thing before you decide whether to trust it.
                  </li>
                  <li>
                    Section detection runs a fallback chain over your markup: headings first (
                    <code className="font-mono text-[14px] text-signal-dark">h1</code>,{' '}
                    <code className="font-mono text-[14px] text-signal-dark">h2</code>,{' '}
                    <code className="font-mono text-[14px] text-signal-dark">h3</code>, or a
                    selector you configure), then slide or page containers such as{' '}
                    <code className="font-mono text-[14px] text-signal-dark">section</code>,{' '}
                    <code className="font-mono text-[14px] text-signal-dark">article</code> and
                    anything with{' '}
                    <code className="font-mono text-[14px] text-signal-dark">slide</code> or{' '}
                    <code className="font-mono text-[14px] text-signal-dark">page</code> in its
                    class name, and finally paragraph buckets for plain prose.
                  </li>
                  <li>
                    Time on a section only starts counting once at least 50% of it has stayed
                    visible for one continuous second, and the read signal fires after three
                    qualified seconds, so scrolling fast past a slide never registers as having read
                    it.
                  </li>
                  <li>
                    Both section dwell and session active time run a five-second idle watchdog:
                    session time resets on keydown, scroll and touchstart; section dwell also resets
                    on mousedown and wheel; mousemove is deliberately excluded, because a twitching
                    cursor isn&apos;t reading.
                  </li>
                  <li>
                    Every proxied response carries a{' '}
                    <code className="font-mono text-[14px] text-signal-dark">sandbox</code>{' '}
                    Content-Security-Policy without{' '}
                    <code className="font-mono text-[14px] text-signal-dark">
                      allow-same-origin
                    </code>
                    , so the recipient&apos;s document runs in an opaque origin and can&apos;t reach
                    application storage.
                  </li>
                </ol>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What gets recorded
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  The whole list, so you can decide before you send anything. An email address when
                  the recipient enters one at a gate, or a random browser ID when they don&apos;t;
                  then the time of each open, referrer, the browser&apos;s user-agent string and the
                  device type, browser and operating system read from it, coarse location,
                  per-section dwell, scroll depth and active reading time, and, if the document has
                  attachments, which ones were downloaded. There&apos;s no mouse tracking, no
                  keystroke capture, no DOM snapshots, no session replay and no raw IP address. A
                  recipient can start an opt-out with{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    window.HTMLRadar.optOut()
                  </code>{' '}
                  and confirm on the page that opens.
                </p>
                <p>
                  I send decks to investors and clients; I wouldn&apos;t send them a link that
                  records more than that.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The part I did not expect to matter
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  HTMLRadar ships an MCP server, so the agent that wrote the HTML can publish it as
                  a tracked link, and you can ask that same agent the next morning whether anyone
                  opened it. There are three tools over stdio -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">share_html</code>,{' '}
                  <code className="font-mono text-[14px] text-signal-dark">get_share_activity</code>{' '}
                  and <code className="font-mono text-[14px] text-signal-dark">whoami</code> - and
                  they work in Claude Code, Cursor and Codex CLI. In Claude Code a plugin layers a
                  skill on top, so the agent knows when to offer a tracked link and when to stay
                  quiet. I built it as a side path, but it&apos;s now the part I use most.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Self-hosting
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  If you&apos;d rather your documents didn&apos;t sit on somebody else&apos;s
                  infrastructure, the whole stack self-hosts. You need a Cloudflare account
                  (Workers, R2 and Pages), a Supabase project, and a domain on Cloudflare DNS.
                  Cloudflare and Supabase both have free tiers. Resend, which sends the emails, is
                  optional; without it the first-open trigger writes a{' '}
                  <code className="font-mono text-[14px] text-signal-dark">skipped</code> row and
                  everything else carries on working. The schema is a folder of numbered, idempotent
                  SQL migrations you paste into the Supabase editor in order. The self-hosting guide
                  is in the repo, and the hosted version is deployed from the same repository.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Where to find it
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  The hosted version is free for two tracked links, then $15 a month or $150 a year
                  for unlimited ones. Self-hosting has no licence fee and never will, because the
                  code is AGPL.
                </p>
                <p>
                  Source, issues and the roadmap:{' '}
                  <a
                    href="https://github.com/htmlradar/htmlradar"
                    className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                  >
                    https://github.com/htmlradar/htmlradar
                  </a>
                </p>
                <p>
                  Happy to hear your thoughts, particularly on the section-detection heuristics -
                  the part I&apos;m least confident about. Plain prose with no headings is hard to
                  bucket well, and I suspect somebody reading this has a better idea than paragraph
                  groups.
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
