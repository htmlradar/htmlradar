// HTMLRadar landing v2 — adapted from a designer's reference + the v1
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
import { V2Effects } from './V2Effects';
import './landing-v2.css';

export const runtime = 'edge';

export default function LandingV2() {
  return (
    <div className="v2-root">
      <V2Effects />

      {/* ─────────────────────── NAV ─────────────────────── */}
      <nav className="v2-nav" id="v2-nav">
        <div className="logo">
          HTML<span className="ital">radar</span>
        </div>
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
        <Link href="/sign-in" className="nav-cta">
          Get started
        </Link>
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
              <Link href="/sign-in" className="v2-btn v2-btn-primary">
                Start free
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>

            <div className="v2-trust">
              <span className="lbl">Built for</span>
              <div className="logos">
                <span>Investor decks</span>
                <span className="dot-sep">·</span>
                <span>Sales reports</span>
                <span className="dot-sep">·</span>
                <span>Design specs</span>
                <span className="dot-sep">·</span>
                <span>Proposals</span>
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
            The documents that matter used to end in <em>.pdf</em>. Frozen, mobile-hostile,
            invisible to every model your reader runs against them. Now they end in <em>.html</em> —
            readable by LLMs natively, responsive on every device, capable of holding a live
            dashboard inside the page. The tracking nobody built was the one that matches the
            medium.
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
              convinced them.
            </p>
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
        <div className="v2-flow-stage">
          <div className="v2-flow-steps">
            <div className="v2-flow-step v2-reveal">
              <span className="dot" />
              <span className="kicker">Upload</span>
              <div className="body">
                <h3>
                  Drop your <em>HTML</em>.
                </h3>
                <p>
                  Single file or full system. We host it for you, version every replacement. Old
                  links keep working.
                </p>
              </div>
            </div>
            <div className="v2-flow-step v2-reveal d1">
              <span className="dot" />
              <span className="kicker">Share</span>
              <div className="body">
                <h3>
                  Send a <em>tracked link</em>.
                </h3>
                <p>
                  Each recipient gets a unique link. Email gate, expiry, password, download lock —
                  set per share.
                </p>
              </div>
            </div>
            <div className="v2-flow-step v2-reveal d2">
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
          </div>

          <div className="v2-flow-mock v2-reveal d1">
            <div className="mock-head">
              <span>htmlradar.com / r / swift-falcon</span>
              <span className="live">Live</span>
            </div>
            <div className="doc-card">
              <div className="title">Seed Deck. Q2.</div>
              <div className="url">series-a-memo.html · v4</div>
            </div>
            <div className="live-row">
              <span className="who">marc@partners.co</span>
              <span className="stat">6m 14s · 98%</span>
            </div>
            <div className="quiet-row">
              <span>jen@firm.co</span>
              <span>3m 04s · 78%</span>
            </div>
            <div className="bars">
              <div className="bar">
                <span className="l">The Ask</span>
                <span className="track">
                  <i style={{ ['--w' as never]: '100%' }} />
                </span>
                <span className="v">2m 41s</span>
              </div>
              <div className="bar">
                <span className="l">Team</span>
                <span className="track">
                  <i style={{ ['--w' as never]: '74%' }} />
                </span>
                <span className="v">1m 58s</span>
              </div>
              <div className="bar">
                <span className="l">Traction</span>
                <span className="track">
                  <i style={{ ['--w' as never]: '58%' }} />
                </span>
                <span className="v">1m 35s</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────── WHAT IT DOES (4 claims) ─────────────────────── */}
      <section className="v2-claims">
        <div className="head">
          <div className="v2-kicker v2-reveal">What it does</div>
          <h2 className="v2-reveal d1">
            Four things every other tracker gets <em>wrong</em>.
          </h2>
        </div>
        <div className="v2-claims-grid">
          <div className="v2-claim v2-reveal">
            <span className="n">01</span>
            <h3>Each recipient gets a unique link.</h3>
            <p>
              One document, many shares. Each share carries its own email gate, password, expiry,
              and revocation. The dashboard tells you which one Marc opened — not &ldquo;someone
              opened it.&rdquo;
            </p>
          </div>
          <div className="v2-claim v2-reveal d1">
            <span className="n">02</span>
            <h3>Replace the HTML, keep the link.</h3>
            <p>
              Re-upload after partner feedback. Every share you&apos;ve already sent now points at
              v2. No re-sending. No broken URLs in inboxes.
            </p>
          </div>
          <div className="v2-claim v2-reveal d2">
            <span className="n">03</span>
            <h3>
              <em>Read</em>, not &ldquo;opened.&rdquo;
            </h3>
            <p>
              A three-second dwell threshold separates a real read from a scroll-past. Most
              analytics count both. HTMLRadar doesn&apos;t.
            </p>
          </div>
          <div className="v2-claim v2-reveal d3">
            <span className="n">04</span>
            <h3>Send the deck. Attach the diligence.</h3>
            <p>
              Files ride along with the HTML — PDFs, cap tables, financial models, ZIPs. Toggle
              &ldquo;Allow downloads&rdquo; per share. When it&apos;s off, recipients don&apos;t
              even know they exist.
            </p>
          </div>
        </div>
      </section>

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
                <p>Set a date and the link returns 403 after that moment. Extend any time.</p>
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
          An email lands the moment a real read happens. Free for 10 documents — no card needed.
        </p>
        <div className="row">
          <Link href="/sign-in" className="v2-btn v2-btn-primary">
            Start free
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
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
        <div>
          HTML
          <span
            style={{
              color: 'var(--brand)',
              fontFamily: 'var(--serif)',
              fontStyle: 'italic',
            }}
          >
            radar
          </span>
          {' · Document tracking for HTML. Open source · AGPL-3.0.'}
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Link href="/why">Why</Link>
          <Link href="/pricing">Pricing</Link>
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
