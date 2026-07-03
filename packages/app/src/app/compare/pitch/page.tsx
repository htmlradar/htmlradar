// /compare/pitch — SEO target for users who already make decks in Pitch.com
// and want to track those decks. We don't compete with Pitch; we complement it.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';

export const runtime = 'edge';

export const metadata = {
  title: 'HTMLRadar for Pitch.com decks',
  description:
    'How to track a Pitch deck without exporting to PDF: export Pitch to HTML, upload to HTMLRadar, share a tracked link. Real-time section dwell, not just open notifications.',
  alternates: { canonical: 'https://htmlradar.com/compare/pitch' },
};

export default function PitchPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar for Pitch.com decks', url: '/compare/pitch' },
            ]}
          />
          <SectionMark>HTMLRadar · For Pitch.com</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Track a Pitch deck without PDFifying it.
          </h1>
          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-soft">
            Pitch.com makes beautiful decks. Pitch's built-in sharing tells you when someone opens
            the deck but not which slides they actually read. HTMLRadar fills that gap without
            asking you to leave Pitch.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
              The 3-step flow
            </h2>
            <ol className="mt-5 space-y-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                <strong className="text-ink">Export your Pitch deck as HTML.</strong> In Pitch, hit{' '}
                File → Export → HTML. You get a single index.html with embedded assets. (Or point
                HTMLRadar at the live Pitch share URL directly; the proxy fetches and injects
                without you re-uploading.)
              </li>
              <li>
                <strong className="text-ink">Upload to HTMLRadar.</strong> Drop the HTML into{' '}
                <code className="font-mono text-[14px] text-signal-dark">htmlradar.com/new</code> or
                paste the Pitch URL. Give it a title.
              </li>
              <li>
                <strong className="text-ink">Create per-recipient share links.</strong> One link per
                investor, partner, customer. The reader opens; HTMLRadar tracks dwell per slide; you
                get an email the moment they actually start reading.
              </li>
            </ol>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
              What Pitch already does well
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>Real-time collaborative editing. Polished. Best-in-class.</li>
              <li>Built-in templates that look genuinely good.</li>
              <li>Sharing a deck via a Pitch link — fine for casual sends.</li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
              What HTMLRadar adds
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                Per-recipient links (Pitch's link is one URL for all readers; you can't tell who
                opened).
              </li>
              <li>
                Slide-by-slide dwell time. Pitch tells you someone opened; HTMLRadar tells you they
                spent 4 minutes on the Ask slide and 0 seconds on Market Sizing.
              </li>
              <li>
                Real-time read notifications. Email the moment the recipient crosses the dwell
                threshold.
              </li>
              <li>Email gates, password gates, expiry, allow-list by domain.</li>
              <li>
                Same domain hosted version. Removes the "shared via tool you've never heard of"
                signal.
              </li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">Pricing</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Free for your first 2 tracked links on the hosted plan. $15/mo flat for unlimited
              links, custom share domains, and a removed HTMLRadar footer. Or self-host the whole
              thing under AGPLv3, no cost.
            </p>
          </section>

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Try it on your next Pitch deck
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 2 tracked links free. No credit card. Source at{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                github.com/htmlradar/htmlradar
              </a>
              .
            </p>
          </section>

          <div className="mt-20 border-t border-line pt-10">
            <Link
              href="/"
              className="link-slide font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </Link>
          </div>
        </article>
      </main>
    </>
  );
}
