// Upload-time phishing screen — layer 2 of the anti-phishing plan behind the
// content-domain switch (docs/control/APPROACH-CARD-content-domain-2026-08-30.md).
// Layer 4 is the recipient's own report form (schema/037).
//
// Pure, synchronous, no network, no parser. This runs on the upload path of
// every document the product stores, inside an edge isolate, while somebody is
// waiting for a redirect, so regexes over the source text are the whole budget
// — and they are enough for the thing being looked for. A phishing kit is a
// small page that says "sign in to Microsoft", collects a password, and posts
// it to somebody else's server.
//
// IT SCREENS AND FLAGS. IT NEVER BLOCKS.
//
// A wrong "no" costs a paying customer their upload and costs us the customer.
// A wrong "yes" costs an operator one glance at a document. So a high score
// writes a row a human reads (createDocumentForUser) and the upload completes
// either way. Nothing in this file returns a verdict; it returns evidence.
//
// SIGNALS AND WEIGHTS
//
//   password-input           30  <input type="password"> in a shared document
//   brand-login-wording      30  sign-in wording within 200 characters of a
//                                most-phished brand name
//   obfuscated-script        30  eval(atob( or unescape(%u
//   cross-domain-form-action 25  a form posting to a registrable domain the
//                                document names nowhere else
//   hidden-external-iframe   20  an off-screen or zero-sized iframe to another
//                                origin
//   meta-refresh-external    20  a meta refresh to another site
//   single-line-script-blob  10  an inline script with a line over 10 000
//                                characters
//
// The tuning behind these numbers, fixture by fixture, is in
// screen-html.test.ts. In short: no single signal reaches the threshold,
// because every one of them appears on its own in documents that are entirely
// innocent — a product mockup has a password box, a chart page has a minified
// bundle, an analytics snippet has a hidden iframe.

export interface ScreenResult {
  score: number;
  signals: string[];
}

const WEIGHTS = {
  'password-input': 30,
  'brand-login-wording': 30,
  'obfuscated-script': 30,
  'cross-domain-form-action': 25,
  'hidden-external-iframe': 20,
  'meta-refresh-external': 20,
  'single-line-script-blob': 10,
} as const;

/**
 * At or above this, the upload is written to the abuse queue for a human.
 *
 * Fifty is the gap between the cheapest real phishing page and the most
 * expensive innocent one. A password box plus a brand's sign-in wording is 60;
 * a password box posting to a stranger's domain is 55; obfuscated script plus
 * a hidden iframe is 50. The worst-scoring honest document we could construct
 * — an interactive chart with a bundled minified script and a hidden analytics
 * iframe — is 30. Nothing on the list flags on its own, which is the property
 * that matters: every single signal has an innocent explanation, and two of
 * them together stop having one.
 */
export const SCREEN_FLAG_THRESHOLD = 50;

// The brands whose sign-in pages are actually copied, plus retail banking in
// general. Short on purpose: every name here is one a customer's own deck may
// legitimately mention, and the proximity rule below is what stops "we use
// Google Workspace" from counting.
const BRAND =
  /(microsoft|office\s?365|outlook|onedrive|sharepoint|google|gmail|apple\s?id|icloud|paypal|netflix|dhl|online banking|net ?banking|internet banking)/g;

const LOGIN_WORDING =
  /(sign[\s-]?in|signin|log[\s-]?in|login|verify your|verify account|account verification|confirm your (password|identity|account)|enter your password|re-?enter your password|session (has )?expired|unusual sign)/g;

// How close the two have to be. A sign-in form and the brand it imitates sit in
// the same heading or the same paragraph; a deck that mentions Google on slide
// 3 and has a "log in" link in its footer does not.
const PROXIMITY_CHARS = 200;

