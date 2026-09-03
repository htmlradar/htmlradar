// /use-case/client-report-tracking — the answer page for the recurring
// client report: an agency, consultancy or analyst sends the same report
// every month and never learns whether it was read.
//
// Why this page and not another: the buyer question "did the client read
// the report" appears in three independent Reddit threads inside a
// fortnight (r/PPC 1vwyagd, r/AskMarketing 1vz0gl8 and 1vwvtp2, logged in
// MONDAY-CHECK-2026-08-31.md) and Google and Bing autocomplete both return
// "how to share html report" / "how to share an html document". It is the
// one intent bucket A of ICP-AND-CHANNEL-STRATEGY-2026-09-02.md names —
// firms that send client-facing HTML repeatedly — that no page owned.
//
// One intent per page, per the 31 Aug SEO decision. /use-case/proposal-tracking
// owns the one-off proposal, /use-case/pitch-deck-tracking the raise,
// /use-case/track-html-deck any HTML document, /tools/html-to-link the
// transactional "convert this file now". This page owns the recurring
// report and nothing else.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { DashboardMock, type SectionRow } from '@/components/mocks/DashboardMock';
import { EmailNotificationMock } from '@/components/mocks/EmailNotificationMock';
import { ShareStack, type ShareCard } from '@/components/mocks/ShareStack';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

// The same three drawings the rest of the site uses, relabelled for a
// monthly client report. Nothing here is a customer's real data.
const CLIENT_SHARES: ShareCard[] = [
  {
    initial: 'R',
    name: 'Riya',
    org: 'Northbank Retail',
    slug: 'amber-quill-7c40',
    status: 'opened',
  },
  { initial: 'D', name: 'Dan', org: 'Fielder Group', slug: 'slate-harbor-2f19', status: 'live' },
  { initial: 'P', name: 'Priya', org: 'Cove Studios', slug: 'linen-orbit-b581', status: 'pending' },
];

// Section times sum to 6m 06s, inside the 6m 14s active-read total the
// dashboard drawing shows, so the two halves of the same mock agree.
const REPORT_SECTIONS: SectionRow[] = [
  { label: 'What changed', time: '2m 41s', pct: 100, tone: 'signal' },
  { label: 'Spend & results', time: '2m 18s', pct: 86, tone: 'signal' },
  { label: 'Next month', time: '58s', pct: 36, tone: 'signal' },
  { label: 'Method notes', time: '9s', pct: 6, tone: 'soft' },
  { label: 'Appendix', time: '—', pct: 0, tone: 'soft' },
];

export const metadata = pageMeta({
  title: 'Send a Client Report and Know If It Was Read | HTMLRadar',
  description:
    'Send a client report as a tracked web page. See when each client opened it, which sections they read, and for how long. Free for two links, then $15 a month.',
  path: '/use-case/client-report-tracking',
});

export default function ClientReportTrackingPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Client report tracking', url: '/use-case/client-report-tracking' },
            ]}
          />
          <SectionMark>HTMLRadar · Use case</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            How do I send a client report and know if they read it?
          </h1>
          <DirectAnswer updated="September 2026">
            Send the report as a web page behind a private link for each client, not as an
            attachment. HTMLRadar hosts the file, e-mails you the first time a client opens it — at
            the e-mail gate, or after five seconds on an ungated link — and shows which sections
            they read. Free for two tracked links, then $15 a month.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            You send the monthly report on the first. By the tenth nobody has replied, and on the
            call someone asks a question the report answered on page two. An attachment gives you
            nothing to go on, so the honest answer to &ldquo;did they read it?&rdquo; is that you
            have never once known.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              One link per client, reused next month
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Upload the report once, then create a separate link for each client. Every link can
              ask for an e-mail before it opens, carry a password, or expire on a date you set. When
              the engagement ends, revoke the link and the report goes dark — it stops being served,
              not merely hidden. Next month you replace the file rather than send a new link, so
              each client keeps one address all year and you keep one running record of their
              reading.
            </p>
            <div className="mt-6">
              <ShareStack shares={CLIENT_SHARES} />
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              An e-mail the first time a client stays
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              On an ungated link, nothing is recorded until the visit has lasted five seconds, which
              drops quick bounces and most link previews. On a gated link the session starts when
              the client submits their e-mail. Either way you get one e-mail, on the first open,
              carrying the report title and whatever the gate knows about the reader, stamped in
              your own timezone. Opens it recognises as repeats stay silent; you read those off the
              dashboard.
            </p>
            <div className="mt-6">
              <EmailNotificationMock
                subject="riya@northbank.example opened Northbank · August report"
                detail="First open · Sep 04, 09:14 IST · Direct link"
              />
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Which parts of the report they actually read
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A section only accumulates time once it has been at least half on screen for a
              continuous second, so a scroll-past shows as glanced with nothing against it. What is
              left tells you which half of the report is doing the work: nearly three minutes on
              what changed, nine seconds on the method notes. That is what to lead with next month,
              and what to stop writing.
            </p>
            <div className="mt-6">
              <DashboardMock
                title="Northbank · August report"
                recipient="Riya · Northbank Retail"
                sections={REPORT_SECTIONS}
              />
            </div>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What is recorded, and what is not
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Recorded: the e-mail address a client types at the gate if you asked for one, a random
              identifier stored in their browser, session start and active time, how far they
              scrolled, which sections they dwelled on, and coarse metadata — country and city
              derived from the address, browser and device, referrer.
            </p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Not recorded: the raw IP address, keystrokes, mouse positions, session replay, or
              anything at all from outside the document you uploaded. Links on the free tier carry a
              small &ldquo;Powered by HTMLRadar&rdquo; credit; paid links carry none. The full
              detail is on the{' '}
              <Link href="/privacy" className="text-signal-dark hover:underline">
                privacy page
              </Link>
              , and you can{' '}
              <a
                href="https://htmlradar.page/r/lumenforge-demo"
                className="text-signal-dark hover:underline"
              >
                open our public demo report
              </a>{' '}
              to see exactly what a recipient sees before you send one of your own.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'My report is a PDF, not a web page. Does this work?',
                a: 'Not yet — HTMLRadar takes HTML uploads, normally a .html or .htm file, and will not accept a PDF. If the tool that builds your report can export HTML, use that version, and check it on a phone before you send it: exported HTML is not always responsive.',
              },
              {
                q: 'Will the client know the report is being tracked?',
                a: 'Free links show a small "Powered by HTMLRadar" credit; paid links show nothing, so on a paid link there is no visible sign on the document itself. A gated link tells the reader at the gate that reading activity is shared with you. What is measured is reading only, and a reader can opt out by calling window.HTMLRadar.optOut().',
              },
              {
                q: 'What happens when I correct the report after sending it?',
                a: 'Replace the file on the document page. Every link you already sent keeps working and serves the corrected version the next time it is opened, so you never have to send a second e-mail apologising for the first one. Version history records the filename, size and time of every version you upload.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/tools/html-to-link"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Turn your report into a tracked link
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
              <Link href="/use-case/proposal-tracking" className="text-signal-dark hover:underline">
                tracking a client proposal
              </Link>
              ,{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                tracking any HTML document
              </Link>
              , and{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                the open-source DocSend alternative
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
