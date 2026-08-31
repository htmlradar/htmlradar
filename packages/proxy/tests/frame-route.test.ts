import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GET /r/{slug}/frame — the document, served into the trust wrapper's frame.
//
// Design: docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md,
// "The exact frame arrangement". Three of the eleven safety properties are
// pinned here:
//
//   P5 — every customer-controlled response is sandboxed, frame and Print
//        alike. The design's load-bearing condition. The token list is
//        asserted character-for-character.
//   P6 — the frame cannot be a top-level page. Sec-Fetch-Dest: document
//        redirects, absent redirects, iframe serves.
//   P8 — the gates hold on every route. With no gate cookie the frame is
//        not-found for password- and email-required shares, and a cookie
//        scoped to another slug does not work.
//
// What the frame RESPONSE carries once it is served — frame-ancestors 'self',
// no X-Frame-Options, the Permissions-Policy denial and the preserved referrer
// — is asserted in inject.test.ts, where the real injectTracker can run. Here
// injectTracker is mocked, exactly as it is in the other route suites, because
// HTMLRewriter is a Workers global with no Node equivalent.

const share = {
  id: 'share-1',
  document_id: 'doc-1',
  owner_id: 'owner-1',
  slug: 'acme-proposal',
  require_email: false,
  require_password: false,
  allowed_email_domains: null,
  allowed_emails: null,
  expires_at: null,
  revoked_at: null,
  lock_deck: false,
  host_handle: null,
  owner_handle: null,
  owner_tier: 'free',
};

const doc = {
  id: 'doc-1',
  owner_id: 'owner-1',
  title: 'Deck',
  source_type: 'url',
  source_url: 'https://example.test/deck.html',
  r2_key: null,
  current_version: 1,
  deleted_at: null,
};

const getShareBySlug = vi.fn();
const notifyDisabledAttempt = vi.fn(async () => undefined);
const injectTracker = vi.fn(
  async () =>
    new Response('<html><body><h1>Deck</h1></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
);

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    getDocument: vi.fn(async () => doc),
    listAttachmentsForDocument: vi.fn(async () => []),
    getAttachment: vi.fn(async () => null),
    logAppEvent: vi.fn(async () => undefined),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: (...args: unknown[]) => notifyDisabledAttempt(...(args as [])),
  };
});

vi.mock('../src/inject.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inject.js')>('../src/inject.js');
  return { ...actual, injectTracker: (...args: unknown[]) => injectTracker(...(args as [])) };
});

vi.mock('../src/fetch-html.js', () => ({
  fetchDocumentHtml: vi.fn(
    async () => new Response('<html><body><h1>Deck</h1></body></html>', { status: 200 }),
  ),
}));

type Env = import('../src/env.js').Env;

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: 'test-session-secret',
  TRACKER_URL: 'https://htmlradar.com/v1/tracker.js',
} as unknown as Env;

const wrapperOn = { ...baseEnv, TRUST_WRAPPER: '*' } as Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function get(
  path: string,
  headers: Record<string, string> = {},
  env: Env = wrapperOn,
): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(`https://htmlradar.page${path}`, { headers }), env, ctx);
}

// What a browser sends when it is loading a frame. Anything else, its absence
// included, is somebody trying to open the frame address as a page.
const asFrame = { 'Sec-Fetch-Dest': 'iframe' };

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('the gate is the whole of the rollback', () => {
  it('is not-found while TRUST_WRAPPER is unset', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame, baseEnv);
    expect(res.status).toBe(404);
  });

  it('is not-found while TRUST_WRAPPER is empty', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame, { ...baseEnv, TRUST_WRAPPER: '' });
    expect(res.status).toBe(404);
  });

  it('looks nothing up while it is off, so no share leaks and no alert fires', async () => {
    await get('/r/acme-proposal/frame', asFrame, baseEnv);
    expect(getShareBySlug).not.toHaveBeenCalled();
    expect(notifyDisabledAttempt).not.toHaveBeenCalled();
  });

  it('answers a share on the slug list and not one off it', async () => {
    const listed = { ...baseEnv, TRUST_WRAPPER: 'qa-smoke-deck,acme-proposal' } as Env;
    expect((await get('/r/acme-proposal/frame', asFrame, listed)).status).toBe(200);
    getShareBySlug.mockResolvedValue({ ...share, slug: 'other-deck' });
    expect((await get('/r/other-deck/frame', asFrame, listed)).status).toBe(404);
  });

  it('answers every share on "*"', async () => {
    expect((await get('/r/acme-proposal/frame', asFrame)).status).toBe(200);
  });
});

