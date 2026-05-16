// /compare/docsend — SEO target "DocSend alternative" (~5K/mo).
// Honest feature + pricing comparison. AGPL angle as differentiator.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { Check, X } from 'lucide-react';

export const runtime = 'edge';

export const metadata = {
  title: 'HTMLRadar vs DocSend',
  description:
    'A fair comparison of HTMLRadar and DocSend. HTML-first vs PDF-first, AGPL-licensed vs closed-source, $15 flat vs $15 per seat.',
};

interface Row {
  feature: string;
  htmlradar: string | boolean;
  docsend: string | boolean;
  note?: string;
}

const ROWS: Row[] = [
  { feature: 'Source format', htmlradar: 'HTML (upload or URL)', docsend: 'PDF only' },
  { feature: 'Open source', htmlradar: 'AGPL-3.0', docsend: false },
  { feature: 'Self-hosting', htmlradar: 'Full self-host supported', docsend: false },
  { feature: 'Per-recipient share links', htmlradar: true, docsend: true },
  { feature: 'Section-level dwell tracking', htmlradar: true, docsend: 'Scroll depth only' },
  {
    feature: 'Real-time read notifications',
    htmlradar: 'Email on first dwell threshold',
    docsend: 'Email on open',
  },
  { feature: 'Password gating', htmlradar: true, docsend: true },
  { feature: 'Email gating', htmlradar: true, docsend: true },
  { feature: 'Domain allow-list', htmlradar: true, docsend: 'Enterprise only' },
  { feature: 'Custom share domain', htmlradar: 'Pro tier ($15/mo)', docsend: 'Enterprise tier' },
  {
    feature: 'Pricing model',
    htmlradar: '$15/mo flat OR free self-host',
    docsend: '$15-$45 per seat per month',
  },
  {
    feature: 'Free tier',
    htmlradar: '10 documents lifetime, unlimited reads',
    docsend: '14-day trial',
  },
  {
    feature: 'API for programmatic shares',
    htmlradar: 'Polar webhook flow',
    docsend: 'Enterprise API',
  },
  { feature: 'Privacy: no third-party tracking on viewer side', htmlradar: true, docsend: false },
  { feature: 'License audit (you can read the tracker code)', htmlradar: true, docsend: false },
];

function Cell({ v }: { v: string | boolean }) {
  if (v === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-signal-dark">
        <Check className="size-4" aria-hidden /> Yes
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-graphite">
        <X className="size-4" aria-hidden /> No
      </span>
    );
  }
  return <span className="text-ink">{v}</span>;
}

export default function ComparePage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            HTMLRadar vs DocSend.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            DocSend is the category leader for document tracking. We built HTMLRadar because DocSend
            is closed-source, PDF-only, and bills per seat. If those three things matter to you,
            this comparison matters. If they don't, DocSend is fine.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The headline difference
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  HTMLRadar
                </h3>
                <p className="mt-3 font-serif text-[20px] leading-snug text-ink">
                  HTML-first, open source, $15/mo flat.
                </p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
                  Track HTML decks from Pitch.com, Tome, Gamma, or hand-rolled HTML. Self-host the
                  whole thing or use the hosted plan. AGPLv3.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  DocSend
                </h3>
                <p className="mt-3 font-serif text-[20px] leading-snug text-ink">
                  PDF-first, closed source, $15-45 per seat.
                </p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
                  Decade-old category leader, polished UX, deep enterprise feature set. Owned by
                  Dropbox. If your team is on a Dropbox Business plan already, DocSend is included.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Feature by feature
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Feature</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">DocSend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROWS.map((r) => (
                    <tr key={r.feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{r.feature}</td>
                      <td className="px-5 py-3.5 align-top">
                        <Cell v={r.htmlradar} />
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <Cell v={r.docsend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When DocSend is the right choice
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                Your team is on Dropbox Business. DocSend is bundled; effective cost approaches
                zero.
              </li>
              <li>You only send PDFs and have no intent to switch to HTML decks.</li>
              <li>
                You need enterprise features like virtual data rooms, eSignature integration, or
                SSO. HTMLRadar v1.0 doesn't have these; v1.x is a backlog item.
              </li>
              <li>
                You prefer not to think about open source licensing or self-hosting at all. Fair.
              </li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When HTMLRadar is the right choice
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                You send HTML decks (Pitch.com exports, Tome, Gamma, hand-rolled) and don't want to
                PDFify them just to track.
              </li>
              <li>You bill per-seat allergies. $15/mo flat scales with usage, not headcount.</li>
              <li>
                You self-host because the tracker code reading rights, the data-locality rights, or
                the no-vendor-dependence rights matter to your business.
              </li>
              <li>
                You're an indie founder or small team where DocSend's lowest plan ($15/seat for
                three seats = $45/mo) is more than the flat rate.
              </li>
              <li>
                You want section-level dwell time, not just scroll depth. Knowing the recipient
                spent 4 minutes on the Ask slide is materially different from knowing they scrolled
                to 80%.
              </li>
            </ul>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Migrating from DocSend
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              DocSend exports your existing tracked PDFs via their UI. We don't import them directly
              because the formats differ. For new HTML decks you create after switching, the flow
              is: export your deck as HTML (Pitch.com → File → Export HTML; or hand-write), upload
              to HTMLRadar, create per-recipient share links. The same tracking happens, on a
              different file type.
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
              If you need help with the cutover, email{' '}
              <a
                href="mailto:hello@htmlradar.com"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                hello@htmlradar.com
              </a>{' '}
              and we'll walk through it. Free.
            </p>
          </section>

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Try HTMLRadar free
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 10 documents free. No credit card. AGPLv3 source on{' '}
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
