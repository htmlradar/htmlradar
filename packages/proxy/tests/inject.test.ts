import { afterEach, describe, expect, it } from 'vitest';
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
// Which structural anchors the source doc "has". Real HTMLRewriter only
// fires an element handler when that tag physically exists in the stream —
// a fragment upload with no <head>/<body> fires neither. Tests flip these
// to exercise the document-end fallback; afterEach resets to a normal doc.
let mockPresence = { head: true, body: true };

class FakeHTMLRewriter {
  private handlers: Record<string, { element(el: FakeElement): void }> = {};
  private docHandler: { end(end: FakeDocEnd): void } | null = null;
  private appended: { head: string[]; body: string[]; doc: string[] } = {
    head: [],
    body: [],
    doc: [],
  };
  on(selector: string, handler: { element(el: FakeElement): void }): this {
    this.handlers[selector] = handler;
    return this;
  }
  onDocument(handler: { end(end: FakeDocEnd): void }): this {
    this.docHandler = handler;
    return this;
  }
  transform(res: Response): Response {
    const stash = this.appended;
    if (mockPresence.head && this.handlers['head']) {
      this.handlers['head'].element(new FakeElement(stash.head));
    }
    if (mockPresence.body && this.handlers['body']) {
      this.handlers['body'].element(new FakeElement(stash.body));
    }
    // Document end ALWAYS fires, exactly like the real rewriter.
    if (this.docHandler) this.docHandler.end(new FakeDocEnd(stash.doc));
    const head = mockPresence.head ? `<head>${stash.head.join('')}</head>` : '';
    const body = mockPresence.body ? `<body>__BODY__${stash.body.join('')}</body>` : '__BODY__';
    // Doc-end appends land after the document, mirroring end.append().
    const synthetic = `<html>${head}${body}</html>${stash.doc.join('')}`;
    return new Response(synthetic, { status: res.status, headers: res.headers });
  }
}
class FakeElement {
  constructor(private appended: string[]) {}
  append(html: string, _opts: { html: true }): void {
    this.appended.push(html);
  }
}
class FakeDocEnd {
  constructor(private appended: string[]) {}
  append(html: string, _opts: { html: true }): void {
    this.appended.push(html);
  }
}
(globalThis as unknown as { HTMLRewriter: typeof FakeHTMLRewriter }).HTMLRewriter =
  FakeHTMLRewriter;

afterEach(() => {
  mockPresence = { head: true, body: true };
});

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
    lock_deck: true,
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function inject(opts: { lockDeck: boolean; email?: string; recipientLabel?: string | null }) {
  const res = injectTracker(
    new Response('<!doctype html><html><head></head><body></body></html>'),
    {
      share: makeShare({
        lock_deck: opts.lockDeck,
        ...(opts.recipientLabel !== undefined ? { recipient_label: opts.recipientLabel } : {}),
      }),
      tier: 'pro', // skip chrome footer so we don't fight with it in assertions
      trackingEnabled: true,
      trackerUrl: 'https://htmlradar.com/v1/tracker.js',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      ...(opts.email ? { email: opts.email } : {}),
    },
  );
  return res.text();
}

