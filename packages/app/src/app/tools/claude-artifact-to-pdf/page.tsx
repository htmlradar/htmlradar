// Free tool page: HTML in, PDF out. Sol's messaging review, 31 Aug 2026: the
// tool direction is fine as a funnel, but the copy must not read as though PDF
// is where a deck ends up. The framing is that the PDF is the frozen copy you
// hand over when someone insists, and the HTML you already have is the version
// that can be read back — so every closing block routes to the tracked link.
//
// HTML in, PDF out. No sign-in, and the file itself is never
// uploaded to HTMLRadar — the page renders it in a sandboxed iframe and hands
// that iframe to the browser's own print dialog. The sandbox blocks scripts,
// forms and navigation; it does not stop the browser fetching images, fonts or
// stylesheets the HTML points at, so the copy must never promise that nothing
// leaves the machine.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';
import { HtmlToolPanel } from '../HtmlToolPanel';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Claude Artifact to PDF (Free, In Your Browser) | HTMLRadar',
  description:
    'Turn a Claude artifact into a PDF without signing in. Save the artifact as an HTML file, drop it here, and your browser writes the PDF. The file itself is never uploaded to HTMLRadar.',
  path: '/tools/claude-artifact-to-pdf',
});

const FAQ = [
  {
    q: 'How do I turn a Claude artifact into a PDF?',
    a: 'Save or export the artifact as an HTML file, drop it on this page, and press Save as PDF. Your browser opens its own print dialog; choose Save as PDF as the destination and pick where the file goes.',
  },
  {
    q: 'Does my file get uploaded to HTMLRadar?',
    a: 'No. The file itself is never uploaded to HTMLRadar: your browser reads it, renders the preview, and prints it, and no sign-in is required. If the HTML references images, fonts or stylesheets on other websites, your browser fetches those to render the preview, exactly as it would on any web page. Scripts, forms and navigation are blocked in the preview.',
  },
  {
    q: 'Why does my interactive artifact look static in the PDF?',
    a: 'Scripts, forms and navigation are blocked in the preview, so anything that only appears after a click or an animation will not be in the PDF. You get the static layout. If the artifact needs to stay interactive, share it as a live page instead.',
  },
];

export default function ClaudeArtifactToPdfToolPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Claude artifact to PDF', url: '/tools/claude-artifact-to-pdf' },
            ]}
          />
          <SectionMark>HTMLRadar · Free tool</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[52px]">
            Turn a Claude artifact into a PDF, in your browser.
          </h1>
          <DirectAnswer updated="August 2026">
            Save or export the artifact as an HTML file, drop it here, and press Save as PDF. Your
            browser&rsquo;s own print dialog writes the PDF, and the file itself is never uploaded
            to HTMLRadar. Scripts, forms and navigation are blocked in the preview, so interactive
            artifacts print as their static layout. The PDF is a frozen copy; the HTML stays the
            version you can send as a tracked link.
          </DirectAnswer>

          <div className="mt-8">
            <HtmlToolPanel tool="claude-artifact-to-pdf" />
          </div>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How it works, in three steps
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>Save or export the artifact as an HTML file.</li>
              <li>Drop that file above. Your browser renders the preview.</li>
              <li>
                Press &ldquo;Save as PDF&rdquo;, then choose Save as PDF as the destination in the
                print dialog your browser opens.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What you get, and what you do not
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              You get the page exactly as your browser lays it out for print. Scripts, forms and
              navigation are blocked in the preview, so an artifact that builds part of itself after
              loading, or that reveals content on a click, prints as its static layout. Long pages
              break across print pages the way the browser decides.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What happens to your file
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              The file itself is never uploaded to HTMLRadar. Your browser reads it, previews it,
              and prints it, and you do not need an account.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              One thing worth knowing: if the HTML references images, fonts or stylesheets on other
              websites, your browser fetches those to render the preview, exactly as it would on any
              web page. Scripts, forms and navigation are blocked in the preview.
            </p>
          </section>

          <Faq items={FAQ} />

          <section className="mt-14 rounded-2xl border border-line bg-paper-2/40 p-6">
            <p className="text-[16px] leading-relaxed text-ink-soft">
              A PDF answers nothing after you send it. On Thursday you still cannot tell whether the
              client read the pricing section or stopped on page two. The same HTML file, sent as a
              tracked link, does answer that: opened at 4pm, four minutes on scope, the pricing
              section read twice. Keep the PDF for whoever asked for one, and{' '}
              <Link
                href="/tools/claude-artifact-to-link"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                send the artifact as a tracked link
              </Link>{' '}
              to the person whose answer you actually need.
            </p>
          </section>

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                HTML file to link
              </Link>{' '}
              and{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                tracking Claude artifacts
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
