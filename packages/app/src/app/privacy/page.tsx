// /privacy — the public policy for the hosted service, rendered in the
// HTMLRadar voice + palette. Linked from every page footer and reachable
// without sign-in.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';

export const dynamic = 'force-static';

export const metadata = pageMeta({
  title: 'Privacy Policy | HTMLRadar',
  description:
    'How HTMLRadar handles the data it collects. The policy that applies to the hosted version at htmlradar.com.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <Reveal reveal={false}>
            <SectionMark>HTMLRadar · Hosted service</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
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
              <p className="mt-4">
                Recipient documents are served from a separate domain, htmlradar.page, which shares
                no cookies or browser storage with htmlradar.com, and old htmlradar.com links
                redirect there automatically.
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
                  <code className="font-mono text-[14px] text-signal-dark">app_events</code>. The
                  monitor worker replays these first-party events to PostHog server-side for product
                  analytics. Your account email is added to your PostHog user profile after sign-in.
                  Owner-scoped share events can include a first open, gate outcome, country, device,
                  or email domain, but not a recipient's raw email address. The browser does not
                  load a PostHog script.
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
                No third-party tracking scripts. No third-party cookies for analytics or
                advertising. No session replay.
              </p>
            </Section>

            <Section title="Where data lives">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  Document HTML you upload — Cloudflare R2, encrypted at rest in the region of your
                  bucket.
                </li>
                <li>Primary application data — Supabase Postgres, encrypted at rest.</li>
                <li>
                  Product analytics events — PostHog, sent server-side from the monitor worker.
                </li>
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
                Sessions and section events are currently retained indefinitely. Permanently
                deleting an individual share removes its viewers, sessions, section events, and
                attachment-download records from Supabase immediately. The in-app Delete document
                action archives the document: it removes document and share access, but retains the
                database rows and uploaded HTML for recovery.
              </p>
            </Section>

            <Section title="Right to delete">
              <p>
                Recipients and account holders can request permanent deletion by emailing{' '}
                <a
                  href="mailto:privacy@htmlradar.com"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  privacy@htmlradar.com
                </a>
                . Include the email address tied to the data and, for account holders, the affected
                document. We complete verified requests within 14 days, including matching data in
                Supabase, R2, and PostHog where applicable.
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
                to that share. We do not use third-party cookies for analytics or advertising.
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
        </article>
      </main>
      <V2Footer />
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