const TAG_SOUP = /<(script|style)[\s\S]*?<\/\1>|<[^>]*>/gi;
const FORM_ACTION = /<form\b[^>]*?\baction\s*=\s*["']?([^"'\s>]+)/gi;
const LINKED_URL = /\b(?:href|src)\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
const IFRAME_TAG = /<iframe\b[^>]*>/gi;
const META_TAG = /<meta\b[^>]*>/gi;
const SCRIPT_BODY = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * The registrable domain of a URL, or null if it is not one we can read.
 *
 * ponytail: last two labels, three when the second-to-last is one of the
 * common two-part suffixes. This is not a public suffix list and does not want
 * to be one — the cost of misreading `foo.co.uk` here is one signal scored
 * wrongly on one upload, and the whole point of the design is that one signal
 * decides nothing. Swap in a real PSL if this ever gates anything.
 */
function registrableDomain(raw: string): string | null {
  try {
    const parts = new URL(raw).hostname.toLowerCase().split('.');
    if (parts.length <= 2) return parts.join('.');
    const compound = /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2] ?? '');
    return parts.slice(compound ? -3 : -2).join('.');
  } catch {
    return null;
  }
}

// Every position at which a pattern matches. matchAll clones the regex, so the
// module-level `g` patterns above keep no state between calls.
function positions(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((m) => m.index ?? 0);
}

function brandNearLoginWording(text: string): boolean {
  const brands = positions(text, BRAND);
  if (brands.length === 0) return false;
  return positions(text, LOGIN_WORDING).some((w) =>
    brands.some((b) => Math.abs(b - w) <= PROXIMITY_CHARS),
  );
}

function postsToAnotherDomain(html: string): boolean {
  const named = new Set<string>();
  for (const [, url] of html.matchAll(LINKED_URL)) {
    const domain = registrableDomain(url ?? '');
    if (domain) named.add(domain);
  }
  for (const [, action] of html.matchAll(FORM_ACTION)) {
    // A relative action posts back to the document's own origin, which on a
    // hosted document is our sandbox and goes nowhere.
    if (!/^https?:\/\//i.test(action ?? '')) continue;
    const domain = registrableDomain(action!);
    if (domain && !named.has(domain)) return true;
  }
  return false;
}

function hiddenExternalIframe(html: string): boolean {
  return [...html.matchAll(IFRAME_TAG)].some(([tag]) => {
    if (!/\bsrc\s*=\s*["']?https?:\/\//i.test(tag)) return false;
    return (
      /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|\shidden[\s>=]/i.test(tag) ||
      /\b(width|height)\s*=\s*["']?0*[01]\b/i.test(tag) ||
      /\b(width|height)\s*:\s*0(px)?\b/i.test(tag)
    );
  });
}

function metaRefreshOffsite(html: string): boolean {
  return [...html.matchAll(META_TAG)].some(
    ([tag]) =>
      /http-equiv\s*=\s*["']?refresh/i.test(tag) &&
      /content\s*=\s*["'][^"']*url\s*=\s*https?:\/\//i.test(tag),
  );
}

function longestScriptLine(html: string): number {
  let longest = 0;
  for (const [, body] of html.matchAll(SCRIPT_BODY)) {
    for (const line of (body ?? '').split('\n')) {
      if (line.length > longest) longest = line.length;
    }
  }
  return longest;
}

/**
 * Score one document's HTML. Returns the total and the signals that earned it,
 * in a stable order so two uploads of the same file store the same array.
 */
export function screenHtml(html: string): ScreenResult {
  const text = html.toLowerCase().replace(TAG_SOUP, ' ');
  const found: Record<keyof typeof WEIGHTS, boolean> = {
    'password-input': /<input\b[^>]*\btype\s*=\s*["']?password/i.test(html),
    'brand-login-wording': brandNearLoginWording(text),
    'obfuscated-script': /eval\s*\(\s*atob\s*\(|unescape\s*\(\s*["']?%u/i.test(html),
    'cross-domain-form-action': postsToAnotherDomain(html),
    'hidden-external-iframe': hiddenExternalIframe(html),
    'meta-refresh-external': metaRefreshOffsite(html),
    'single-line-script-blob': longestScriptLine(html) > 10_000,
  };

  const signals = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter((s) => found[s]);
  return { score: signals.reduce((sum, s) => sum + WEIGHTS[s], 0), signals };
}
