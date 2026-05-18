import { describe, expect, it } from 'vitest';
import { geoFromRequest, injectTracker } from '../src/inject.js';
import type { Share } from '../src/supabase.js';

// HTMLRewriter is a Cloudflare-Workers global. Vitest runs in Node where
// it doesn't exist. We don't need to exercise the rewriter's mutation
// logic — the unit tests below assert what `injectTracker` PRODUCES via
// its snippet functions, which are pure strings. The few tests that
// require an actual transform happen at the Playwright level in
// packages/app/e2e/. So we mock HTMLRewriter just enough to let
// injectTracker assemble its snippet strings, capture them, and pass
// through the body unchanged.
class FakeHTMLRewriter {
  private handlers: Record<string, { element(el: FakeElement): void }> = {};
  private appended: { head: string[]; body: string[] } = { head: [], body: [] };
  on(selector: string, handler: { element(el: FakeElement): void }): this {
    this.handlers[selector] = handler;
    return this;
  }
  transform(res: Response): Response {
    const stash = this.appended;
    const headHandler = this.handlers['head'];
    if (headHandler) headHandler.element(new FakeElement(stash.head));
    const bodyHandler = this.handlers['body'];
    if (bodyHandler) bodyHandler.element(new FakeElement(stash.body));
    const original = '__BODY__'; // placeholder; we only care about appends
    const synthetic = [
      '<html><head>',
      stash.head.join(''),
      '</head><body>',
      original,
      stash.body.join(''),
      '</body></html>',
    ].join('');
    return new Response(synthetic, { status: res.status, headers: res.headers });
  }
}
class FakeElement {
  constructor(private appended: string[]) {}
  append(html: string, _opts: { html: true }): void {
    this.appended.push(html);
  }
}
(globalThis as unknown as { HTMLRewriter: typeof FakeHTMLRewriter }).HTMLRewriter =
  FakeHTMLRewriter;

function reqWith(cf: Record<string, unknown> | undefined, ua: string): Request {
  const r = new Request('https://htmlradar.com/r/x', {
    headers: ua ? { 'user-agent': ua } : {},
  });
  if (cf) (r as { cf?: Record<string, unknown> }).cf = cf;
  return r;
}

describe('geoFromRequest', () => {
  it('extracts country + city from Cloudflare request.cf', () => {
    const r = reqWith({ country: 'US', city: 'San Francisco' }, '');
    const geo = geoFromRequest(r);
    expect(geo?.country).toBe('US');
    expect(geo?.city).toBe('San Francisco');
  });

  it('buckets UA strings into desktop/macOS/Safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const geo = geoFromRequest(reqWith(undefined, ua));
    expect(geo?.deviceType).toBe('desktop');
    expect(geo?.os).toBe('macOS');
    expect(geo?.browser).toBe('Safari');
  });

  it('buckets a mobile Chrome on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    const geo = geoFromRequest(reqWith(undefined, ua));
    expect(geo?.deviceType).toBe('mobile');
    expect(geo?.os).toBe('Android');
    expect(geo?.browser).toBe('Chrome');
  });

  it('survives an empty UA without throwing', () => {
    const geo = geoFromRequest(reqWith(undefined, ''));
    expect(geo).toEqual({});
  });
});

// --- Download/screenshot guard injection ----------------------------------

function makeShare(overrides: Partial<Share> = {}): Share {
  return {
    id: 'share-1',
    document_id: 'doc-1',
    owner_id: 'owner-1',
    slug: 'abc123',
    recipient_label: null,
    require_email: false,
    require_password: false,
    allowed_email_domains: null,
    allowed_emails: null,
    allow_download: false,
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function inject(opts: { allowDownload: boolean; email?: string; recipientLabel?: string | null }) {
  const res = injectTracker(
    new Response('<!doctype html><html><head></head><body></body></html>'),
    {
      share: makeShare({
        allow_download: opts.allowDownload,
        ...(opts.recipientLabel !== undefined ? { recipient_label: opts.recipientLabel } : {}),
      }),
      tier: 'pro', // skip chrome footer so we don't fight with it in assertions
      trackerUrl: 'https://htmlradar.com/v1/tracker.js',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      ...(opts.email ? { email: opts.email } : {}),
    },
  );
  return res.text();
}

describe('download/screenshot guard injection', () => {
  it('injects the guard when allow_download = false (default share posture)', async () => {
    const html = await inject({ allowDownload: false });
    expect(html).toContain('htmlradar-guard-style');
    expect(html).toContain('htmlradar-wm');
    expect(html).toContain('@media print');
    expect(html).toContain('contextmenu');
    expect(html).toContain('Printing of this document has been disabled');
  });

  it('does NOT inject the guard when allow_download = true', async () => {
    const html = await inject({ allowDownload: true });
    expect(html).not.toContain('htmlradar-guard-style');
    expect(html).not.toContain('htmlradar-wm');
    expect(html).not.toContain('Printing of this document has been disabled');
  });

  it('uses the recipient email in the watermark when present', async () => {
    const html = await inject({ allowDownload: false, email: 'marc@acme.com' });
    expect(html).toContain('marc@acme.com');
    // Watermark span should appear many times (tiled grid).
    const count = (html.match(/marc@acme\.com/g) ?? []).length;
    expect(count).toBeGreaterThan(20);
  });

  it('falls back to recipient_label when no email is present', async () => {
    const html = await inject({ allowDownload: false, recipientLabel: 'Marc — Series A' });
    expect(html).toContain('Marc — Series A');
  });

  it('falls back to a generic anon notice when neither email nor label is present', async () => {
    const html = await inject({ allowDownload: false, recipientLabel: null });
    expect(html).toContain('Shared via htmlradar.com');
  });

  it('html-escapes the watermark identity so a label with HTML cannot break out', async () => {
    const html = await inject({
      allowDownload: false,
      recipientLabel: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not block keyboard input on form fields (allows recipient to type in sender forms)', async () => {
    const html = await inject({ allowDownload: false });
    // The script body itself must reference INPUT/TEXTAREA/SELECT — that's
    // how we know the in-field bypass exists.
    expect(html).toContain("'INPUT'");
    expect(html).toContain("'TEXTAREA'");
    expect(html).toContain('isContentEditable');
  });

  it('guard sits BEFORE the materials panel in body append order', async () => {
    // Even with allow_download true we still inject materials only when
    // attachments exist. Use a false case to verify guard is present
    // and check ordering with a tier=free chrome footer (free tier
    // appends a watermark-adjacent footer; guard must still come first).
    const res = injectTracker(
      new Response('<!doctype html><html><head></head><body></body></html>'),
      {
        share: makeShare({ allow_download: false }),
        tier: 'free',
        trackerUrl: 'https://htmlradar.com/v1/tracker.js',
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
      },
    );
    const html = await res.text();
    const guardIdx = html.indexOf('htmlradar-guard-style');
    const footerIdx = html.indexOf('Powered by');
    expect(guardIdx).toBeGreaterThan(0);
    expect(footerIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(footerIdx);
  });
});
