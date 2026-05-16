import { escapeHtml } from './escape.js';

// Recipient-facing HTML shells served by the proxy: the gate forms (email,
// password) and the error states (revoked, expired, not found, source
// unreachable). These are every recipient's first impression of HTMLRadar
// — same care + brand fidelity as the marketing site, none of the chrome
// or weight.
//
// Design intent:
//   - Warm cream paper + oxblood accent + Fraunces serif headline.
//     Matches the v2 palette in `packages/app/tailwind.config.ts`.
//   - Editorial, not enterprise. The reader is a real person who just
//     received a deck from someone they know; the shell should feel like
//     receiving a well-typeset letter, not signing into a SaaS portal.
//   - Inline CSS so every response is one round-trip. Fraunces is loaded
//     from Google Fonts via <link rel=preconnect> + swap so the layout
//     doesn't shift when it lands.
//   - Mobile-first. Most recipients open links on phone first.
//   - prefers-reduced-motion respected.
//
// Constraints kept from the prior shell:
//   - All forms still POST to /r/{slug}/{auth|email} (proxy gate handlers
//     unchanged).
//   - HTTP status codes preserved (200 on first render, 401 on form error,
//     403 revoked, 404 not found, 410 expired, 502 source-unreachable).
//   - Output Content-Type stays text/html; charset=utf-8.
//
// OG meta tags are generic ("A document on HTMLRadar") — by design, no
// recipient or sender names leak into link unfurls.

const FONTS_LINK = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&display=swap" rel="stylesheet">
`.trim();

// Generic OG tags. No personalisation — see privacy note above.
const OG_TAGS = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="HTMLRadar">
<meta property="og:title" content="A document on HTMLRadar">
<meta property="og:description" content="Tracked document delivery, built for HTML. Open source.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="A document on HTMLRadar">
<meta name="twitter:description" content="Tracked document delivery, built for HTML. Open source.">
<meta name="robots" content="noindex, nofollow">
`.trim();

// Compact radar mark — single ring + sweep line + center dot. Drawn in
// the brand badge's paper-cream so it reads against the solid oxblood
// pill at the top-right of every shell. No animation (would compete with
// the content).
const RADAR_MARK = `
<svg aria-hidden viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px">
  <circle cx="12" cy="12" r="9" fill="none" stroke="#FBF1E8" stroke-width="1.3" opacity="0.45"/>
  <circle cx="12" cy="12" r="5" fill="none" stroke="#FBF1E8" stroke-width="1.3" opacity="0.7"/>
  <line x1="12" y1="12" x2="12" y2="3" stroke="#FBF1E8" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="1.7" fill="#FBF1E8"/>
</svg>
`.trim();

const STYLES = `
:root {
  --paper: #FBF1E8;
  --paper-2: #F4E1CB;
  --paper-3: #EDD5BD;
  --ink: #1F1108;
  --ink-soft: #3A2818;
  --graphite: #876959;
  --signal: #7A1F2E;
  --signal-dark: #5A1521;
  --signal-soft: #D9B5B0;
  --line: #E8D5BD;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  background: var(--paper);
  background-image: radial-gradient(rgba(31, 17, 8, 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--ink);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Inter", system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  flex-direction: column;
}
.frame {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 460px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 28px 56px;
}
/* Brand badge — solid oxblood pill anchored top-right of every shell.
   Unmissable by design: the recipient should know within a beat that
   the link they're on belongs to HTMLRadar, not a phishing replica.
   Position is fixed so the pill stays anchored even on long forms. */
.brand-mount {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 5;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font: 600 11px/1 ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--paper);
  text-decoration: none;
  background: var(--signal);
  border-radius: 999px;
  padding: 8px 14px 8px 12px;
  box-shadow: 0 1px 0 rgba(31, 17, 8, 0.12), 0 6px 18px -8px rgba(122, 31, 46, 0.35);
  transition: background-color 120ms ease, transform 120ms ease;
}
.brand:hover { background: var(--signal-dark); }
.brand:active { transform: translateY(0.5px); }
@media (max-width: 480px) {
  .brand-mount { top: 14px; right: 14px; }
  .brand { padding: 7px 12px 7px 10px; font-size: 10.5px; letter-spacing: 0.14em; }
}
.card {
  margin-top: 18vh;
  margin-bottom: auto;
}
@media (max-height: 640px) { .card { margin-top: 28px; } }
.kicker {
  font: 500 11px/1 ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--graphite);
  margin: 0 0 14px;
}
h1 {
  font-family: "Fraunces", "Charter", "Iowan Old Style", Georgia, serif;
  font-weight: 400;
  font-size: 38px;
  line-height: 1.08;
  letter-spacing: -0.022em;
  color: var(--ink);
  margin: 0 0 14px;
}
p.lede {
  margin: 0 0 28px;
  font-size: 15.5px;
  line-height: 1.55;
  color: var(--ink-soft);
}
form { margin: 0; }
input[type="email"], input[type="password"] {
  width: 100%;
  font: inherit;
  font-size: 15px;
  padding: 13px 14px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  border-radius: 8px;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
input::placeholder { color: rgba(135, 105, 89, 0.7); }
input:focus {
  border-color: var(--signal);
  box-shadow: 0 0 0 3px rgba(122, 31, 46, 0.10);
}
input.invalid {
  border-color: var(--signal-dark);
  box-shadow: 0 0 0 3px rgba(90, 21, 33, 0.12);
}
.error {
  min-height: 18px;
  margin: 10px 2px 0;
  font: 500 13px/1.4 inherit;
  color: var(--signal-dark);
}
button {
  width: 100%;
  margin-top: 16px;
  font: 500 15px/1 inherit;
  padding: 14px 16px;
  background: var(--signal);
  color: var(--paper);
  border: 1px solid var(--signal);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 120ms ease, transform 120ms ease;
  letter-spacing: 0.005em;
}
button:hover { background: var(--signal-dark); border-color: var(--signal-dark); }
button:active { transform: translateY(0.5px); }
.notice {
  margin-top: 8px;
  padding: 14px 16px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: rgba(244, 225, 203, 0.35);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-soft);
}
.footer {
  margin-top: 56px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  font: 500 11px/1.5 ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--graphite);
  display: flex;
  flex-wrap: wrap;
  gap: 14px 22px;
  justify-content: space-between;
}
.footer a { color: inherit; text-decoration: none; border-bottom: 1px dotted rgba(135, 105, 89, 0.6); }
.footer a:hover { color: var(--signal); border-bottom-color: var(--signal); }
@media (max-width: 480px) {
  .frame { padding: 24px 20px 40px; }
  h1 { font-size: 32px; }
  .card { margin-top: 8vh; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`.trim();

