// HTMLRadar landing v2 — adapted from the reference + the v1
// landing's stronger positioning beats pulled forward.
//
// Sections in order:
//   1. Hero — v1's "Decks moved to HTML. Tracking should follow." positioning.
//   2. The shift — manifesto paragraph (PDF→HTML) with a small chip
//      transition visual at the bottom.
//   3. Pitch — Marc/Seed Deck card + notification + pull-quote ("which
//      sentence convinced them").
//   4. Workflow — three-step diagram with animated packet flowing
//      through dotted connectors (replaces the buggy horizontal swiper).
//   5. What it does — four specific claims (per-share / versioning /
//      dwell-threshold / attachments).
//   6. Controls — 5-item grid with auto-demo cycling.
//   7. Open source — v1's specific Cloudflare/Supabase phrasing.
//   8. CTA — v1's "An email lands the moment a real read happens."
//   9. Footer.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { SoftwareApplicationLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';
import { LandingEffects } from './LandingEffects';
import { AuthLink, AuthText } from './AuthCta';
import './landing-v2.css';

export const metadata = pageMeta({
  title: 'Track an HTML Document — See Who Read It | HTMLRadar',
  description:
    'Send any HTML deck, brief, or proposal as a tracked link. See who opened it, which sections they read, and how long they stayed. Open-source. Free to start.',
  path: '/',
});

// Statically prerendered (no edge SSR — that was the source of the
// cold-start 1102 errors). force-static is explicit because the app's
// middleware matcher otherwise makes Next treat this route as dynamic;
// this page has zero per-request data (auth moved client-side to
// <AuthLink>/<AuthText>), so prerendering is correct.
export const dynamic = 'force-static';

// ─── Use-cases mocks ──────────────────────────────────────────────
// High-fidelity per-case document previews. Mirror the detail level
// of the reference (Sales Proposal / Pitch Deck / Board
// Pre-Read), scaled to fit a ~280px-wide card.

