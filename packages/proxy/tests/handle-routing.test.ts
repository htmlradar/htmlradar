import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Which host may serve which share.
//
// Design: docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md,
// "Which host serves what". The routing key is a per-share field, not the
// owner's profile: every share carries a nullable, immutable `host_handle`
// (schema/043), and ROUTING FOLLOWS THAT VALUE, NEVER THE OWNER'S CURRENT
// HANDLE. That is what keeps "already-sent links never move" true when an
// owner is given a handle later or renames an account, and it is why the first
// draft's backfill was cancelled.
//
// The five rules, and where each is pinned below:
//
//   1. Apex request, share stores no hostname: served in place, forever.
//   2. Apex request, share stores a hostname: permanent redirect to it.
//   3. A handle host that does not match the stored hostname: not found.
//   4. Only the apex or exactly one handle label is accepted; extra levels,
//      unknown handles and owner mismatches all return the IDENTICAL not-found
//      response, so probing reveals nothing.
//   5. The legacy host keeps redirecting, and keeps serving its POSTs in
//      place, which host-routing.test.ts already covers.
//
// P10 — one customer's host never serves another's document — is this file,
// repeated across every route that carries a share identifier. Leaving the
// check on the document route alone would leave the gates, the report form,
// the frame, print and attachment downloads as ways to reach a share from a
// host it was never created for.

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

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    getDocument: vi.fn(async () => doc),
    getAttachment: vi.fn(async () => null),
    listAttachmentsForDocument: vi.fn(async () => []),
    logAppEvent: vi.fn(async () => undefined),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: vi.fn(async () => undefined),
  };
});

vi.mock('../src/inject.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inject.js')>('../src/inject.js');
  return {
    ...actual,
    injectTracker: vi.fn(
      async () =>
        new Response('<html><body><h1>Deck</h1></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    ),
  };
});

vi.mock('../src/fetch-html.js', () => ({
  fetchDocumentHtml: vi.fn(
    async () => new Response('<html><body><h1>Deck</h1></body></html>', { status: 200 }),
  ),
}));

type Env = import('../src/env.js').Env;

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: 'test-session-secret',
  TRACKER_URL: 'https://htmlradar.com/v1/tracker.js',
  TRUST_WRAPPER: '*',
} as unknown as Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function fetchAs(url: string, init: RequestInit = {}, e: Env = env): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(url, init), e, ctx);
}

// Every route that carries a share identifier. The frame and print routes need
// the trust wrapper on, which is why this file runs with TRUST_WRAPPER = "*";
// the other four behave identically either way.
const SHARE_ROUTES = [
  { name: 'the document', path: '/r/acme-proposal', init: {} },
  { name: 'the report form', path: '/r/acme-proposal/report', init: {} },
  {
    name: 'the frame',
    path: '/r/acme-proposal/frame',
    init: { headers: { 'Sec-Fetch-Dest': 'iframe' } },
  },
  { name: 'print', path: '/r/acme-proposal/print?g=1.deadbeef', init: {} },
  {
    name: 'an attachment download',
    path: '/r/acme-proposal/m/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    init: {},
  },
  {
    name: 'the password gate',
    path: '/r/acme-proposal/auth',
    init: { method: 'POST', body: new URLSearchParams({ password: 'x' }) },
  },
  {
    name: 'the email gate',
    path: '/r/acme-proposal/email',
    init: { method: 'POST', body: new URLSearchParams({ email: 'reader@example.org' }) },
  },
];

// The one answer every refusal gives, so that "wrong handle", "unknown
// handle", "extra hostname level" and "no such share" are indistinguishable
// from outside.
async function expectStandardNotFound(res: Response, label: string): Promise<void> {
  expect(res.status, label).toBe(404);
  expect(res.headers.get('X-Robots-Tag'), label).toBe('noindex, nofollow');
  expect(await res.text(), label).toContain("This link doesn't open anything.");
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('rule 1 — a share with no stored hostname is served on the apex, forever', () => {
  it('serves the document', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal');
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('never redirects any of its routes anywhere', async () => {
    for (const route of SHARE_ROUTES) {
      const res = await fetchAs(`https://htmlradar.page${route.path}`, route.init);
      expect([200, 302, 303, 404], route.name).toContain(res.status);
      expect(res.status, route.name).not.toBe(301);
      expect(res.status, route.name).not.toBe(308);
    }
  });

  it('is not found on any handle host at all', async () => {
    // These are the links already in somebody's inbox. They belong to the
    // apex and to nowhere else.
    for (const route of SHARE_ROUTES) {
      const res = await fetchAs(`https://acme.htmlradar.page${route.path}`, route.init);
      await expectStandardNotFound(res, route.name);
    }
  });
});

describe('rule 2 — a share that stores a hostname is redirected there from the apex', () => {
  beforeEach(() => getShareBySlug.mockResolvedValue({ ...share, host_handle: 'acme' }));

  it('redirects the document permanently, path and query intact', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal?utm=1');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://acme.htmlradar.page/r/acme-proposal?utm=1');
  });

  it('redirects every share-bearing route, not only the document', async () => {
    for (const route of SHARE_ROUTES) {
      const res = await fetchAs(`https://htmlradar.page${route.path}`, route.init);
      expect([301, 308], route.name).toContain(res.status);
      expect(res.headers.get('Location'), route.name).toContain('https://acme.htmlradar.page/r/');
    }
  });

  it('moves a gate submission with 308, which keeps what the recipient typed', async () => {
    // Never 301: it would turn the POST into a GET and drop the body, so the
    // password or address a recipient just typed would be silently lost.
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/auth', {
      method: 'POST',
      body: new URLSearchParams({ password: 'correct-horse' }),
    });
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('https://acme.htmlradar.page/r/acme-proposal/auth');
  });

  it('serves it in place on its own host', async () => {
    const res = await fetchAs('https://acme.htmlradar.page/r/acme-proposal');
    expect(res.status).toBe(200);
  });
});

