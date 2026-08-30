// /for/claude-artifacts addresses the portable-HTML workflow specifically.
// Claude artifacts can be several formats, so this page must not imply every
// artifact can be uploaded as a standalone document.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Track a Claude HTML Artifact as a Link | HTMLRadar',
  description:
    'Export a standalone Claude HTML artifact, share it through a tracked link, and see active read time and section-level attention.',
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
            Track a Claude artifact you can export as HTML.
          </h1>
          <DirectAnswer updated="August 2026">
            To see who opened a Claude artifact, export it as HTML, upload it to HTMLRadar, and send
            the tracked link instead of the artifact URL. You get who opened it, which sections they
            read and for how long, plus an optional email gate, password and expiry. Free for two
            tracked links, open source.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Claude artifacts can be documents, code, websites, or interactive apps. HTMLRadar fits
            the website case: a standalone HTML page you can save or a public page you already host.
            Keep the browser version intact, send a tracked link, and see whether the recipient read
            the sections that matter.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              A reliable Claude artifact workflow
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                In Claude&apos;s artifact view, open the code and copy or download the file.
                Anthropic documents both options for artifacts, including single-page HTML websites.
              </li>
              <li>
                Make it portable: use one HTML file with inline styles, scripts, and assets. If you
                already host it, keep the page public and use absolute asset URLs.
              </li>
              <li>
                Upload the HTML to HTMLRadar, or paste that public URL. Create a tracked share link
                when the document is ready to send.
              </li>
            </ol>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
              <a
                href="https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal-dark hover:underline"
              >
                Anthropic&apos;s artifact guide
              </a>{' '}
              covers viewing code, copying content, and downloading files.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What the recipient sees, and what you see
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              The recipient sees the HTML you supplied. HTMLRadar adds its tracker when the page is
              served; free links also carry a small &ldquo;Powered by HTMLRadar&rdquo; badge. Your
              source file stays unchanged. In the dashboard, headings become section labels, so you
              can see active read time, scroll depth, and which parts received sustained attention.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Updating the artifact without changing the link
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              For an uploaded file, replace the document with the revised HTML. Existing share links
              then serve the current version. For a URL source, update the page at its original URL.
              Keep a meaningful heading on each major section so the reader-facing page and your
              dashboard use the same language.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When to keep the artifact in Claude
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Keep an artifact in Claude when it depends on Claude&apos;s hosted AI features or
              requires the reader to sign in there. Anthropic runs AI-powered artifacts on its
              infrastructure. HTMLRadar tracks a portable HTML document; it does not move that
              hosted capability into your uploaded file.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Does every Claude artifact work as a standalone HTML upload?',
                a: 'No. The reliable case is a self-contained HTML page. Artifacts that depend on a build step, relative assets, or Claude-hosted AI behavior should stay hosted or be prepared as a portable page first.',
              },
              {
                q: 'Does HTMLRadar modify my saved artifact?',
                a: 'No. The original source stays unchanged. HTMLRadar injects its tracker only into the page it serves through the tracked link; free links also show a small Powered by HTMLRadar badge.',
              },
              {
                q: 'Can I use a public URL instead of uploading a file?',
                a: 'Yes, for a publicly reachable HTML page. Use absolute URLs for its assets so they keep resolving when the tracked page is served.',
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
              <Link href="/use-case/proposal-tracking" className="text-signal-dark hover:underline">
                proposal tracking
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
