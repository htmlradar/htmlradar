import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The document's Content-Security-Policy, end to end through the worker, with
// the REAL injectTracker running.
//
// WHY THIS FILE EXISTS. The policy used to be assembled in two places: the
// opaque-origin sandbox in index.ts's withNoIndex, and
// frame-ancestors/base-uri/form-action in inject.ts, each on its own
// `Content-Security-Policy` header. Every route suite mocks injectTracker,
// because HTMLRewriter is a Workers global with no Node equivalent — so no
// test ever saw both halves on one response, and a serving path that got only
// one of them (the sender's own raw preview did) went unnoticed. The two are
// one header now, built by documentCsp, and this file is where a served
// response is checked as a whole.
//
// The fake rewriter below is the smallest thing that lets injectTracker run
// here: what it INJECTS is inject.test.ts's business, what a served response
// CARRIES is this file's.

class FakeHTMLRewriter {
  on(): this {
    return this;
  }
  onDocument(): this {
    return this;
  }
  transform(res: Response): Response {
    return res;
  }
}
(globalThis as unknown as { HTMLRewriter: unknown }).HTMLRewriter = FakeHTMLRewriter;

const SECRET = 'test-session-secret';
const DOC_ID = 'deadbeef-0000-4000-8000-000000000001';

const share = {
  id: 'share-1',
  document_id: DOC_ID,
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
  id: DOC_ID,
  owner_id: 'owner-1',
  title: 'Deck',
  source_type: 'url',
  source_url: 'https://example.test/deck.html',
  r2_key: null,
  current_version: 1,
  deleted_at: null,
};

const getShareBySlug = vi.fn();

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    getDocument: vi.fn(async () => doc),
    listAttachmentsForDocument: vi.fn(async () => []),
    getAttachment: vi.fn(async () => null),
    logAppEvent: vi.fn(async () => undefined),
    logAttachmentDownload: vi.fn(async () => undefined),
    getViewerIdByShareEmail: vi.fn(async () => null),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: vi.fn(async () => undefined),
  };
});

vi.mock('../src/fetch-html.js', () => ({
  fetchDocumentHtml: vi.fn(
    async () =>
      new Response('<html><head></head><body><h1>Deck</h1></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
  ),
}));

type Env = import('../src/env.js').Env;

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: SECRET,
  TRACKER_URL: 'https://htmlradar.com/v1/tracker.js',
} as unknown as Env;

const wrapperOn = { ...baseEnv, TRUST_WRAPPER: '*' } as Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

// Drains the body before handing the response back. The real injectTracker
// streams, and a response left unread keeps its stream — and the vitest worker
// that owns it — alive past the end of the run.
async function get(
  path: string,
  headers: Record<string, string> = {},
  env: Env = baseEnv,
): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  const res = await worker.fetch(
    new Request(`https://htmlradar.page${path}`, { headers }),
    env,
    ctx,
  );
  const body = await res.text();
  return new Response(body, { status: res.status, headers: res.headers });
}

const csp = (res: Response): string => res.headers.get('Content-Security-Policy') ?? '';

// The exact header, spelled out rather than assembled from the source
// constants, so a change to either half has to be made here on purpose.
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-downloads';
const UNFRAMED = `${SANDBOX}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
const FRAMED = `${SANDBOX}; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;

// The sender's own preview of a raw upload. The app mints this token; the
// proxy only verifies it, so the test mints one the same way auth.ts does.
async function docPreviewPath(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`owner-doc-preview:${DOC_ID}:${expiresAt}`)),
  );
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  const mac = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `/r/_doc/${DOC_ID}?owner_doc_preview=${DOC_ID}.${expiresAt}.${mac}`;
}

// The print route is reachable only through the wrapper, which hands out both
// halves of the binding: the cookie and the signed grant in its Print link.
async function openWrapperForPrint(): Promise<{ cookie: string; path: string }> {
  const res = await get('/r/acme-proposal', {}, wrapperOn);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const html = await res.text();
  const href = /href="(\/r\/acme-proposal\/print\?g=[^"]+)"/.exec(html)?.[1] ?? '';
  return { cookie: setCookie.split(';')[0] ?? '', path: href };
}