describe('rule 3 — a handle host serves only the shares that stored it', () => {
  it('is not found on another customer’s host, on every route', async () => {
    // Without this an abuser could have their own document served on a rival's
    // host, and poison a name they do not own.
    getShareBySlug.mockResolvedValue({ ...share, host_handle: 'acme' });
    for (const route of SHARE_ROUTES) {
      const res = await fetchAs(`https://rival.htmlradar.page${route.path}`, route.init);
      await expectStandardNotFound(res, route.name);
    }
  });

  it('is not found on a name nobody owns, however official it reads', async () => {
    getShareBySlug.mockResolvedValue({ ...share, host_handle: 'acme' });
    for (const host of ['microsoft', 'login', 'secure', 'billing']) {
      const res = await fetchAs(`https://${host}.htmlradar.page/r/acme-proposal`);
      await expectStandardNotFound(res, host);
    }
  });

  it('follows the stored hostname and not the owner’s current handle', async () => {
    // An owner given a handle later, or renamed, must not move a link that has
    // already been sent.
    getShareBySlug.mockResolvedValue({ ...share, host_handle: null, owner_handle: 'acme' });
    expect((await fetchAs('https://htmlradar.page/r/acme-proposal')).status).toBe(200);
    await expectStandardNotFound(
      await fetchAs('https://acme.htmlradar.page/r/acme-proposal'),
      'owner handle set, share hostname null',
    );
  });
});

describe('rule 4 — only the apex, or exactly one handle label', () => {
  it('refuses an extra hostname level', async () => {
    for (const host of ['a.b.htmlradar.page', 'deck.acme.htmlradar.page', 'x.y.z.htmlradar.page']) {
      await expectStandardNotFound(await fetchAs(`https://${host}/r/acme-proposal`), host);
    }
  });

  it('refuses a label the handle format would never permit', async () => {
    // The same rule as the database's check constraint: three to twenty-four
    // characters, no leading or trailing hyphen, no consecutive hyphens.
    for (const host of ['-acme', 'acme-', 'ac--me', 'a', 'ab', 'a'.repeat(25), 'ACME_CO']) {
      await expectStandardNotFound(await fetchAs(`https://${host}.htmlradar.page/r/x`), host);
    }
  });

  it('refuses a refused hostname on every path, not only the share routes', async () => {
    // Answered before the path is even looked at, so an extra level cannot
    // reach a single route.
    for (const path of ['/robots.txt', '/v1/tracker.js', '/', '/anything']) {
      const res = await fetchAs(`https://a.b.htmlradar.page${path}`);
      expect(res.status, path).toBe(404);
    }
  });

  it('gives a wrong handle, an unknown handle and an extra level one answer', async () => {
    getShareBySlug.mockResolvedValue({ ...share, host_handle: 'acme' });
    const bodies = await Promise.all(
      [
        'https://rival.htmlradar.page/r/acme-proposal',
        'https://nobody.htmlradar.page/r/acme-proposal',
        'https://a.b.htmlradar.page/r/acme-proposal',
      ].map(async (u) => {
        const res = await fetchAs(u);
        return `${res.status}:${await res.text()}`;
      }),
    );
    // And identical to a slug that simply does not exist.
    getShareBySlug.mockResolvedValue(null);
    const missing = await fetchAs('https://htmlradar.page/r/no-such-share');
    bodies.push(`${missing.status}:${await missing.text()}`);
    expect(new Set(bodies).size).toBe(1);
  });

  it('refuses before it looks anything up', async () => {
    await fetchAs('https://a.b.htmlradar.page/r/acme-proposal');
    expect(getShareBySlug).not.toHaveBeenCalled();
  });
});

describe('hosts that are not under the share host keep behaving as they always did', () => {
  it('serves a self-hoster’s own host', async () => {
    const selfHosted = { ...env, SHARE_HOST: 'docs.example.org', LEGACY_HOSTS: '' } as Env;
    const res = await fetchAs('https://docs.example.org/r/acme-proposal', {}, selfHosted);
    expect(res.status).toBe(200);
  });

  it('serves a handle host under a self-hoster’s own share host', async () => {
    const selfHosted = { ...env, SHARE_HOST: 'docs.example.org', LEGACY_HOSTS: '' } as Env;
    getShareBySlug.mockResolvedValue({ ...share, host_handle: 'acme' });
    const res = await fetchAs('https://acme.docs.example.org/r/acme-proposal', {}, selfHosted);
    expect(res.status).toBe(200);
  });

  it('serves localhost, so wrangler dev behaves', async () => {
    const res = await fetchAs('http://localhost:8787/r/acme-proposal');
    expect(res.status).toBe(200);
  });

  it('leaves the legacy host redirect exactly where it was', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.page/r/acme-proposal');
  });
});
