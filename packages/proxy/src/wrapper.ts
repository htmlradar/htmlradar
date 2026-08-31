// The trust wrapper: HTMLRadar's own page, holding the recipient's document
// in a frame above a strip the sender cannot remove, cover or intercept.
//
// Design: docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md,
// "Part one: the badge and the wrapper". Read "What the badge guarantees, and
// what it does not" before changing any of the CSS below — the layout IS the
// guarantee, not decoration on top of one.
//
// WHAT THE LAYOUT PROMISES
//
// The window is two boxes that never overlap: a `1fr` row holding the frame
// and an `auto` row holding the strip, filling `100dvh`. The strip is not
// stacked on top of the document competing for z-order; it is BESIDE it, in a
// different grid cell. A frame clips its contents to its own rectangle
// absolutely — `position: fixed` inside a frame is fixed to the FRAME's
// viewport, `z-index: 2147483647` still paints inside it, and popovers and
// dialogs are clipped the same way — so nothing the sender's document draws
// can reach the strip's pixels.
//
// Which is why there is no `position: absolute`, no `position: fixed`, no
// `z-index` and no negative margin anywhere in this file. Adding one would
// move the strip into the same stacking contest the grid exists to avoid.
//
// Two features can put pixels outside a frame: fullscreen, and video
// Picture-in-Picture, which floats a window over everything and is allowed by
// default unless turned off. Both are denied twice — in this page's
// Permissions-Policy header and on the frame element's `allow` attribute.
//
// WHAT IT DOES NOT PROMISE
//
// A document can render a convincing replica of this strip at the bottom of
// its own frame, directly above ours, so the recipient sees two. No technical
// control fixes that. The claim is narrower and exact: the genuine strip and
// its Report link stay PRESENT AND REACHABLE whatever the document does. The
// real one is always bottom-most, directly above the browser's own chrome, and
// its links navigate the whole window to an address the bar confirms; a faked
// one cannot navigate the window at all, because the frame's sandbox forbids
// it.
//
// COLOUR AND FOCUS ARE PART OF THE CONTROL. A strip that is present but
// unreadable is not a control. Text is #3A2818 on #FBF1E8 (12.6:1) and links
// are #7A1F2E on the same ground (9.1:1), both well past the 4.5:1 floor;
// #876959, the graphite used elsewhere in the brand, measures 4.49:1 and is
// deliberately NOT used here. Links carry a visible focus ring, and
// forced-colours mode is handled explicitly.

import { escapeHtml } from './escape.js';

// The sandbox token list, in one place, because it has to be identical on the
// frame element and on every customer-controlled response header (design
// property P5, asserted character-for-character in the tests). index.ts's
// withNoIndex builds its header from this constant.
export const FRAME_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads';

// The WHOLE policy a response carrying customer HTML gets, as ONE header.
//
// It is one header because it used to be two. The opaque-origin sandbox was
// set in index.ts's withNoIndex and the frame-ancestors/base-uri/form-action
// directives in inject.ts, each on its own `Content-Security-Policy`, and a
// response whose shape came out of only one of those two places carried only
// half the defence. Built here, once, so a serving path cannot acquire one
// half without the other.
//
// form-action 'none' is the credential-harvesting defence: a convincing
// sign-in page uploaded as a document cannot post what a visitor types, to us
// or to anyone else. frame-ancestors is 'none' everywhere except the framed
// route, where it becomes 'self' — the wrapper and the frame share a host, so
// 'self' names exactly one framer: us.
//
// NOT for the gate, opt-out and error PAGES. Those are HTMLRadar's own forms
// and they POST back, so form-action 'none' would break the password and
// email gates. They carry the sandbox alone; withNoIndex gives them that.
export const documentCsp = (framed: boolean): string =>
  `sandbox ${FRAME_SANDBOX}; frame-ancestors ${framed ? "'self'" : "'none'"}; ` +
  `base-uri 'none'; form-action 'none'`;

// Denied on the wrapper, and again on the frame — the two features that can
// paint outside a frame's rectangle. camera/microphone/geolocation/payment are
// along for the ride: nothing on this page uses them, and denying them here
// denies them to the framed document too.
export const WRAPPER_PERMISSIONS_POLICY =
  'fullscreen=(), picture-in-picture=(), camera=(), microphone=(), geolocation=(), payment=()';
export const FRAME_PERMISSIONS_POLICY = 'fullscreen=(), picture-in-picture=()';

// Marker header, stripped by withNoIndex on the way out.
//
// Every other response on this worker carries an opaque-origin sandbox CSP,
// which is exactly right for customer HTML and exactly wrong for this page.
// An opaque origin has no registrable domain, and the browser computes a
// request's "same-site" answer from the TOP-LEVEL document's site — so a
// sandboxed wrapper would make its own frame request cross-site and the gate
// cookies auth.ts issues would not be sent with it. The wrapper needs its
// real origin for the same reason it may hold no customer HTML: it is the
// trusted half.
//
// Its own CSP is stricter than the sandbox would be anyway — `default-src
// 'none'` with nonced style and script, nothing external, no forms.
export const OWN_PAGE_HEADER = 'X-HTMLRadar-Own-Page';

export interface WrapperOptions {
  slug: string;
  // Absent when the sender locked the deck: printing is already blocked for
  // those, so the strip carries no Print link.
  printHref: string | null;
  // The print-grant cookie, when this response is the one minting it. Null
  // when the reader already has one — rotating it on every load would kill
  // the grant held by a second tab on the same share.
  setCookie: string | null;
}