async function emailCookieHeader(): Promise<string> {
  const { issueEmailCookie } = await import('../src/auth.js');
  const cookie = await issueEmailCookie('acme-proposal', 'reader@example.org', SECRET);
  return cookie.split(';')[0] ?? '';
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('one merged policy on every response that carries customer HTML', () => {
  it('the ungated document', async () => {
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(UNFRAMED);
  });

  it('the same document once its email gate has been passed', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await get('/r/acme-proposal', { cookie: await emailCookieHeader() });
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(UNFRAMED);
  });

  it("the frame route, which is the one place frame-ancestors is 'self'", async () => {
    const res = await get('/r/acme-proposal/frame', { 'Sec-Fetch-Dest': 'iframe' }, wrapperOn);
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(FRAMED);
  });

  it('the print route, which is not framed', async () => {
    const { cookie, path } = await openWrapperForPrint();
    const res = await get(path, { cookie }, wrapperOn);
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(UNFRAMED);
  });

  it("the sender's own preview of a raw upload, which builds its own response", async () => {
    const res = await get(await docPreviewPath());
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(UNFRAMED);
  });

  it('is one header, not two — which is how the two halves came apart', async () => {
    const res = await get('/r/acme-proposal');
    expect([...res.headers].filter(([name]) => name === 'content-security-policy')).toHaveLength(1);
    expect(csp(res)).not.toContain(',');
  });
});

// The regression this file was written for. Walk the routes; every response
// whose body is somebody's uploaded HTML must carry the credential-harvesting
// defence, and none of them may be given an origin.
describe("form-action 'none' on every response whose body is customer HTML", () => {
  const documentRoutes: Array<[string, () => Promise<Response>]> = [
    ['the ungated document', () => get('/r/acme-proposal')],
    [
      'the gated document, passed',
      async () => {
        getShareBySlug.mockResolvedValue({ ...share, require_email: true });
        return get('/r/acme-proposal', { cookie: await emailCookieHeader() });
      },
    ],
    [
      'the frame route',
      () => get('/r/acme-proposal/frame', { 'Sec-Fetch-Dest': 'iframe' }, wrapperOn),
    ],
    [
      'the print route',
      async () => {
        const { cookie, path } = await openWrapperForPrint();
        return get(path, { cookie }, wrapperOn);
      },
    ],
    ["the sender's raw preview", async () => get(await docPreviewPath())],
  ];

  for (const [name, fetchIt] of documentRoutes) {
    it(`${name} refuses every form submission`, async () => {
      const res = await fetchIt();
      expect(res.status).toBe(200);
      expect(csp(res)).toContain("form-action 'none'");
      expect(csp(res)).toContain("base-uri 'none'");
      expect(csp(res)).toContain(SANDBOX);
      expect(csp(res)).not.toContain('allow-same-origin');
    });
  }
});

// The deliberate exceptions, so a later merge cannot quietly widen the rule
// into the pages that need to post back.
describe("HTMLRadar's own pages are not documents", () => {
  it('the email gate keeps the sandbox and does NOT get form-action, so it can post', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(200);
    expect(csp(res)).toBe(SANDBOX);
  });

  it('the password gate the same', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await get('/r/acme-proposal');
    expect(csp(res)).toBe(SANDBOX);
  });

  it('a not-found is sandboxed like everything else', async () => {
    getShareBySlug.mockResolvedValue(null);
    const res = await get('/r/no-such-link');
    expect(res.status).toBe(404);
    expect(csp(res)).toBe(SANDBOX);
  });

  it('the trust wrapper keeps its real origin and its own stricter policy', async () => {
    const res = await get('/r/acme-proposal', {}, wrapperOn);
    expect(res.status).toBe(200);
    expect(csp(res)).not.toContain('sandbox');
    expect(csp(res)).toContain("form-action 'none'");
    expect(res.headers.get('X-HTMLRadar-Own-Page')).toBeNull();
  });
});