describe('the frame refuses to be a top-level page', () => {
  // P6. Sec-Fetch-Dest is written by the browser and page scripts cannot forge
  // it, so a sender who emails the frame address to skip the badge lands on
  // the wrapper, which is where the badge is.
  it('redirects a request the browser calls a document', async () => {
    const res = await get('/r/acme-proposal/frame', { 'Sec-Fetch-Dest': 'document' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
  });

  it('redirects a request with no Sec-Fetch-Dest at all', async () => {
    const res = await get('/r/acme-proposal/frame');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
  });

  it('redirects an embed, an object and a nested-frame guess alike', async () => {
    // IFRAME is in the list because Sec-Fetch-Dest is a lowercase token by
    // specification: a value the browser would never write is not one to trust.
    for (const dest of ['embed', 'object', 'frame', 'IFRAME']) {
      const res = await get('/r/acme-proposal/frame', { 'Sec-Fetch-Dest': dest });
      expect(res.status, dest).toBe(302);
    }
  });

  it('serves when the browser says iframe', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.status).toBe(200);
  });

  it('is not-found rather than redirected when there is no such share', async () => {
    // The redirect is answered after the share lookup and the stored-hostname
    // check, so a request on a host this share was never created for gets the
    // same not-found as every other route rather than a redirect that says the
    // route exists. handle-routing.test.ts pins that matrix.
    getShareBySlug.mockResolvedValue(null);
    const res = await get('/r/no-such-share/frame', { 'Sec-Fetch-Dest': 'document' });
    expect(res.status).toBe(404);
  });
});

describe('the gates hold on the frame route', () => {
  // P8. Every check the document route makes, repeated — and answered
  // not-found rather than with a gate form, because a password box rendered
  // inside the frame would sit under a badge saying the document is open.
  it('is not-found on a password share with no cookie', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.status).toBe(404);
  });

  it('is not-found on an email share with no cookie', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.status).toBe(404);
  });

  it('serves once the password cookie is presented', async () => {
    const { issueAuthCookie } = await import('../src/auth.js');
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const cookie = (await issueAuthCookie('acme-proposal', 'test-session-secret')).split(';')[0]!;
    const res = await get('/r/acme-proposal/frame', { ...asFrame, cookie });
    expect(res.status).toBe(200);
  });

  it('refuses a cookie minted for another share', async () => {
    const { issueAuthCookie } = await import('../src/auth.js');
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const other = (await issueAuthCookie('other-deck', 'test-session-secret')).split(';')[0]!;
    const res = await get('/r/acme-proposal/frame', { ...asFrame, cookie: other });
    expect(res.status).toBe(404);
  });

  it('refuses an email cookie whose address has since left the allow list', async () => {
    const { issueEmailCookie } = await import('../src/auth.js');
    getShareBySlug.mockResolvedValue({
      ...share,
      require_email: true,
      allowed_emails: ['someone@else.test'],
    });
    const cookie = (
      await issueEmailCookie('acme-proposal', 'reader@example.org', 'test-session-secret')
    ).split(';')[0]!;
    const res = await get('/r/acme-proposal/frame', { ...asFrame, cookie });
    expect(res.status).toBe(404);
  });
});