// Compact radar mark, drawn in oxblood on the cream strip. Inline SVG, so the
// page loads nothing at all: `img-src data:` and no network fetch.
const RADAR_MARK = `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="#7A1F2E" stroke-width="1.6" opacity="0.5"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#7A1F2E" stroke-width="1.6" opacity="0.75"/><line x1="12" y1="12" x2="12" y2="3" stroke="#7A1F2E" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="#7A1F2E"/></svg>`;

const STYLES = `
html,body{margin:0;padding:0;height:100%;overflow:hidden}
body{display:grid;grid-template-rows:1fr auto;height:100dvh;background:#FBF1E8;color:#3A2818;
font:13px/1.3 -apple-system,BlinkMacSystemFont,"Inter",system-ui,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
-webkit-font-smoothing:antialiased}
#hr-doc{display:block;width:100%;height:100%;min-width:0;min-height:0;border:0;background:#FFFFFF}
.hr-strip{display:flex;align-items:center;gap:7px;min-width:0;min-height:0;height:36px;padding:0 14px;
background:#FBF1E8;border-top:1px solid #E8D5BD;white-space:nowrap;overflow:hidden}
.hr-strip svg{flex:0 0 auto}
.hr-said{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.hr-dot{flex:0 0 auto}
.hr-strip a{color:#7A1F2E;text-decoration:none;border-bottom:1px solid rgba(122,31,46,0.4);padding-bottom:1px}
.hr-strip a:hover{border-bottom-color:#7A1F2E}
.hr-strip a:focus{outline:2px solid #7A1F2E;outline-offset:3px;border-radius:2px}
.hr-strip a:focus-visible{outline:2px solid #7A1F2E;outline-offset:3px;border-radius:2px}
@media (max-width:640px){.hr-strip{height:40px;padding:0 12px;gap:6px}}
@media (forced-colors:active){.hr-strip{background:Canvas;color:CanvasText;border-top:1px solid CanvasText}
.hr-strip a{color:LinkText}}
`.trim();

// One inline script, nonce-protected, doing two things the server cannot.
//
// DEEP ANCHORS. A link like /r/{slug}#pricing never sends its fragment to the
// server, so the fragment is re-applied to the frame's address here and again
// on hashchange. The frame's `src` is in the HTML regardless, so the document
// still loads if this script is blocked; the slug is read back off the
// element rather than interpolated, so no customer string reaches this script
// at all.
//
// SIZING FROM THE VISUAL VIEWPORT. `100dvh` follows a phone's address bar
// sliding away, but a keyboard opening and a pinch zoom move the TOP-LEVEL
// visual viewport without matching geometry inside a frame, which can push
// the strip off screen. The wrapper is trusted code, so it sizes its own grid
// from that viewport.
//
// ponytail: resize only, no scroll handler and no zoom-direction heuristic.
// The real-device comparison (design lane L7, the hard gate before any
// recipient sees a wrapped document) is what tunes this; the design's own
// remedy for a bad number is "the strip's height or the wrapper's sizing",
// which is this line and the 36px above it.
const SCRIPT = `
(function(){
var f=document.getElementById('hr-doc');
if(f){var base=f.getAttribute('src');
var applyHash=function(){var h=location.hash;
if(h&&f.getAttribute('src')!==base+h){f.setAttribute('src',base+h);}};
applyHash();window.addEventListener('hashchange',applyHash);}
var vv=window.visualViewport;
if(vv){var size=function(){if(vv.height>0){document.body.style.height=vv.height+'px';}};
vv.addEventListener('resize',size);size();}
})();
`.trim();

export function wrapperPage(opts: WrapperOptions): Response {
  // Every customer-controlled string that reaches this markup is escaped at
  // assembly, on top of the slug format the database trigger enforces
  // (schema/033). Design property P11: the escaping is the control, the
  // trigger is the belt.
  const slug = escapeHtml(opts.slug);
  const nonce = randomNonce();
  const printLink = opts.printHref
    ? `<span class="hr-dot" aria-hidden="true">·</span><a href="${escapeHtml(opts.printHref)}" target="_blank" rel="noopener">Print</a>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Shared document</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<iframe id="hr-doc" src="/r/${slug}/frame" sandbox="${FRAME_SANDBOX}" allow="fullscreen 'none'; picture-in-picture 'none'" name="" title="Shared document"></iframe>
<footer class="hr-strip">
${RADAR_MARK}
<span class="hr-said">Shared via HTMLRadar</span>
<span class="hr-dot" aria-hidden="true">·</span>
<a href="/r/${slug}/report">Report</a>
${printLink}
</footer>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>
`;

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    // Nothing external loads. frame-src 'self' is the only fetch this page
    // makes, and it is the document.
    'Content-Security-Policy':
      `default-src 'none'; frame-src 'self'; script-src 'nonce-${nonce}'; ` +
      `style-src 'nonce-${nonce}'; img-src data:; form-action 'none'; ` +
      `base-uri 'none'; frame-ancestors 'none'`,
    'Permissions-Policy': WRAPPER_PERMISSIONS_POLICY,
    // The older instruction, kept because this page must never be framed by
    // anyone — including by a sender's document trying to nest it.
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // NOT no-referrer. The first draft set it here and on the frame, which
    // blanked the referral source the tracker records today. What must not
    // leak to the sender is the recipient's identity, and that is enforced by
    // keeping every viewer-identifying value out of the frame address.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // The page carries a short-lived print grant. A cached copy would hand
    // out a dead one, and on a shared machine somebody else's.
    'Cache-Control': 'private, no-store, max-age=0',
    [OWN_PAGE_HEADER]: '1',
  });
  if (opts.setCookie) headers.set('Set-Cookie', opts.setCookie);
  return new Response(html, { status: 200, headers });
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
