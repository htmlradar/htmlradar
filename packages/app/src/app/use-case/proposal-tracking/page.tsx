// /use-case/proposal-tracking — agencies/consultants sending recurring
// client proposals.
// Queries: "proposal tracking", "know when client opens proposal",
// "track proposal open".

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { DashboardMock, type SectionRow } from '@/components/mocks/DashboardMock';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

// The same dashboard drawing, labelled for a proposal instead of a deck.
const PROPOSAL_SECTIONS: SectionRow[] = [
  { label: 'Pricing', time: '4m 06s', pct: 100, tone: 'signal' },
  { label: 'Scope', time: '3m 41s', pct: 90, tone: 'signal' },
  { label: 'Timeline', time: '1m 12s', pct: 29, tone: 'signal' },
  { label: 'Team', time: '18s', pct: 7, tone: 'soft' },
  { label: 'Case studies', time: '—', pct: 0, tone: 'soft' },
];

export const metadata = pageMeta({
  title: 'Client Proposal Tracking — Know When It’s Read | HTMLRadar',
  description:
    'Send proposals as tracked links. See when each client opens it, which sections they read — scope, timeline, pricing — and when to follow up. Free to start.',
  path: '/use-case/proposal-tracking',
});

export default function ProposalTrackingPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Proposal tracking', url: '/use-case/proposal-tracking' },
            ]}
          />
          <SectionMark>HTMLRadar · Use case</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Know the moment your proposal gets read.
          </h1>
          <DirectAnswer updated="August 2026">
            Proposal tracking emails you on the first real read — five seconds on the page, not a
            bounce — then shows which sections the client read and where they paused. HTMLRadar does
            this for proposals sent as HTML: a private link per client, an email gate if you want
            names, and a section-by-section read report to time your follow-up. Free for two tracked
            links.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            You sent the proposal Tuesday. It&apos;s Friday. Do you follow up — or is that pushy?
            Proposal tracking replaces that guess with a read report, and the read report tells you
            which morning to write. That&apos;s not pushy; that&apos;s well-timed.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              One proposal, one link per client
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Upload the proposal once, then create a separate tracked link per recipient — the
              client, their finance lead, the partner who actually decides. Each link has its own
              gate: require an email, set a password, restrict to their company&apos;s email domain,
              or set an expiry. When the engagement closes (or goes cold), revoke the link and the
              document goes dark.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              See which sections did the selling
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Reads are measured per section, with a three-second floor so a scroll-past
              doesn&apos;t count.
            </p>
            {/* The paragraph that used to run here read this panel out in words —
                which section got five minutes, which got thirty seconds. */}
            <div className="mt-6">
              <DashboardMock
                title="Acme · Statement of work"
                recipient="Dana · Acme Operations"
                sections={PROPOSAL_SECTIONS}
              />
            </div>
            <p className="mt-6 text-[16px] leading-relaxed text-ink-soft">
              You also see who inside the client&apos;s team the link was forwarded to. An email
              lands on the first real read, so the follow-up window never slips past you.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The SOW and the spreadsheet travel with it
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Attach the contract PDF, the pricing model, the reference deck — recipients get them
              in a quiet corner drawer on the proposal itself, and every download is logged per
              viewer. Revise the proposal after a call and replace the file: the links you already
              sent serve the new version automatically.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why HTML proposals?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Because that&apos;s what your tools produce now. Proposals drafted with Claude or
              ChatGPT, formatted as clean HTML pages, read beautifully on the client&apos;s phone —
              where a wide PDF makes them pinch and zoom. If you still need a file for procurement,
              attach the PDF; the tracked link stays the front door.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Will the client know the proposal is tracked?',
                a: 'Free-tier links carry a small "Powered by HTMLRadar" badge; the proposal itself is untouched. The tracking is read analytics only — section dwell, scroll depth, active time. No mouse tracking, no keystrokes, no session replay, and recipients can opt out.',
              },
              {
                q: 'Can I stop a proposal from being shared around?',
                a: 'Per-link gates help: require the recipient’s email, allow-list their domain, or password the link. If it leaks anyway, you see every viewer and can revoke the link in one click — it stops working immediately.',
              },
              {
                q: 'What happens when I update the proposal after feedback?',
                a: 'Replace the file. Every link you already sent serves the new version on next open, and version history keeps a record of what changed and when.',
              },
              {
                q: 'Do I need the client to sign in or install anything?',
                a: 'No. The link opens in any browser. At most, the client types their email if you gated the link that way.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track your next proposal free
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
              <Link
                href="/use-case/pitch-deck-tracking"
                className="text-signal-dark hover:underline"
              >
                pitch deck tracking for founders
              </Link>
              ,{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                the open-source DocSend alternative
              </Link>
              ,{' '}
              <Link
                href="/use-case/client-report-tracking"
                className="text-signal-dark hover:underline"
              >
                tracking a recurring client report
              </Link>
              , and{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track any HTML document
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