describe('download/screenshot guard injection (lock_deck semantic)', () => {
  it('injects the guard when lock_deck = true (default share posture)', async () => {
    const html = await inject({ lockDeck: true });
    expect(html).toContain('htmlradar-guard-style');
    expect(html).toContain('htmlradar-wm');
    expect(html).toContain('@media print');
    expect(html).toContain('contextmenu');
    expect(html).toContain('Printing of this document has been disabled');
  });

  it('does NOT inject the guard when lock_deck = false', async () => {
    const html = await inject({ lockDeck: false });
    expect(html).not.toContain('htmlradar-guard-style');
    expect(html).not.toContain('htmlradar-wm');
    expect(html).not.toContain('Printing of this document has been disabled');
  });

  it('uses the recipient email in the watermark when present', async () => {
    const html = await inject({ lockDeck: true, email: 'marc@example.com' });
    expect(html).toContain('marc@example.com');
    // Watermark span should appear many times (tiled grid).
    const count = (html.match(/marc@example\.com/g) ?? []).length;
    expect(count).toBeGreaterThan(20);
  });

  it('falls back to recipient_label when no email is present', async () => {
    const html = await inject({ lockDeck: true, recipientLabel: 'Marc — Series A' });
    expect(html).toContain('Marc — Series A');
  });

  it('falls back to a generic anon notice when neither email nor label is present', async () => {
    const html = await inject({ lockDeck: true, recipientLabel: null });
    expect(html).toContain('Shared via htmlradar.com');
  });

  it('html-escapes the watermark identity so a label with HTML cannot break out', async () => {
    const html = await inject({
      lockDeck: true,
      recipientLabel: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not block keyboard input on form fields (allows recipient to type in sender forms)', async () => {
    const html = await inject({ lockDeck: true });
    // The script body itself must reference INPUT/TEXTAREA/SELECT — that's
    // how we know the in-field bypass exists.
    expect(html).toContain("'INPUT'");
    expect(html).toContain("'TEXTAREA'");
    expect(html).toContain('isContentEditable');
  });

  it('guard sits BEFORE the chrome footer in body append order', async () => {
    // Free tier ALSO injects a "Powered by" chrome footer. Order
    // matters: guard styles + watermark must be in the DOM before the
    // footer so the footer is also covered by the protection layer.
    const res = injectTracker(
      new Response('<!doctype html><html><head></head><body></body></html>'),
      {
        share: makeShare({ lock_deck: true }),
        tier: 'free',
        trackingEnabled: true,
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

// New tests for the corner-pill attachments UI introduced in Batch A.
describe('attachments panel — corner pill UI', () => {
  function injectWithAttachments(args: {
    lockDeck: boolean;
    attachments: Array<{ id: string; filename: string; mime_type: string; size_bytes: number }>;
  }) {
    const res = injectTracker(
      new Response('<!doctype html><html><head></head><body></body></html>'),
      {
        share: makeShare({ lock_deck: args.lockDeck }),
        tier: 'pro',
        trackingEnabled: true,
        trackerUrl: 'https://htmlradar.com/v1/tracker.js',
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
        attachments: args.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          document_id: 'doc-1',
          r2_key: 'k',
          created_at: '2026-05-18',
        })),
      },
    );
    return res.text();
  }

  const sample = [
    {
      id: 'a1',
      filename: 'Financials_v3.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1_800_000,
    },
    {
      id: 'a2',
      filename: 'Cap_table.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size_bytes: 84_000,
    },
  ];

  it('injects the pill + drawer when attachments are present (regardless of lock_deck)', async () => {
    const html = await injectWithAttachments({ lockDeck: true, attachments: sample });
    expect(html).toContain('hr-att-pill');
    expect(html).toContain('hr-att-drawer');
    expect(html).toContain('Files in this share');
    expect(html).toContain('Financials_v3.pdf');
    expect(html).toContain('Cap_table.xlsx');
  });

  it('also injects the panel when lock_deck = false (decoupled from deck-lock)', async () => {
    const html = await injectWithAttachments({ lockDeck: false, attachments: sample });
    expect(html).toContain('hr-att-pill');
    expect(html).toContain('Financials_v3.pdf');
  });

  it('renders the file count badge accurately', async () => {
    const html = await injectWithAttachments({ lockDeck: true, attachments: sample });
    // Pill badge shows the count.
    expect(html).toContain('hr-att-pill-count">2');
    // Drawer subheading: "2 attached"
    expect(html).toContain('2 attached');
  });

  it('does NOT inject pill or drawer when there are zero attachments', async () => {
    const html = await injectWithAttachments({ lockDeck: true, attachments: [] });
    expect(html).not.toContain('hr-att-pill');
    expect(html).not.toContain('hr-att-drawer');
  });

  it('download links route to /r/{slug}/m/{attachment_id}', async () => {
    const html = await injectWithAttachments({ lockDeck: true, attachments: sample });
    expect(html).toContain('/r/abc123/m/a1');
    expect(html).toContain('/r/abc123/m/a2');
  });

  it('escapes filenames so a malicious attachment name cannot inject markup', async () => {
    const html = await injectWithAttachments({
      lockDeck: true,
      attachments: [
        {
          id: 'evil',
          filename: '<script>alert(1)</script>.pdf',
          mime_type: 'application/pdf',
          size_bytes: 100,
        },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>.pdf');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;.pdf');
  });
});

// Regression guard for the 2026-07-08 incident: a customer uploaded an HTML
// fragment (no <head>/<html>/<body> tags). HTMLRewriter's element handlers
// never fired, so the tracker script was silently dropped — the doc served
// fine but recorded zero sessions, zero analytics, and sent no first-open
// email. The document-end fallback must inject the tracker regardless.
describe('fragment / headless document fallback', () => {
  const opts = {
    tier: 'pro' as const,
    trackingEnabled: true,
    trackerUrl: 'https://htmlradar.com/v1/tracker.js',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
  };

  it('still injects the tracker when the upload has no <head> or <body>', async () => {
    mockPresence = { head: false, body: false };
    const res = injectTracker(new Response('<div class="wrap">just a fragment</div>'), {
      share: makeShare({ lock_deck: false }),
      ...opts,
    });
    const html = await res.text();
    expect(html).toContain('https://htmlradar.com/v1/tracker.js');
    expect(html).toContain('HTMLRadarConfig');
  });

  it('injects the tracker exactly once when <head> exists (no double-inject)', async () => {
    const res = injectTracker(
      new Response('<!doctype html><html><head></head><body></body></html>'),
      { share: makeShare({ lock_deck: false }), ...opts },
    );
    const html = await res.text();
    const count = (html.match(/HTMLRadarConfig/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('still injects the free-tier footer + lock guard on a headless doc', async () => {
    mockPresence = { head: false, body: false };
    const res = injectTracker(new Response('<div>frag</div>'), {
      share: makeShare({ lock_deck: true }),
      ...opts,
      tier: 'free',
    });
    const html = await res.text();
    expect(html).toContain('Powered by');
    expect(html).toContain('htmlradar-guard-style');
  });
});

describe('recipient analytics boundaries', () => {
  const baseOptions = {
    share: makeShare({ lock_deck: false }),
    trackerUrl: 'https://htmlradar.com/v1/tracker.js',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
    trackingEnabled: true,
  };

  it('keeps tracking and the Powered by footer on a free recipient view', async () => {
    const response = injectTracker(new Response('<html><head></head><body></body></html>'), {
      ...baseOptions,
      tier: 'free',
    });
    const html = await response.text();
    expect(html).toContain('HTMLRadarConfig');
    expect(html).toContain('Powered by');
  });

  it('keeps tracking but omits the Powered by footer on a Pro recipient view', async () => {
    const response = injectTracker(new Response('<html><head></head><body></body></html>'), {
      ...baseOptions,
      tier: 'pro',
    });
    const html = await response.text();
    expect(html).toContain('HTMLRadarConfig');
    expect(html).not.toContain('Powered by');
  });

  it('shows the free-tier footer without creating recipient analytics in an owner preview', async () => {
    const response = injectTracker(new Response('<html><head></head><body></body></html>'), {
      ...baseOptions,
      tier: 'free',
      trackingEnabled: false,
    });
    const html = await response.text();
    expect(html).toContain('Powered by');
    expect(html).not.toContain('HTMLRadarConfig');
    expect(html).not.toContain('https://htmlradar.com/v1/tracker.js');
  });
});
