// /for/claude-artifacts is the workflow guide: how a Claude user fits
// tracked sharing into ongoing work with artifacts, from export through
// updating the same link later. /tools/claude-artifact-to-link owns the
// transactional "I have the file, give me a link now" intent, so this
// opening stays on the workflow rather than repeating that promise. Claude
// artifacts can be several formats, so this page must not imply every
// artifact can be uploaded as a standalone document.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { RecipientFlow } from '@/components/mocks/RecipientFlow';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Working With Claude Artifacts: A Tracking Workflow | HTMLRadar',
  description:
    'How Claude users fit tracked sharing into their work: export an artifact once, keep the same link current as it changes, and know which sections recipients actually read.',
  path: '/for/claude-artifacts',
});

export default function ClaudeArtifactsPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Claude Artifacts', url: '/for/claude-artifacts' },
            ]}
          />
          <SectionMark>HTMLRadar · Works with</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            The workflow for tracking a Claude artifact you keep revising.
          </h1>
          <DirectAnswer updated="September 2026">
            When Claude writes a document for someone else, HTMLRadar turns it into a tracked link
            and reports back who opened it and which parts held them. For an artifact you keep
            revising, export it once and send that link instead of the artifact URL: replace the
            uploaded file when the artifact changes and the same link serves the new version, so
            recipients never get a stale copy. Free for two tracked links, open source.
          </DirectAnswer>

          <section className="mt-10">
            <p className="max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              A published artifact gives you a URL. Here is what an HTMLRadar link adds on top of
              the same HTML.
            </p>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">What you want to know</th>
                    <th className="px-5 py-3">What an HTMLRadar link adds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    [
                      'Who opened it',
                      'Each recipient gets their own link, and you get an email alert on the first open',
                    ],
                    [
                      'Which sections were read',
                      'Headings and slides become labels, with active read time and scroll depth against each',
                    ],
                    [
                      'Email gate, password, expiry',
                      'All three are optional per link, alongside an allow-list and revocation',
                    ],
                  ].map(([question, htmlradar]) => (
                    <tr key={question}>
                      <td className="px-5 py-3.5 align-top text-ink">{question}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mt-10 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
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
            {/* Drawn rather than described: the notification firing, the gate,
                and the rendered page. The paragraph that walked through those
                three moments in words is gone. */}
            <div className="mt-6 xl:-mx-40">
              <RecipientFlow />
            </div>
            <p className="mt-6 text-[16px] leading-relaxed text-ink-soft">
              Your source file stays unchanged — the tracker is added to the page HTMLRadar serves,
              and free links also carry a small &ldquo;Powered by HTMLRadar&rdquo; badge. In the
              dashboard, headings become section labels, so you can see active read time, scroll
              depth, and which parts received sustained attention.
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
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
