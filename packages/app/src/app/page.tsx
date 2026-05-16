// Landing page. Server-rendered, animations are pure CSS via Reveal.

import Link from 'next/link';
import { serverClient } from '@/lib/supabase-server';
import { NavBar } from '@/components/NavBar';
import { Reveal } from '@/components/Reveal';
import { ScrollProgress } from '@/components/ScrollProgress';
import { CursorGlow } from '@/components/CursorGlow';
import { HeroRadar } from '@/components/HeroRadar';
import { SectionMark } from '@/components/SectionMark';
import { DashboardMock } from '@/components/mocks/DashboardMock';
import { ShareStack } from '@/components/mocks/ShareStack';
import { VersionSwap } from '@/components/mocks/VersionSwap';
import { DwellThreshold } from '@/components/mocks/DwellThreshold';
import { EmailNotificationMock } from '@/components/mocks/EmailNotificationMock';
import { RecipientFlow } from '@/components/mocks/RecipientFlow';
import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

export const runtime = 'edge';

export default async function LandingPage() {
  // Read the session once at the top so the hero + close-block CTAs can
  // route authed users straight to /docs. Without this, clicking "Start
  // free" while already signed in kicks Supabase through a fresh OAuth
  // round-trip whose PKCE verifier doesn't match the live session — that's
  // the source of the "We couldn't complete the sign-in" callback error
  // the gf hit when re-clicking the CTA after signing in.
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthed = !!user;

  return (
    <>
      <NavBar />
      <ScrollProgress />
      <main className="relative overflow-x-clip">
        <CursorGlow />
        <Hero isAuthed={isAuthed} />
        <WhyThisExists />
        <TheMoment />
        <WhatWeBuilt />
        <WhatRecipientSees />
        <OpenSource />
        <Close isAuthed={isAuthed} />
        <Footer />
      </main>
    </>
  );
}

/* --------------------------------- Hero --------------------------------- */

function Hero({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* radial bloom — barely perceptible warmth seated under the hero */}
      <div aria-hidden className="hero-bloom pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-6xl px-6 pb-28 pt-20 md:pb-36 md:pt-28">
        {/* Watermark radar — visible on small + tablet, faded behind the
            headline. Replaced by the large right-column radar on lg+. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-2 top-12 opacity-60 sm:right-4 sm:top-16 lg:hidden"
        >
          <HeroRadar size={200} />
        </div>

        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.25fr_1fr] lg:gap-10">
          <div className="relative">
            <Reveal reveal={false}>
              <SectionMark>Open source. AGPL-3.0.</SectionMark>
            </Reveal>

            <Reveal reveal={false} delay={0.05}>
              <h1 className="text-letterpress mt-8 max-w-[16ch] font-serif text-[44px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[78px]">
                Decks moved to HTML.
                <br />
                <span
                  className="italic text-signal"
                  style={{ fontVariationSettings: '"opsz" 144' }}
                >
                  Tracking should follow.
                </span>
              </h1>
            </Reveal>

            <Reveal reveal={false} delay={0.15}>
              <p className="mt-8 max-w-[34rem] text-[19px] leading-relaxed text-ink-soft">
                HTMLRadar is read tracking for the documents your work actually produces now — pitch
                decks, design mocks, reports, investor updates. Upload a file or paste a URL, send a
                tracked link, see who opened it and where they dwelled.
              </p>
            </Reveal>

            <Reveal reveal={false} delay={0.22}>
              <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
                <Link
                  href={isAuthed ? '/docs' : '/sign-in'}
                  data-cta={isAuthed ? 'hero.open_dashboard' : 'hero.start_free'}
                  className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
                >
                  {isAuthed ? 'Open dashboard' : 'Start free'}
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="#the-moment"
                  className="link-slide inline-flex items-center gap-1.5 py-2 text-[15px] text-ink-soft hover:text-signal-dark"
                >
                  See it work
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </Reveal>

            <Reveal reveal={false} delay={0.3}>
              <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                No card needed. Open source under AGPL-3.0.
              </p>
            </Reveal>
          </div>

          {/* Right column — signature radar + a small mono readout
              beneath. Reads as an instrument panel rather than a stock
              illustration. Hidden on small screens, full on lg+. */}
          <div className="pointer-events-none relative hidden h-[460px] flex-col items-center justify-center lg:flex">
            <HeroRadar size={420} className="text-signal" />
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-graphite">
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-signal/60" />
                <span className="relative size-1.5 rounded-full bg-signal" />
              </span>
              Tracker · 14&nbsp;KB · Live
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto h-px max-w-6xl bg-gradient-to-r from-transparent via-line to-transparent" />
    </section>
  );
}