function CaseChrome({ filename, children }: { filename: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#FBF6E9]">
      <div className="flex items-center gap-1.5 border-b border-line/70 bg-paper-2/40 px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-[#E5A1A1]" />
        <span className="size-1.5 rounded-full bg-[#E5C68A]" />
        <span className="size-1.5 rounded-full bg-[#A3CFA1]" />
        <span className="ml-1 truncate font-mono text-[9.5px] tracking-tight text-graphite">
          {filename}
        </span>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function PitchDeckMock() {
  return (
    <CaseChrome filename="aurora-seed.html · data-room">
      {/* Dark deck canvas */}
      <div className="relative overflow-hidden rounded-[8px] bg-gradient-to-br from-ink to-[#1a0e09] p-3 text-paper">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(217,181,176,0.18)_0%,transparent_45%),radial-gradient(circle_at_5%_95%,rgba(122,31,46,0.4)_0%,transparent_50%)]"
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-mono text-[7.5px] font-bold uppercase tracking-[0.22em] text-paper/55">
              <span className="size-1 rounded-full bg-signal-soft" />
              Aurora
            </span>
            <span className="font-mono text-[7.5px] tracking-[0.16em] text-paper/45">
              <span className="font-bold text-signal-soft">07</span> / 18
            </span>
          </div>
          <div className="mt-2 font-mono text-[7.5px] uppercase tracking-[0.22em] text-signal-soft">
            The Ask
          </div>
          <div className="mt-0.5 font-serif text-[18px] font-bold leading-[1.05] tracking-tight">
            Raising <em className="not-italic font-semibold text-signal-soft">$2.4M</em>
            <br />
            to close 2026.
          </div>
          <div className="mt-2 flex gap-3">
            {[
              ['ARR', '$840K'],
              ['YoY', '3.1×'],
              ['NRR', '142%'],
              ['Runway', '14mo'],
            ].map(([k, v]) => (
              <div key={k as string}>
                <div className="font-mono text-[6.5px] uppercase tracking-[0.18em] text-paper/45">
                  {k}
                </div>
                <div className="font-serif text-[11px] font-semibold leading-none">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Thumb strip */}
      <div className="mt-2 grid grid-cols-6 gap-1">
        {['01', '02', '03', '04', '05', '07'].map((n, i) => {
          const isCurrent = i === 5;
          return (
            <div
              key={n}
              className={`aspect-[16/9] rounded-[3px] border ${isCurrent ? 'border-ink bg-ink' : 'border-line bg-paper-2/60'}`}
            >
              <div className={`m-1 h-[1px] ${isCurrent ? 'bg-signal-soft' : 'bg-graphite/40'}`} />
              <div
                className={`m-1 -mt-0.5 h-[1px] w-[60%] ${isCurrent ? 'bg-signal-soft/70' : 'bg-graphite/25'}`}
              />
            </div>
          );
        })}
      </div>
      {/* File rows */}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[
          ['Financial model.xlsx', '3m 04s'],
          ['Cap table.pdf', '2.1s'],
        ].map(([name, ts]) => (
          <div
            key={name as string}
            className="flex items-center gap-1.5 rounded-md border border-line bg-paper-2/40 px-2 py-1"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-2.5 shrink-0 text-graphite"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="flex-1 truncate text-[9px] font-medium text-ink">{name}</span>
            <span className="font-mono text-[8px] font-bold text-signal">{ts}</span>
          </div>
        ))}
      </div>
    </CaseChrome>
  );
}

function ProposalMock() {
  return (
    <CaseChrome filename="aurora-proposal.html · v2">
      <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-2">
        <div>
          <div className="font-mono text-[7.5px] font-bold uppercase tracking-[0.22em] text-signal">
            Sales Proposal
          </div>
          <div className="mt-0.5 font-mono text-[8.5px] tracking-[0.06em] text-graphite">
            № AUR-2026-014
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[7px] uppercase tracking-[0.16em] text-graphite">
            Valid until
          </div>
          <div className="font-serif text-[10px] font-semibold leading-none text-ink">
            Jan 24, 2026
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[
          ['From', 'Aurora Studio', 'Maya Chen · Partner'],
          ['Prepared for', 'Northwind & Co.', 'Daniel Park · Growth'],
        ].map(([label, name, sub]) => (
          <div key={label as string} className="rounded-md border border-line bg-paper-2/40 p-1.5">
            <div className="font-mono text-[7px] uppercase tracking-[0.16em] text-graphite">
              {label}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold leading-tight text-ink">{name}</div>
            <div className="text-[8.5px] text-ink-soft">{sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {[
          ['Discovery, audit & retention map', 'Wk 1–2'],
          ['Cohort dashboards & activation', 'Wk 3–6'],
          ['Rollout, training & handoff', 'Wk 7–12'],
        ].map(([item, wk]) => (
          <div
            key={item as string}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-md border border-line bg-paper-2/40 px-2 py-1"
          >
            <span className="grid size-3 place-items-center rounded-full bg-signal text-signal-soft">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="size-1.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="text-[9px] font-medium text-ink">{item}</span>
            <span className="font-mono text-[7px] uppercase tracking-[0.08em] text-graphite">
              {wk}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg bg-ink px-2.5 py-2 text-paper">
        <div>
          <div className="font-mono text-[7px] uppercase tracking-[0.18em] text-signal-soft">
            Total fee · fixed
          </div>
        </div>
        <div className="font-serif text-[18px] font-bold leading-none tracking-tight">
          $42,000
          <span className="ml-1 font-sans text-[8px] font-normal text-paper/55">USD</span>
        </div>
      </div>
    </CaseChrome>
  );
}

function BoardPrepMock() {
  return (
    <CaseChrome filename="board-prep-mar-14.html · confidential">
      <div className="flex items-center justify-between font-mono text-[7.5px] font-bold uppercase tracking-[0.16em] text-graphite">
        <span className="inline-flex items-center gap-1 text-signal">
          <span className="size-1 rounded-full bg-signal" />
          Friday · Mar 14
        </span>
        <span>Pre-read · 9 pages</span>
      </div>
      <div className="mt-1.5 font-serif text-[16px] font-bold leading-[1.05] tracking-tight text-ink">
        The five things we&apos;ll
        <br />
        cover <em className="not-italic text-signal">Friday</em>.
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[
          ['On agenda', '5', '90-min call'],
          ['Decisions', '2', 'Vote required'],
          ['Open risks', '1', 'Flagged red'],
        ].map(([k, v, sub]) => (
          <div key={k as string} className="rounded-md border border-line bg-paper-2/40 p-1.5">
            <div className="font-mono text-[6.5px] font-bold uppercase tracking-[0.14em] text-graphite">
              {k}
            </div>
            <div className="font-serif text-[14px] font-semibold leading-none text-ink">{v}</div>
            <div className="mt-0.5 font-mono text-[6.5px] font-semibold text-signal">{sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {[
          ['#1F7A3A', 'CEO opening · Q1 narrative', '15 min'],
          ['#D9A04A', '2026 hiring plan', '25 min'],
          ['#7A1F2E', 'Enterprise GTM · debate', '20 min'],
        ].map(([color, label, tag]) => (
          <div
            key={label as string}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-md border border-line bg-paper-2/40 px-2 py-1"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: color as string }}
            />
            <span className="text-[9px] font-medium text-ink">{label}</span>
            <span className="font-mono text-[7px] uppercase tracking-[0.08em] text-graphite">
              {tag}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-1.5 font-mono text-[7px] uppercase tracking-[0.14em] text-graphite">
        <span className="inline-flex items-center gap-1.5 text-ink">
          <span className="grid size-3.5 place-items-center rounded-full bg-signal text-signal-soft font-serif text-[8px] font-semibold tracking-tight normal-case">
            J
          </span>
          Jules Kim · CEO
        </span>
        <span>Sent Tue 6:02 PM</span>
      </div>
    </CaseChrome>
  );
}

const USE_CASES: Array<{
  n: string;
  title: string;
  body: string;
  mock: ReactNode;
  caseKey: string;
}> = [
  {
    n: '01',
    title: 'Pitch Decks & Investor Data Rooms',
    body: 'Per-investor links. See which slide they replayed, which model they downloaded, where the deck lost them.',
    mock: <PitchDeckMock />,
    caseKey: 'pitch-deck',
  },
  {
    n: '02',
    title: 'B2B Proposals & Outreach Kits',
    body: 'Open one follow-up with the exact section the buyer re-read — not "just checking in".',
    mock: <ProposalMock />,
    caseKey: 'b2b-proposal',
  },
  {
    n: '03',
    title: 'Meeting Prep & Weekly Updates',
    body: 'Know who walked in cold. Pre-reads as HTML — see who actually read it, who skimmed, who needs the recap.',
    mock: <BoardPrepMock />,
    caseKey: 'meeting-prep',
  },
];

export default function LandingV2() {
  // Auth-aware nav + CTAs: signed-in users see "Open dashboard" instead
  // of "Get started" / "Start free". This page is statically prerendered
  // (no edge SSR — that was the source of the cold-start 1102 "Worker
  // exceeded resource limits" errors), so the signed-in/out CTA swap
  // resolves client-side in <AuthLink>/<AuthText> after hydration. The
  // landing stays accessible to signed-in users — no auto-redirect.
  return (
    <div className="v2-root">
      <SoftwareApplicationLd />
      <LandingEffects />

      {/* ─────────────────────── NAV ─────────────────────── */}
      <nav className="v2-nav" id="v2-nav">
        {/* Logo is the shared <Logo /> component so the brand mark is
            identical to NavBar (used on /docs, /sign-in, /pricing). */}
        <Logo href="/" />
        <ul>
          <li>
            <a href="#shift">Why</a>
          </li>
          <li>
            <a href="#features">What you see</a>
          </li>
          <li>
            <a href="#how">How it works</a>
          </li>
          <li>
            <Link href="/pricing">Pricing</Link>
          </li>
        </ul>
        {/* When signed in: "Open dashboard" → /docs. Otherwise the
            same "Get started" CTA we've always had, routing to
            /sign-in (which handles both new accounts and returning
            users via Google OAuth + magic link). */}
        <AuthLink guestHref="/sign-in" className="nav-cta">
          <AuthText guest="Get started" authed="Open dashboard" />
        </AuthLink>
      </nav>

      {/* ─────────────────────── HERO ─────────────────────── */}
      <section className="v2-hero">
        <div className="v2-hero-grid">
          <div className="v2-hero-left">
            <div className="eyebrow">
              <span className="dot" /> Open source · AGPL-3.0
            </div>
            <h1 className="v2-headline">
              <span className="line">
                <span className="word">
                  <span>Decks</span>
                </span>{' '}
                <span className="word">
                  <span>moved</span>
                </span>{' '}
                <span className="word">
                  <span>to</span>
                </span>{' '}
                <span className="word">
                  <span>HTML.</span>
                </span>
              </span>
              <span className="line">
                <span className="word">
                  <span className="v2-em-italic">Tracking</span>
                </span>{' '}
                <span className="word">
                  <span className="v2-em-italic">should</span>
                </span>{' '}
                <span className="word">
                  <span className="v2-em-italic">follow.</span>
                </span>
              </span>
            </h1>
            <p className="lede">
              Share any HTML document as a tracked link. Watch in real time who opened it, how long
              they stayed, and where they dwelled — down to the section and the second.
            </p>

            <div className="cta-row">
              <AuthLink guestHref="/sign-in" className="v2-btn v2-btn-primary">
                <AuthText guest="Start free" authed="Open dashboard" />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </AuthLink>
            </div>

            <div className="v2-trust">
              <span className="lbl">Built for</span>
              <div className="logos">
                <span>Investor decks</span>
                <span className="dot-sep">·</span>
                <span>Diligence packets</span>
                <span className="dot-sep">·</span>
                <span>Sales reports</span>
                <span className="dot-sep">·</span>
                <span>Design specs</span>
                <span className="dot-sep">·</span>
                <span>Proposals</span>
              </div>
            </div>

            {/* Mobile-only hero signature — appears below the CTA + trust
             * row on phones (≤ 760px). The full desktop stage on the
             * right is display:none on mobile because the tilted
             * dashboard + 5 floating chips overlap badly at narrow
             * widths. This compact radar + single "Just opened" chip
             * keeps the brand-motion signal without the overflow.
             * Hidden on desktop via .v2-hero-mobile-visual { display:none }. */}
            <div className="v2-hero-mobile-visual">
              <div className="radar-mini">
                <div className="glow" />
                <div className="ring" />
                <div className="ring r2" />
                <div className="ring r3" />
                <div className="sweep" />
                <div className="blip b1" />
                <div className="blip b2" />
                <div className="blip b3" />
              </div>
              <div className="chip">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  </svg>
                </div>
                <div className="meta">
                  <div className="lab">Just opened</div>
                  <div className="val">marc@partners.co</div>
                </div>
              </div>
            </div>
          </div>

          <div className="v2-hero-right">
            <div className="v2-hero-stage">
              <div className="v2-hero-glow" />
              <div className="v2-radar">
                <div className="ring" />
                <div className="ring r2" />
                <div className="ring r3" />
                <div className="ring r4" />
                <div className="sweep" />
                <div className="blip b1" />
                <div className="blip b2" />
                <div className="blip b3" />
              </div>

              <div className="v2-chip-float c1">
                <div className="ic green">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  </svg>
                </div>
                <div className="meta">
                  <div className="lab">Just opened</div>
                  <div className="val">marc@partners.co</div>
                </div>
              </div>

              <div className="v2-chip-float c2 big-num">
                <div className="ic ink">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div className="meta">
                  <div className="lab">Max scroll</div>
                  <div className="val">100%</div>
                </div>
              </div>

              <div className="v2-chip-float c3">
                <div className="ic pop">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div className="meta">
                  <div className="lab">Active read</div>
                  <div className="val">
                    <span id="v2-heroTick">14s</span>
                  </div>
                </div>
              </div>

              <div className="v2-chip-float c4">
                <div className="ic brand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div className="meta">
                  <div className="lab">New session</div>
                  <div className="val">+1 viewer</div>
                </div>
              </div>

              <div className="v2-chip-float c5 section-time">
                <div className="head">
                  <span>
                    <span className="dot" />
                    &nbsp;Section time
                  </span>
                  <span className="right">3 of 14</span>
                </div>
                <div className="bars">
                  <div className="row">
                    <span className="n">Intro</span>
                    <span className="ln">
                      <b style={{ ['--w' as never]: '42%' }} />
                    </span>
                    <span className="t">24s</span>
                  </div>
                  <div className="row peak">
                    <span className="n">Why now</span>
                    <span className="ln">
                      <b style={{ ['--w' as never]: '100%' }} />
                    </span>
                    <span className="t">1m 02s</span>
                  </div>
                  <div className="row">
                    <span className="n">Outlook</span>
                    <span className="ln">
                      <b style={{ ['--w' as never]: '38%' }} />
                    </span>
                    <span className="t">19s</span>
                  </div>
                </div>
              </div>

              <div className="v2-hero-dash">
                <div className="bar">
                  <div className="lights">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="u">series-a-memo.html · v4 · shared with 3</div>
                </div>
                <div className="v2-slide-doc">
                  <div className="doc-head">
                    <span className="brand-tag">Series A Memo · Q1</span>
                    <span>03 / 14</span>
                  </div>
                  <h3>
                    Active read time
                    <br />
                    that actually <em>matters</em>.
                  </h3>
                  <p className="sub">
                    The dashboard you&apos;re looking at is generated automatically the moment a
                    recipient opens your file.
                  </p>
                  <div className="v2-doc-chart">
                    <div className="bars">
                      <div className="col">
                        <span>WEEK 1</span>
                      </div>
                      <div className="col">
                        <span>WEEK 2</span>
                      </div>
                      <div className="col">
                        <span>WEEK 3</span>
                      </div>
                      <div className="col">
                        <span>WEEK 4</span>
                      </div>
                    </div>
                    <div className="chart-cap">
                      <span>Active read · sec / opener</span>
                      <span className="up">+186%</span>
                    </div>
                  </div>
                  <div className="v2-doc-foot">
                    <span>htmlradar.com / r / memo</span>
                    <span>Confidential</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── THE SHIFT ─────────────────────── */}
      <section className="v2-shift" id="shift">
        <div className="head">
          <span className="kicker">The shift</span>
          <p className="v2-reveal">
            The documents that matter increasingly end in <em>.html</em>. Live where you want them
            live, responsive on every screen, readable by both the people you sent them to and the
            AI tools they bring with them. PDF served the print era. HTML fits how decks actually
            get read now: on phones, in inboxes, with an AI tool open in the next tab. HTMLRadar is
            the tracking layer for the new medium.
          </p>
        </div>
        <div className="v2-shift-visual v2-reveal d2">
          <span className="v2-shift-chip old">deck.pdf</span>
          <span className="v2-shift-arrow" />
          <span className="v2-shift-chip new">deck.html</span>
        </div>
      </section>

      {/* ─────────────────────── PITCH STORY ─────────────────────── */}
      <section className="v2-pitch" id="features">
        <div className="head">
          <div className="v2-kicker v2-reveal">What HTMLRadar actually shows</div>
          <h2 className="v2-reveal d1">
            Not just opens — <em>the moment that&nbsp;matters</em>.
          </h2>
        </div>
        <div className="v2-pitch-grid">
          <div className="v2-pitch-card v2-reveal">
            <div className="v2-pcd-head">
              <span>htmlradar.com / r / swift-falcon-a3f2</span>
              <span className="last">
                <i /> Last open · 4h ago
              </span>
            </div>
            <h3 className="v2-pcd-title">Seed Deck. Q2.</h3>
            <div className="v2-pcd-divider" />
            <div className="v2-pcd-recipient">
              <div className="who-row">
                <div className="avatar">M</div>
                <div className="who">
                  <span className="lbl">Recipient</span>
                  <span className="name">Marc · Partner</span>
                </div>
              </div>
              <div className="metrics">
                <div>
                  <span className="lbl">Opens</span>
                  <span className="val">3</span>
                </div>
                <div>
                  <span className="lbl">Active read</span>
                  <span className="val">6m 14s</span>
                </div>
              </div>
            </div>
            <div className="v2-pcd-divider" />
            <div className="v2-pcd-week">
              <div>
                <span className="lbl">Opens · last 7 days</span>
                <div className="days">
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                  <span>Sun</span>
                </div>
              </div>
              <div className="weekbars">
                <i className="off" />
                <i className="off" />
                <i style={{ ['--h' as never]: '35%' }} />
                <i className="off" />
                <i style={{ ['--h' as never]: '55%' }} />
                <i className="off" />
                <i style={{ ['--h' as never]: '95%' }} />
              </div>
            </div>
            <div className="v2-pcd-sections">
              <div className="lbl">Time spent per section</div>
              <div className="rows">
                <div className="srow" style={{ ['--w' as never]: '100%' }}>
                  <span>The Ask</span>
                  <b>
                    <i />
                  </b>
                  <span className="t">2m 41s</span>
                </div>
                <div className="srow" style={{ ['--w' as never]: '74%' }}>
                  <span>Team</span>
                  <b>
                    <i />
                  </b>
                  <span className="t">1m 58s</span>
                </div>
                <div className="srow" style={{ ['--w' as never]: '58%' }}>
                  <span>Traction</span>
                  <b>
                    <i />
                  </b>
                  <span className="t">1m 35s</span>
                </div>
                <div className="srow soft" style={{ ['--w' as never]: '8%' }}>
                  <span>Problem</span>
                  <b>
                    <i />
                  </b>
                  <span className="t">12s</span>
                </div>
                <div className="srow none" style={{ ['--w' as never]: '0%' }}>
                  <span>Market sizing</span>
                  <b>
                    <i />
                  </b>
                  <span className="t">—</span>
                </div>
              </div>
            </div>
          </div>
          <div className="v2-pitch-right">
            <div className="v2-notif v2-reveal d1">
              <div className="ic">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M7 13a5 5 0 0 1 0-7" />
                  <path d="M3 16a9 9 0 0 1 0-13" />
                  <path d="M17 13a5 5 0 0 0 0-7" />
                  <path d="M21 16a9 9 0 0 0 0-13" />
                  <circle cx="12" cy="9.5" r="1.6" fill="currentColor" />
                  <line x1="12" y1="13" x2="12" y2="21" />
                  <line x1="9" y1="21" x2="15" y2="21" />
                </svg>
              </div>
              <div className="body">
                <div className="nrow">
                  <span className="brand-tag">HTMLRADAR</span>
                  <span>4m ago</span>
                </div>
                <div className="msg">Marc just opened Seed Deck, Q2.</div>
                <div className="sub">2m 41s on §03 The Ask · still active</div>
                <div className="divider" />
                <Link className="link" href="/sign-in">
                  View analytics{' '}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            </div>
            <blockquote className="v2-pull-quote v2-reveal d2">
              &ldquo;Marc opened it three times. Spent <em>6m 14s</em>. Read the Ask, Team, and
              Traction sections. Skipped Market sizing.&rdquo;
            </blockquote>
            <p className="v2-kicker-text v2-reveal d3">
              Most analytics tell you someone opened it. HTMLRadar tells you which sentence
              convinced them — with a three-second dwell floor so scroll-pasts don&apos;t count as
              reads.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────── USE CASES ─────────────────────── */}
      {/* Three concrete deliverables HTMLRadar covers today, each with
         a high-fidelity mock that mirrors the per-case detail
         (Sales Proposal / Pitch Deck / Board Pre-Read). Trimmed from
         her 4-case mockup (dropped Press/Media Kits as furthest from
         AI-native ICP) and replaced her 420vh pinned-scroll with a
         calm grid so mobile works. */}
      <section className="v2-cases py-24 md:py-32" id="use-cases">
        {/* Shared wrapper so the eyebrow + headline + cards all align
            to the same left edge (design note: "top indentation is too
            towards the left"). */}
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="head">
            <div className="v2-kicker v2-reveal">Use cases</div>
            <h2 className="v2-reveal d1">
              One link, <em>every kind of deliverable</em>.
            </h2>
            <p className="v2-reveal d2">
              HTMLRadar follows the document, not the file type. Sharper for the things you send
              most.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {USE_CASES.map((c) => (
              <AuthLink
                key={c.caseKey}
                guestHref={`/sign-in?case=${c.caseKey}`}
                className="v2-reveal group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-paper p-6 shadow-[0_18px_40px_-24px_rgba(31,17,8,0.18)] transition-shadow hover:shadow-[0_24px_50px_-22px_rgba(31,17,8,0.28)]"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-graphite">
                    No.{c.n}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <h3 className="mt-4 font-serif text-[20px] font-semibold leading-tight tracking-tight text-ink">
                  {c.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{c.body}</p>

                {/* High-fidelity per-case mock. */}
                <div className="mt-6">{c.mock}</div>

                <div className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-signal-dark transition-transform group-hover:translate-x-0.5">
                  <AuthText guest="Try with your own" authed="Open dashboard" />
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="size-3"
                  >
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </div>
              </AuthLink>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────── WORKFLOW (vertical timeline) ─────────────────────── */}
      <section className="v2-flow" id="how">
        <div className="head">
          <div className="v2-kicker v2-reveal">How it works</div>
          <h2 className="v2-reveal d1">
            From file to <em>insight</em> in sixty seconds.
          </h2>
        </div>
        {/* Flat grid — each row pairs ONE step with ONE mock so they
         * vertically align. Stage CSS handles the 3-row layout +
         * connector line + animated packet. */}
        <div className="v2-flow-stage">
          {/* Row 1 — Upload */}
          <div className="v2-flow-step v2-reveal">
            <span className="dot" />
            <span className="kicker">Upload</span>
            <div className="body">
              <h3>
                Drop your <em>HTML</em>.
              </h3>
              <p>
                Single file or full system. We host it for you, version every replacement. Old links
                keep working.
              </p>
            </div>
          </div>
          <div className="v2-flow-mock v2-mock-upload v2-reveal d1">
            <div className="mock-kicker">/ new</div>
            <div className="zone">
              <div className="file-ico">
                <div className="l" />
                <div className="l s" />
                <div className="l" />
              </div>
              <div className="info">
                <div className="name">series-a-memo.html</div>
                <div className="size">38 KB · uploaded</div>
              </div>
            </div>
            <div className="progress">
              <div className="bar" />
            </div>
          </div>

          {/* Row 2 — Share */}
          <div className="v2-flow-step v2-reveal">
            <span className="dot" />
            <span className="kicker">Share</span>
            <div className="body">
              <h3>
                Send a <em>tracked link</em>.
              </h3>
              <p>
                Each recipient gets a unique link. Email gate, expiry, password, and download lock
                are all set per share. The whole packet rides under one tracked link: PDFs, cap
                tables, ZIPs alongside the deck, with each download tagged to the recipient.
              </p>
            </div>
          </div>
          <div className="v2-flow-mock v2-mock-share v2-reveal d1">
            <div className="mock-kicker">/ share</div>
            <div className="url-row">
              <span className="url">htmlradar.com/r/swift-falcon</span>
              <span className="copy">Copy</span>
            </div>
            <div className="toggles">
              <div className="toggle-row">
                <span className="l">Email gate</span>
                <span className="pill on" />
              </div>
              <div className="toggle-row">
                <span className="l">Auto-expiry — 7 days</span>
                <span className="pill on" />
              </div>
              <div className="toggle-row">
                <span className="l">Download lock</span>
                <span className="pill" />
              </div>
            </div>
          </div>

          {/* Row 3 — Read */}
          <div className="v2-flow-step v2-reveal">
            <span className="dot" />
            <span className="kicker">Read</span>
            <div className="body">
              <h3>
                The radar <em>lights up</em>.
              </h3>
              <p>
                Sub-second. Active time, scroll depth, time-per-section, device, browser. A live
                dashboard, not an email digest.
              </p>
            </div>
          </div>
          <div className="v2-flow-mock v2-mock-live v2-reveal d1">
            <div className="live-bar">
              <span>/ live</span>
              <span className="now">Now · 2 reading</span>
            </div>
            <div className="row active">
              <span className="name">marc@partners.co</span>
              <span className="stat">6m 14s · 98%</span>
            </div>
            <div className="row quiet">
              <span className="name">jen@firm.co</span>
              <span className="stat">3m 04s · 78%</span>
            </div>
          </div>
        </div>
      </section>

      {/* The "Four things every other tracker gets wrong" section used
       * to live here. Half of its claims duplicated Workflow + Controls
       * (unique link, version-keep-link), so the section was cut. The
       * two genuinely-distinct points are folded in elsewhere: the
       * three-second dwell threshold is now in the Pitch kicker, the
       * attachments line is now in the Workflow "Share" body. */}

      {/* ─────────────────────── CONTROLS ─────────────────────── */}
      <section className="v2-controls" id="controls">
        <div className="head">
          <div className="v2-kicker v2-reveal">Per-share controls</div>
          <h2 className="v2-reveal d1">
            Set the rules. <em>Every share</em>.
          </h2>
          <p className="lede v2-reveal d2">
            Five gates per link. Flip any of them off the moment you change your mind.
          </p>
        </div>
        <div className="v2-ctrl-grid">
          <div className="v2-ctrl-left">
            <div className="v2-ctrl-item">
              <div className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div>
                <h4>Authentication</h4>
                <p>Email gate, password, or both — recipient verifies before the doc renders.</p>
              </div>
            </div>
            <div className="v2-ctrl-item">
              <div className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div>
                <h4>Download lock</h4>
                <p>Block saving the page. Cmd+S, right-click save — nothing reaches their disk.</p>
              </div>
            </div>
            <div className="v2-ctrl-item">
              <div className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <h4>Auto-expiry</h4>
                <p>
                  Set a date. The link starts showing an Expired notice after it. Extend any time.
                </p>
              </div>
            </div>
            <div className="v2-ctrl-item">
              <div className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div>
                <h4>Domain &amp; email allowlist</h4>
                <p>Restrict by domain, exact email, or both. Everyone else gets blocked.</p>
              </div>
            </div>
            <div className="v2-ctrl-item">
              <div className="ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <div>
                <h4>Revoke any time</h4>
                <p>One toggle kills a link instantly. Past read history stays in the dashboard.</p>
              </div>
            </div>
          </div>
          <div className="v2-ctrl-left">
            <div
              style={{
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 18,
                padding: '24px 26px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                boxShadow: '0 24px 60px -16px rgba(42,24,18,0.14)',
                position: 'sticky',
                top: 120,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: 8,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span style={{ color: 'var(--ink)' }}>Share · marc@partners.co</span>
                <span style={{ color: 'var(--good)' }}>● Saved</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                  background: '#FBF9F3',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                htmlradar.com/r/swift-falcon-a3f2
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink-2)',
                }}
              >
                Every share is its own gated channel. The dashboard updates the moment a recipient
                opens the link.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── OPEN SOURCE ─────────────────────── */}
      <section className="v2-os">
        <div className="v2-os-card v2-reveal">
          <div>
            <div className="kicker">Built in the open</div>
            <h2>
              Open source under <em>AGPL-3.0</em>.
            </h2>
            <p>
              The tracker, the proxy worker, the schema, the web app — all of it lives on GitHub.
              The hosted version at htmlradar.com is for people who&apos;d rather not run their own
              Cloudflare and Supabase. Both options run the same code.
            </p>
            <a
              className="repo"
              href="https://github.com/htmlradar/htmlradar"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.4-5.25 5.68.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5z" />
              </svg>
              github.com/htmlradar/htmlradar
            </a>
          </div>
          <ul>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>Audit the data path.</b> Recipients can see exactly what&apos;s being tracked.
                Closed-source competitors can&apos;t offer that.
              </span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>Self-host for compliance.</b> Banks, healthcare, M&amp;A teams that can&apos;t
                use SaaS run the same stack on their own Cloudflare and Supabase.
              </span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>
                <b>AGPL.</b> Anyone can fork — but improvements have to come back. Keeps the project
                from being swallowed by a larger SaaS.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* ─────────────────────── CTA ─────────────────────── */}
      <section className="v2-cta" id="cta">
        <h2>
          Sign in. Drop the HTML.
          <br />
          <em>Send the link.</em>
        </h2>
        <p>
          An email lands the moment a real read happens. Free for 2 tracked links — no card needed.
        </p>
        <div className="row">
          <AuthLink guestHref="/sign-in" className="v2-btn v2-btn-primary">
            <AuthText guest="Start free" authed="Open dashboard" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </AuthLink>
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
            className="v2-btn v2-btn-ghost"
          >
            Read the source
          </a>
        </div>
      </section>

      {/* ─────────────────────── FOOTER ─────────────────────── */}
      <footer className="v2-foot">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Logo size="sm" />
          <span>· Document tracking for HTML. Open source · AGPL-3.0.</span>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Link href="/why">Why</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/use-case/pitch-deck-tracking">Pitch deck tracking</Link>
          <Link href="/use-case/proposal-tracking">Proposal tracking</Link>
          <Link href="/use-case/track-html-deck">Track HTML decks</Link>
          <Link href="/for/claude-artifacts">For Claude artifacts</Link>
          <Link href="/for/reveal-js">For reveal.js</Link>
          <Link href="/self-hosted">Self-hosted</Link>
          <Link href="/compare/docsend">vs DocSend</Link>
          <Link href="/compare/papermark">vs Papermark</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/privacy">Privacy</Link>
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
