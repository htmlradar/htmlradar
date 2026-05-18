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
    const html = await inject({ lockDeck: true, email: 'marc@acme.com' });
    expect(html).toContain('marc@acme.com');
    // Watermark span should appear many times (tiled grid).
    const count = (html.match(/marc@acme\.com/g) ?? []).length;
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
