// /privacy — the public privacy policy. Mirrors docs/privacy.md in the
// repo (the canonical version for self-hosters) but rendered as a
// proper public page in HTMLRadar voice + palette. Linked from every
// page footer. Must stay reachable without sign-in.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import type { Metadata } from 'next';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'How HTMLRadar handles the data it collects. The policy that applies to the hosted version at htmlradar.com.',
};

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <Reveal reveal={false}>
            <SectionMark>HTMLRadar · Hosted service</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[60px]">
              Privacy.
            </h1>
          </Reveal>

          <Reveal reveal={false} delay={0.1}>
            <p className="mt-6 text-[15px] text-graphite">
              How HTMLRadar handles the data it collects. This policy applies to the hosted version
              at htmlradar.com. If you self-host, you own the data and write your own policy.
            </p>
          </Reveal>

          <div className="mt-14 space-y-10 text-[16px] leading-[1.7] text-ink-soft">
            <Section title="What we collect">
              <p>When a recipient opens a tracked share, we record:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>
                  The <strong className="text-ink">email address</strong> they enter at the gate, if
                  the share requires one.
                </li>
                <li>
                  A <strong className="text-ink">random fingerprint</strong> — a UUID we generate
                  and store in their browser's{' '}
                  <code className="font-mono text-[14px] text-signal-dark">localStorage</code>. No
                  cross-site value.
                </li>
                <li>
                  <strong className="text-ink">Session metrics</strong>: start time, total active
                  time, max scroll depth, sections read with dwell.
                </li>
                <li>
                  <strong className="text-ink">Coarse network metadata</strong>: IP-derived country
                  and city (we never store the IP itself), device / OS / browser from the
                  user-agent, referrer URL.
                </li>
              </ul>
              <p className="mt-4">
                We don't collect keystrokes, mouse positions, third-party trackers, anything from
                outside the document, or anything that identifies the recipient beyond the email
                they provided.
              </p>
            </Section>

            <Section title="What we collect when you use the app yourself">
              <p>
                Separately from the share-tracking above, the hosted app records a small amount of
                first-party usage data so we can fix bugs and understand which features get used:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li>
                  <strong className="text-ink">Product events</strong> — when you sign in, upload a
                  document, create or revoke a share, hit the free-tier cap, view the upgrade page,
                  click a CTA, or submit feedback. Stored in a table called{' '}
                  <code className="font-mono text-[14px] text-signal-dark">app_events</code>. Schema
                  is PostHog-compatible — if we wire PostHog later, we'll port this table over.
                </li>
                <li>
                  <strong className="text-ink">Page views</strong> — when your browser loads a page
                  on htmlradar.com. We store the path, referrer, and a random fingerprint
                  (anonymous, generated client-side, never linked to your email unless you're signed
                  in).
                </li>
                <li>
                  <strong className="text-ink">Crash + error reports</strong> — when JavaScript on a
                  page throws an error, we capture the message + stack to a{' '}
                  <code className="font-mono text-[14px] text-signal-dark">error_log</code> table so
                  we can fix it. We do not use Sentry or any third-party error service.
                </li>
                <li>
                  <strong className="text-ink">Feedback</strong> — anything you submit through{' '}
                  <Link
                    href="/feedback"
                    className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                  >
                    /feedback
                  </Link>{' '}
                  is stored in a{' '}
                  <code className="font-mono text-[14px] text-signal-dark">feedback</code> table and
                  emailed directly to the founder. Email field is optional.
                </li>
              </ul>
              <p className="mt-4">
                No third-party trackers (no Google Analytics, no Segment, no Mixpanel). No
                advertising cookies. No session replay.
              </p>
            </Section>

            <Section title="Where data lives">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  Document HTML you upload — Cloudflare R2, encrypted at rest in the region of your
                  bucket.
                </li>
                <li>All other data — Supabase Postgres, encrypted at rest.</li>
              </ul>
            </Section>

            <Section title="Who can see your data">
              <p>
                Only the document owner can see analytics about their shares. Postgres Row Level
                Security enforces this at the database layer — an authenticated user querying
                directly cannot see another user's data.
              </p>
              <p className="mt-3">
                Operators of the hosted service have technical access to the underlying database for
                support and abuse investigation. Access is logged and limited.
              </p>
            </Section>

            <Section title="Data retention">
              <p>
                Sessions and section events are retained for 365 days by default. You can configure
                shorter retention per document. Deleting a document removes all of its sessions,
                section events, and uploaded HTML within 24 hours.
              </p>
            </Section>

            <Section title="Right to delete">
              <p>
                Recipients can have their data removed by emailing{' '}
                <a
                  href="mailto:privacy@htmlradar.com"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  privacy@htmlradar.com
                </a>{' '}
                with their email address. All viewer rows and associated sessions linked to that
                email are removed within 14 days.
              </p>
            </Section>

            <Section title="Opt out">
              <p>
                A recipient can opt out of tracking by calling{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  window.HTMLRadar.optOut()
                </code>{' '}
                in the browser console of any tracked page. The opt-out persists in their
                localStorage and applies to every HTMLRadar link they open in that browser
                afterwards.
              </p>
            </Section>

            <Section title="Cookies">
              <p>
                The hosted service uses session cookies for authentication, set when you sign in.
                Tracked share links may set a temporary cookie when a password is required, scoped
                to that share. No third-party analytics or advertising cookies.
              </p>
            </Section>

            <Section title="Open source">
              <p>
                HTMLRadar is AGPL-3.0 open source. You can audit exactly what the tracker collects
                and how it's transmitted at{' '}
                <a
                  href="https://github.com/htmlradar/htmlradar"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  github.com/htmlradar/htmlradar
                </a>
                .
              </p>
            </Section>

            <Section title="Contact">
              <p>
                <a
                  href="mailto:privacy@htmlradar.com"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  privacy@htmlradar.com
                </a>
              </p>
            </Section>
          </div>

          <div className="mt-20 border-t border-line pt-10">
            <Link
              href="/"
              className="link-slide font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </Link>
          </div>
        </article>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
            <div className="font-mono text-[12px] tracking-wide text-graphite">
              HTML<span className="text-signal">Radar</span>. Document tracking for HTML.
            </div>
            <nav className="flex flex-wrap items-center gap-x-7 gap-y-3 font-mono text-[12px] text-graphite">
              <Link href="/why" className="link-slide hover:text-signal-dark">
                Why this exists
              </Link>
              <Link href="/blog" className="link-slide hover:text-signal-dark">
                Blog
              </Link>
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="link-slide hover:text-signal-dark"
                target="_blank"
                rel="noopener"
              >
                GitHub
              </a>
              <Link href="/pricing" className="link-slide hover:text-signal-dark">
                Pricing
              </Link>
              <Link href="/privacy" className="link-slide hover:text-signal-dark">
                Privacy
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-[24px] leading-snug text-ink md:text-[26px]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