const SHELL = (title: string, body: string, status: number, kicker?: string): Response =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — HTMLRadar</title>
${OG_TAGS}
${FONTS_LINK}
<style>${STYLES}</style>
</head>
<body>
<div class="brand-mount">
  <a class="brand" href="https://htmlradar.com" rel="noopener">${RADAR_MARK}<span>HTMLRadar</span></a>
</div>
<div class="frame">
  <main class="card">
    ${kicker ? `<p class="kicker">${escapeHtml(kicker)}</p>` : ''}
    ${body}
  </main>
  <footer class="footer">
    <span>Open source · AGPL-3.0</span>
    <a href="https://github.com/htmlradar/htmlradar" rel="noopener">github.com/htmlradar/htmlradar</a>
  </footer>
</div>
</body>
</html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export const notFound = (): Response =>
  SHELL(
    'Share not found',
    `<h1>Share not found.</h1>
     <p class="lede">The link may have been deleted, or it never existed. Check with the person who sent it to you.</p>`,
    404,
    'No record',
  );

export const revoked = (): Response =>
  SHELL(
    'Access revoked',
    `<h1>Access revoked.</h1>
     <p class="lede">The sender removed access to this document. Get in touch with them for a new link.</p>`,
    403,
    'Revoked by sender',
  );

export const expired = (): Response =>
  SHELL(
    'Link expired',
    `<h1>Link expired.</h1>
     <p class="lede">This link's window has closed. The sender can issue a fresh one whenever they like.</p>`,
    410,
    'Past expiry',
  );

export const sourceUnreachable = (): Response =>
  SHELL(
    'Document unavailable',
    `<h1>Document unavailable.</h1>
     <p class="lede">The sender's source didn't respond. They've been notified — try again in a moment, or reach out directly.</p>`,
    502,
    'Source error',
  );

export const passwordForm = (slug: string, error?: string): Response =>
  SHELL(
    error ? 'Incorrect password' : 'Enter password',
    `<h1>Locked.</h1>
     <p class="lede">Enter the password the sender shared with you to continue.</p>
     <form method="POST" action="/r/${escapeHtml(slug)}/auth" novalidate>
       <input
         type="password"
         name="password"
         placeholder="Password"
         autocomplete="current-password"
         required
         autofocus
         ${error ? 'class="invalid" aria-invalid="true"' : ''}
       />
       <div class="error" role="alert" aria-live="polite">${error ? escapeHtml(error) : ''}</div>
       <button type="submit">Continue</button>
     </form>`,
    error ? 401 : 200,
    'Password required',
  );

export const emailGateForm = (slug: string, error?: string): Response =>
  SHELL(
    error ? 'Email error' : 'Enter your email',
    `<h1>View this document.</h1>
     <p class="lede">Enter your email to continue. The sender will see who opened it.</p>
     <form method="POST" action="/r/${escapeHtml(slug)}/email" novalidate>
       <input
         type="email"
         name="email"
         placeholder="you@example.com"
         autocomplete="email"
         required
         autofocus
         ${error ? 'class="invalid" aria-invalid="true"' : ''}
       />
       <div class="error" role="alert" aria-live="polite">${error ? escapeHtml(error) : ''}</div>
       <button type="submit">Continue</button>
     </form>`,
    error ? 401 : 200,
    'Email required',
  );