/* ----------------------------- Why this exists -------------------------- */

function WhyThisExists() {
  return (
    <section id="why" className="relative">
      <div className="mx-auto max-w-3xl px-6 py-24 md:py-32">
        <Reveal>
          <SectionMark>02 · The shift</SectionMark>
        </Reveal>

        <Reveal delay={0.06}>
          <p className="text-letterpress mt-8 font-serif text-[28px] leading-[1.25] text-ink md:text-[34px]">
            For two decades, the documents that mattered ended in .pdf. Investor decks, briefs,
            board updates, research reports. Now they end in .html. The piece nobody built was the
            one that tells you what happened after the link went out.
          </p>
        </Reveal>

        <Reveal delay={0.14}>
          <Link
            href="/why"
            className="mt-10 inline-flex items-center gap-1.5 text-[14px] text-ink-soft underline decoration-line decoration-2 underline-offset-[6px] transition hover:text-signal-dark hover:decoration-signal"
          >
            More on why this exists
            <ArrowRight className="size-3.5" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------ The Moment ------------------------------ */

function TheMoment() {
  return (
    <section id="the-moment" className="relative bg-paper-2/55">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <Reveal>
          <SectionMark>03 · The moment</SectionMark>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-16 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <Reveal delay={0.1}>
            <DashboardMock />
          </Reveal>

          <Reveal delay={0.2}>
            <div className="space-y-9 lg:pl-2">
              <EmailNotificationMock variant="card" />
              <figure>
                <blockquote className="text-letterpress relative font-serif text-[24px] leading-snug text-ink md:text-[28px]">
                  <span aria-hidden className="absolute -left-3 top-0 text-graphite">
                    "
                  </span>
                  Marc at Example Ventures opened it three times. Spent{' '}
                  <em className="not-italic text-signal-dark">6m 14s.</em> Read the Ask, Team, and
                  Traction sections. Skipped Market sizing.
                  <span aria-hidden className="text-graphite">
                    "
                  </span>
                </blockquote>
                <figcaption className="mt-5 max-w-sm text-[14.5px] leading-relaxed text-ink-soft">
                  Most analytics tell you that someone opened it. HTMLRadar tells you which sentence
                  convinced them.
                </figcaption>
              </figure>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- What it does ---------------------------- */

// Inline mock for the new "Supporting materials" landing-page claim.
// Renders a static preview of the recipient's Materials pill + expanded
// panel from the proxy injection. Pure markup; the real version in
// packages/proxy/src/inject.ts materialsPanel() is what ships to
// recipients. This is the marketing-page mirror.
function MaterialsPanelMock() {
  return (
    <div className="relative mx-auto max-w-[360px] rounded-2xl border border-line bg-paper p-5 shadow-[0_18px_40px_-30px_rgba(31,17,8,0.18)]">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-graphite">
          Supporting materials
        </span>
        <span className="font-mono text-[10.5px] text-graphite">×</span>
      </div>
      <ul className="space-y-1 pt-2 text-[13.5px]">
        {[
          { name: 'Series A Deck.pdf', meta: 'PDF · 3.4 MB' },
          { name: 'Cap Table v3.xlsx', meta: 'XLSX · 88 KB' },
          { name: 'Product Demo.png', meta: 'PNG · 412 KB' },
        ].map((f) => (
          <li
            key={f.name}
            className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-paper-2/60"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{f.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
                {f.meta}
              </div>
            </div>
            <span className="ml-3 text-signal" aria-hidden>
              ↓
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
        Shared via HTMLRadar · every download tracked
      </div>
    </div>
  );
}

function WhatWeBuilt() {
  // Four product claims. Each rendered alongside its own mock in an
  // alternating layout (text-left/mock-right, then mock-left/text-right).
  // Voice: contractions, specifics, no meta-headline.
  const claims: {
    num: string;
    title: string;
    body: string;
    mock: ReactNode;
  }[] = [
    {
      num: '01',
      title: 'Each recipient gets a unique link.',
      body: 'One document, many shares. Each share carries its own email gate, password, expiry, and revocation. The dashboard tells you which one Marc opened, not "someone opened it."',
      mock: <ShareStack />,
    },
    {
      num: '02',
      title: 'Replace the HTML, keep the link.',
      body: "Re-upload after partner feedback. Every share you've already sent now points at v2. No re-sending. No broken URLs in inboxes.",
      mock: <VersionSwap />,
    },
    {
      num: '03',
      title: 'Read, not "opened."',
      body: "A three-second dwell threshold separates a real read from a scroll-past. Most analytics count both. HTMLRadar doesn't.",
      mock: <DwellThreshold />,
    },
    {
      num: '04',
      title: 'Send the deck. Attach the diligence.',
      body: 'Supporting materials live alongside the HTML. Toggle "Allow downloads" per share to decide whether this recipient sees a Materials panel or not — when it’s off, they don’t even know files exist. Every download is logged with the recipient’s email and the moment it happened.',
      mock: <MaterialsPanelMock />,
    },
  ];

  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <Reveal>
          <SectionMark>04 · What it does</SectionMark>
        </Reveal>

        <div className="mt-14 space-y-20 md:space-y-24">
          {claims.map((c, i) => {
            const mockFirst = i % 2 === 1;
            return (
              <Reveal key={c.num} delay={0.06}>
                <article className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div className={mockFirst ? 'lg:order-2' : ''}>
                    <h3 className="text-letterpress font-serif text-2xl leading-snug text-ink md:text-[32px]">
                      {c.title}
                    </h3>
                    <p className="mt-5 max-w-prose text-[16px] leading-relaxed text-ink-soft">
                      {c.body}
                    </p>
                  </div>
                  <div className={mockFirst ? 'lg:order-1' : ''}>{c.mock}</div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------ What the recipient sees ----------------------- */

function WhatRecipientSees() {
  return (
    <section className="relative bg-paper-2/55">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <Reveal>
          <SectionMark>05 · The loop</SectionMark>
        </Reveal>

        <Reveal delay={0.06}>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Three frames. The sender's notification fires. The recipient lands at the email gate.
            The document renders. Each frame is real product output, not a slide.
          </p>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-14">
            <RecipientFlow />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------- Open source ------------------------------ */

function OpenSource() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
        <Reveal>
          <SectionMark>06 · Open source</SectionMark>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <Reveal delay={0.05}>
            <h2 className="text-letterpress font-serif text-4xl leading-[1.1] tracking-tight text-ink md:text-[52px]">
              Open source under <span className="italic text-signal">AGPL-3.0.</span>
            </h2>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="text-[16px] leading-relaxed text-ink-soft">
              The tracker, the proxy worker, the schema, the web app — all of it lives on{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                GitHub
              </a>
              . The hosted version at htmlradar.com is for people who'd rather not run their own
              Cloudflare and Supabase. Both options run the same code.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Close --------------------------------- */

function Close({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <Reveal>
          <div className="text-center">
            <SectionMark>07</SectionMark>
            <h2 className="text-letterpress mx-auto mt-8 max-w-4xl text-balance font-serif text-[40px] font-normal leading-[1.12] tracking-tightest text-ink md:text-[60px]">
              Sign in. Drop the HTML. Send the link.
              <br />
              <span className="italic text-signal">
                An email lands the moment a real read happens.
              </span>
            </h2>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
              <Link
                href={isAuthed ? '/docs' : '/sign-in'}
                data-cta={isAuthed ? 'close.open_dashboard' : 'close.start_free'}
                className="group inline-flex items-center gap-2 rounded-md bg-signal px-7 py-3.5 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
              >
                {isAuthed ? 'Open dashboard' : 'Start free'}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="inline-flex items-center gap-1.5 text-[15px] text-ink-soft underline decoration-line decoration-2 underline-offset-[6px] transition hover:text-signal-dark hover:decoration-signal"
              >
                Read the source
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------- Footer -------------------------------- */

function Footer() {
  return (
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
  );
}