describe('a disabled share is quiet on the frame route', () => {
  it('is not-found when the sender revoked the link', async () => {
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.status).toBe(404);
  });

  it('is not-found when the link is past its expiry', async () => {
    getShareBySlug.mockResolvedValue({ ...share, expires_at: '2020-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.status).toBe(404);
  });

  it('fires no owner alert, which the wrapper address has already sent', async () => {
    // Two alerts per open would be noise, and this route is reachable only by
    // someone who went round the wrapper.
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-01-01T00:00:00Z' });
    await get('/r/acme-proposal/frame', asFrame);
    expect(notifyDisabledAttempt).not.toHaveBeenCalled();
  });
});

describe('the frame response is sandboxed into an opaque origin', () => {
  // P5, the design's load-bearing condition. Asserted character-for-character,
  // and asserted as a HEADER as well as an attribute, so it holds even if the
  // frame element's own sandbox were bypassed.
  it('carries the sandbox token list exactly', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame);
    const policies = res.headers.get('Content-Security-Policy') ?? '';
    expect(policies).toContain('sandbox allow-scripts allow-forms allow-popups allow-downloads');
  });

  it('withholds allow-same-origin, which is what denies the document an origin', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.headers.get('Content-Security-Policy')).not.toContain('allow-same-origin');
  });

  it('tells injectTracker this response is the framed one', async () => {
    // Which is what turns frame-ancestors to 'self' and drops the older
    // X-Frame-Options that would override it. inject.test.ts asserts what that
    // produces.
    await get('/r/acme-proposal/frame', asFrame);
    expect(injectTracker.mock.calls[0]![1]).toMatchObject({ framed: true });
  });

  it('does not mark the unwrapped document as framed', async () => {
    await get('/r/acme-proposal', {}, baseEnv);
    expect(injectTracker.mock.calls[0]![1]).toMatchObject({ framed: false });
  });

  it('still carries the noindex header every proxy response carries', async () => {
    const res = await get('/r/acme-proposal/frame', asFrame);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('the wrapper is served at the address the recipient already has', () => {
  it('answers /r/{slug} with the wrapper once the gate is on', async () => {
    const res = await get('/r/acme-proposal', {}, wrapperOn);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Shared via HTMLRadar');
    expect(html).toContain('src="/r/acme-proposal/frame"');
    // The document itself was never fetched for this response: the frame
    // route does that, one extra request on the same connection.
    expect(injectTracker).not.toHaveBeenCalled();
  });

  it('leaves its origin alone, so the frame request still carries the gate cookies', async () => {
    // An opaque origin has no registrable domain, and the browser decides a
    // request's same-site question from the top-level document's site. A
    // sandboxed wrapper would make its own frame request cross-site and the
    // gate cookies would stop being sent with it.
    const res = await get('/r/acme-proposal', {}, wrapperOn);
    expect(res.headers.get('Content-Security-Policy')).not.toContain('sandbox');
    expect(res.headers.get('X-HTMLRadar-Own-Page')).toBeNull();
  });

  it('serves the document itself while the gate is off, exactly as before', async () => {
    const res = await get('/r/acme-proposal', {}, baseEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Deck</h1>');
    expect(injectTracker).toHaveBeenCalled();
  });

  it('shows the sender their own document unwrapped on an owner preview', async () => {
    // The badge is a recipient-facing control, and the preview token already
    // bypasses every other recipient gate.
    const { issueOwnerPreviewToken } = await import('../src/auth.js');
    const token = await issueOwnerPreviewToken('acme-proposal', 'test-session-secret');
    const res = await get(`/r/acme-proposal?owner_preview=${token}`, {}, wrapperOn);
    expect(res.status).toBe(200);
    expect(injectTracker).toHaveBeenCalled();
  });

  it('keeps the Report link reachable, whatever the document draws', async () => {
    // P4, the reachability half. The design's badge-spoof fixture draws a
    // pixel-accurate replica of the strip with a Report link pointing
    // elsewhere; what is claimed, and all that is claimed, is that the genuine
    // link is still in the wrapper and still answers. Whether a recipient can
    // tell the two apart is explicitly NOT claimed, and the screenshot
    // evidence of that stated limit belongs to the device lane.
    const html = await (await get('/r/acme-proposal', {}, wrapperOn)).text();
    const href = /href="(\/r\/acme-proposal\/report)"/.exec(html)?.[1];
    expect(href).toBe('/r/acme-proposal/report');
    const reported = await get(href!, {}, wrapperOn);
    expect(reported.status).toBe(200);
    expect(await reported.text()).toContain('Report');
  });

  it('shows the password gate at the wrapper address, not a wrapped one', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await get('/r/acme-proposal', {}, wrapperOn);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/r/acme-proposal/auth"');
    expect(html).not.toContain('<iframe');
  });
});
