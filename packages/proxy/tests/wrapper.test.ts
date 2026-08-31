import { describe, expect, it } from 'vitest';
import { wrapperPage, FRAME_SANDBOX, OWN_PAGE_HEADER } from '../src/wrapper.js';

// The trust wrapper's page, asserted against the design it implements:
// docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md.
//
// The layout IS the guarantee here, not decoration on top of one, so the tests
// below read like structural assertions rather than markup snapshots. Three of
// the design's eleven safety properties are pinned in this file:
//
//   P1 — the strip cannot be covered. The grid, the margin/overflow/minimum
//        rules, and the denied fullscreen and Picture-in-Picture permissions.
//        The GEOMETRY half of P1 — that the strip's box and the frame's box
//        intersect in zero pixels, and that elementFromPoint at the strip's
//        centre returns the strip — needs a real browser and belongs to the
//        device lane's packages/app/e2e/trust-layer.spec.ts. What is testable
//        here is that nothing in the page can start that fight: no absolute
//        or fixed positioning, no z-index, no negative margin.
//
//   P2 — the strip stays usable. Owned colours at 4.5:1 and a visible focus
//        ring. The rendered contrast, 200 per cent zoom, a 320-pixel window
//        and forced-colours mode are the device lane's; the declarations that
//        make them possible are here.
//
//   P4 — the Report link cannot be intercepted. Reachability only: the link is
//        an anchor in a document the framed page cannot script. Whether a
//        recipient can tell the genuine strip from a replica is explicitly NOT
//        claimed, by the design or by this file.
//
//   P11 — no customer-controlled string reaches the wrapper unescaped.

const page = (over: Partial<Parameters<typeof wrapperPage>[0]> = {}) =>
  wrapperPage({ slug: 'acme-proposal', printHref: null, setCookie: null, ...over });

const bodyOf = (res: Response): Promise<string> => res.text();

describe('the strip', () => {
  it('says what it is and offers the way to report it', async () => {
    const html = await bodyOf(page());
    expect(html).toContain('Shared via HTMLRadar');
    expect(html).toContain('href="/r/acme-proposal/report"');
  });

  it('puts the Report link in the wrapper, not in the document', async () => {
    // P4. The anchor lives in this page — the one the framed document has no
    // origin to reach into — and the document lives in a frame beside it.
    const html = await bodyOf(page());
    const strip = html.slice(html.indexOf('<footer'));
    expect(strip).toContain('href="/r/acme-proposal/report"');
    expect(strip).not.toContain('<iframe');
    expect(html.indexOf('<iframe')).toBeLessThan(html.indexOf('<footer'));
  });

  it('carries the Print link only when one was granted', async () => {
    expect(await bodyOf(page())).not.toContain('>Print<');
    const withPrint = await bodyOf(page({ printHref: '/r/acme-proposal/print?g=1.abc' }));
    expect(withPrint).toContain('href="/r/acme-proposal/print?g=1.abc"');
    expect(withPrint).toContain('>Print<');
  });

  it('opens Print in its own tab, so the reader does not lose the document', async () => {
    const html = await bodyOf(page({ printHref: '/r/x/print?g=1.abc' }));
    expect(html).toMatch(/print\?g=1\.abc"[^>]*target="_blank"[^>]*rel="noopener"/);
  });
});

describe('the layout is the guarantee', () => {
  it('is a two-row grid filling the dynamic viewport height', async () => {
    const html = await bodyOf(page());
    expect(html).toContain('grid-template-rows:1fr auto');
    expect(html).toContain('height:100dvh');
  });

  it('zeroes the margins and hides the outer overflow', async () => {
    // Nothing may scroll the grid off screen.
    const html = await bodyOf(page());
    expect(html).toContain('html,body{margin:0;padding:0;height:100%;overflow:hidden}');
  });

  it('lets neither cell be pushed past its track by its contents', async () => {
    // min-width/min-height: 0 on a grid item, without which a wide or tall
    // document forces the frame's cell wider or taller than its row.
    const html = await bodyOf(page());
    expect(html).toMatch(/#hr-doc\{[^}]*min-width:0;min-height:0/);
    expect(html).toMatch(/\.hr-strip\{[^}]*min-width:0;min-height:0/);
  });

  it('fills its cell with a borderless frame', async () => {
    const html = await bodyOf(page());
    expect(html).toMatch(/#hr-doc\{[^}]*width:100%;height:100%/);
    expect(html).toMatch(/#hr-doc\{[^}]*border:0/);
  });

  it('never enters the stacking contest the grid exists to avoid', async () => {
    // P1. The strip is BESIDE the document in a different box, not on top of
    // it. A z-index or a fixed position here would be the beginning of a
    // fight the design deliberately does not have.
    const html = await bodyOf(page());
    const styles = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
    expect(styles).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(styles).not.toContain('z-index');
    expect(styles).not.toMatch(/margin[^:]*:\s*-/);
  });

  it('gives the strip a real touch target on a narrow screen', async () => {
    const html = await bodyOf(page());
    expect(html).toContain('height:36px');
    expect(html).toContain('@media (max-width:640px)');
    expect(html).toContain('height:40px');
  });
});

describe('the strip stays usable', () => {
  it('draws its text and links in colours that clear 4.5 to 1 on the strip', async () => {
    // #3A2818 on #FBF1E8 is 12.6:1 and #7A1F2E on it is 9.1:1. #876959, the
    // graphite used elsewhere in the brand, measures 4.49:1 — just under —
    // and must not appear here.
    const html = await bodyOf(page());
    expect(html).toContain('#3A2818');
    expect(html).toContain('#7A1F2E');
    expect(html).not.toContain('#876959');
  });

  it('shows a keyboard focus ring on its links', async () => {
    const html = await bodyOf(page());
    expect(html).toContain('.hr-strip a:focus{outline:2px solid #7A1F2E');
    expect(html).toContain('.hr-strip a:focus-visible{outline:2px solid #7A1F2E');
  });

  it('keeps itself and its links visible in forced-colours mode', async () => {
    const html = await bodyOf(page());
    expect(html).toContain('@media (forced-colors:active)');
    expect(html).toContain('CanvasText');
    expect(html).toContain('LinkText');
  });
});

describe('the frame element', () => {
  it('carries the sandbox list character-for-character', async () => {
    const html = await bodyOf(page());
    expect(html).toContain(`sandbox="allow-scripts allow-forms allow-popups allow-downloads"`);
    expect(FRAME_SANDBOX).toBe('allow-scripts allow-forms allow-popups allow-downloads');
  });

  it('withholds allow-same-origin, which is what makes the strip unremovable', async () => {
    // P3. Without it the document has no origin at all and cannot see the page
    // containing it: parent.document throws.
    const html = await bodyOf(page());
    expect(html).not.toContain('allow-same-origin');
  });

  it('denies the two features that can paint outside a frame', async () => {
    const html = await bodyOf(page());
    expect(html).toContain(`allow="fullscreen 'none'; picture-in-picture 'none'"`);
  });

  it('gives the frame an empty name and a described title', async () => {
    // P9: window.name is one of the values the framed document can read, so it
    // carries nothing.
    const html = await bodyOf(page());
    expect(html).toContain('name=""');
    expect(html).toContain('title="Shared document"');
  });

  it('points at the frame route for this share', async () => {
    expect(await bodyOf(page())).toContain('src="/r/acme-proposal/frame"');
  });
});

describe('the response headers', () => {
  it('loads nothing external and lets nothing but the frame be fetched', async () => {
    const csp = page().headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('img-src data:');
  });

  it('admits script and style only under the nonce it just minted', async () => {
    const res = page();
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
    expect(csp).not.toContain('unsafe-inline');
    const html = await res.text();
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('mints a different nonce every time', () => {
    const first = page().headers.get('Content-Security-Policy');
    const second = page().headers.get('Content-Security-Policy');
    expect(first).not.toBe(second);
  });

  it('denies fullscreen and picture-in-picture at the page level too', async () => {
    const pp = page().headers.get('Permissions-Policy') ?? '';
    expect(pp).toContain('fullscreen=()');
    expect(pp).toContain('picture-in-picture=()');
  });

  it('refuses to be framed itself, and refuses to be sniffed', () => {
    const res = page();
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('keeps the referrer policy the document has today, and not no-referrer', () => {
    // The first draft set no-referrer here and would have blanked the referral
    // source the tracker records. Corrected in the revised design.
    expect(page().headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('is never cached, because it carries a short-lived print grant', () => {
    expect(page().headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  });

  it('sets the print cookie only when it was given a new one', () => {
    expect(page().headers.get('Set-Cookie')).toBeNull();
    const withCookie = page({ setCookie: 'hr_print=abc; Path=/r/; HttpOnly' });
    expect(withCookie.headers.get('Set-Cookie')).toBe('hr_print=abc; Path=/r/; HttpOnly');
  });

  it('marks itself as HTMLRadar’s own page, so the worker leaves its origin alone', () => {
    // withNoIndex sandboxes every response into an opaque origin, which is
    // right for customer HTML and wrong here: a sandboxed wrapper makes its
    // own frame request cross-site and the gate cookies stop being sent. The
    // marker is deleted on the way out — recipient-route.test.ts pins that.
    expect(page().headers.get(OWN_PAGE_HEADER)).toBe('1');
  });
});

describe('no customer-controlled string reaches the page unescaped', () => {
  // P11. The slug format is enforced by a database trigger (schema/033) and
  // the handle format by another (schema/043), so none of these can be stored
  // — the escaping is asserted anyway, because a control that depends on
  // something else holding is not a control.
  const hostile = [
    '"><script>alert(1)</script>',
    "x' onload='alert(1)",
    '</style><style>body{display:none}',
    '../../etc/passwd',
    'a"b',
  ];

  for (const slug of hostile) {
    it(`escapes ${JSON.stringify(slug)}`, async () => {
      const html = await bodyOf(page({ slug }));
      expect(html).not.toContain('<script>alert(1)');
      expect(html).not.toContain("onload='alert(1)");
      expect(html).not.toContain('<style>body{display:none}');
      // The frame source and the report link are the two places it lands, and
      // both must still be one attribute rather than several.
      const frameSrc = /src="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(frameSrc.startsWith('/r/')).toBe(true);
      expect(frameSrc.endsWith('/frame')).toBe(true);
    });
  }

  it('escapes a hostile print address as well', async () => {
    const html = await bodyOf(page({ printHref: '/r/x/print?g=1"><script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('the deep-anchor script', () => {
  it('reads the frame address off the element instead of being handed a slug', async () => {
    // Which is why no customer string is ever in a script context here.
    const html = await bodyOf(page());
    const script = html.slice(html.indexOf('<script nonce'));
    expect(script).toContain("getElementById('hr-doc')");
    expect(script).toContain("getAttribute('src')");
    expect(script).not.toContain('acme-proposal');
  });

  it('leaves the frame address in the markup, so a blocked script still loads it', async () => {
    const html = await bodyOf(page());
    expect(html.indexOf('src="/r/acme-proposal/frame"')).toBeLessThan(html.indexOf('<script'));
  });

  it('re-applies the fragment on hashchange', async () => {
    const html = await bodyOf(page());
    expect(html).toContain("addEventListener('hashchange'");
  });

  it('sizes the grid from the top-level visual viewport', async () => {
    // The mitigation for a keyboard opening or a reader pinching: both move
    // the outer window without moving the frame, and the strip must stay on
    // screen through either.
    const html = await bodyOf(page());
    expect(html).toContain('window.visualViewport');
    expect(html).toContain("addEventListener('resize'");
  });
});
