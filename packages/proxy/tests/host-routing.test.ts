import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Which host the worker was asked on decides what it does.
//
// Recipient documents live on SHARE_HOST — a registrable domain of their own,
// so a customer's HTML never shares an origin with the application's session
// cookies and never borrows the primary domain's reputation. Every link sent
// before the move points at a LEGACY_HOST, and those must keep opening.
//
// The three behaviours guarded here:
//
//   1. A GET or HEAD on a legacy host is a 301 to the same path and query on
//      SHARE_HOST. The query matters: a preview token or an opt-out answer
//      lives there, and a redirect that dropped it would look like a bug in
//      the gate rather than in the redirect.
//
//   2. A POST on a legacy host is served where it was sent. A 301 turns a
//      POST into a GET and drops the body, so redirecting the gate and
//      opt-out submissions would break every tab that was already open when
//      the switch happened.
//
//   3. SHARE_HOST is not a website. Anything that is not a share is a 404,
//      and robots.txt tells every crawler to stay out of all of it.

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
  config: {},
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
  config: {},
};

const getShareBySlug = vi.fn();

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    // No hostname is a claimed customer domain unless a test says so. Real
    // network calls must never happen here, and resolveHost reads
    // custom_domains for every host that is not the apex or a handle.
    getCustomDomainByHostname: vi.fn(async () => null),
    getDocument: vi.fn(async () => doc),
    // No attachment by this id. Enough to prove the download path was handled
    // where the request arrived rather than redirected away from it.
    getAttachment: vi.fn(async () => null),
    listAttachmentsForDocument: vi.fn(async () => []),
    logAppEvent: vi.fn(async () => undefined),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: vi.fn(async () => undefined),
  };
});

// HTMLRewriter is a Workers global with no Node equivalent; injectTracker's
// own behaviour is covered by inject.test.ts.
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

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: 'test-session-secret',
  TRACKER_URL: 'https://htmlradar.com/v1/tracker.js',
} as unknown as import('../src/env.js').Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function fetchAs(
  url: string,
  init: RequestInit = {},
  env: import('../src/env.js').Env = baseEnv,
): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(url, init), env, ctx);
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('a legacy host redirects readers to the share host', () => {
  it('301s a GET to the same path on the share host', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.page/r/acme-proposal');
    // Nothing was looked up: the redirect happens before any share lookup.
    expect(getShareBySlug).not.toHaveBeenCalled();
  });

  it('keeps the query string, which carries preview tokens and opt-out answers', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal?owner_preview=t.1.abc&x=1');
    expect(res.headers.get('Location')).toBe(
      'https://htmlradar.page/r/acme-proposal?owner_preview=t.1.abc&x=1',
    );
  });

  it('301s a HEAD as well, so link checkers land on the right host', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal', { method: 'HEAD' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.page/r/acme-proposal');
  });

  it('redirects the attachment-download path too, query and all', async () => {
    // A recipient who clicks a supporting-material link in an old email has to
    // land on the file, not on a 404 — and whatever the link carried has to
    // survive the hop with it.
    const res = await fetchAs(
      'https://htmlradar.com/r/acme-proposal/m/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=2',
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe(
      'https://htmlradar.page/r/acme-proposal/m/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=2',
    );
    expect(getShareBySlug).not.toHaveBeenCalled();
  });

  it('still carries the noindex header, so the hop is never indexed', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('a legacy host serves POSTs in place', () => {
  // A 301 would turn these into GETs and drop the body. Tabs opened before
  // the switch still post here, and their gate has to work.
  it('answers the password gate where it was submitted', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const form = new FormData();
    form.set('password', 'correct-horse');
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal/auth', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Set-Cookie')).toMatch(/^htmlradar_auth_acme-proposal=/);
  });

  it('answers the email gate where it was submitted', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const form = new FormData();
    form.set('email', 'reader@example.org');
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal/email', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Set-Cookie')).toMatch(/^htmlradar_email_acme-proposal=/);
  });
});

describe('the share host is not a website', () => {
  it('404s the root', async () => {
    const res = await fetchAs('https://htmlradar.page/');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('404s an unknown path', async () => {
    const res = await fetchAs('https://htmlradar.page/pricing');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('serves robots.txt as a blanket Disallow', async () => {
    const res = await fetchAs('https://htmlradar.page/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it("serves the tracker from the document's own host", async () => {
    // First-party to the document: no second DNS lookup, and nothing for a
    // third-party script blocker to recognise. The worker fetches it from
    // TRACKER_URL, which is the application domain.
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('/* tracker */', { status: 200 }));
    const res = await fetchAs('https://htmlradar.page/v1/tracker.js');
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith('https://htmlradar.com/v1/tracker.js');
    upstream.mockRestore();
  });

  it('serves a share', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal');
    expect(res.status).toBe(200);
    expect(getShareBySlug).toHaveBeenCalledWith(baseEnv, 'acme-proposal');
  });
});

describe('plain HTTP is never served', () => {
  // `wrangler dev` serves plain HTTP on localhost, so localhost is exempt —
  // otherwise every local request would bounce to an https port that is not
  // listening.
  it('is served on localhost, so wrangler dev works', async () => {
    const res = await fetchAs('http://localhost:8787/robots.txt');
    expect(res.status).toBe(200);
  });

  // The .page top-level domain is HTTPS-only by browser policy; a recipient
  // document must not travel in the clear on any host.
  it('301s to the same address over HTTPS', async () => {
    const res = await fetchAs('http://htmlradar.page/r/acme-proposal?x=1');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.page/r/acme-proposal?x=1');
  });
});

describe('a self-hoster sets their own hosts', () => {
  const selfHosted = {
    ...baseEnv,
    SHARE_HOST: 'docs.example.org',
    LEGACY_HOSTS: 'old.example.org, older.example.org',
  } as import('../src/env.js').Env;

  it('serves shares on the configured share host', async () => {
    const res = await fetchAs('https://docs.example.org/r/acme-proposal', {}, selfHosted);
    expect(res.status).toBe(200);
  });

  it('redirects each configured legacy host to it', async () => {
    for (const host of ['old.example.org', 'older.example.org']) {
      const res = await fetchAs(`https://${host}/r/acme-proposal`, {}, selfHosted);
      expect(res.status, host).toBe(301);
      expect(res.headers.get('Location'), host).toBe('https://docs.example.org/r/acme-proposal');
    }
  });

  it('refuses htmlradar.com once it is no longer a legacy host', async () => {
    // CHANGED 17 September 2026, with custom domains. This used to be served
    // as the apex, because an unknown hostname fell back to the apex. That
    // fallback is gone: the route is now the whole zone, so every hostname
    // Cloudflare for SaaS points at us arrives here, and "unknown behaves
    // like the apex" would have been every apex share on every such hostname.
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal', {}, selfHosted);
    expect(res.status).toBe(404);
  });
});

describe('a host that is neither the share host nor a legacy host is refused', () => {
  // The legacy list is now also the list of hosts this worker RECOGNISES
  // besides the share host and its subdomains. Emptying it no longer serves
  // the old host in place — it makes the old host a stranger, and a stranger
  // gets the standard not-found on every path.
  const noRedirect = { ...baseEnv, LEGACY_HOSTS: '' } as import('../src/env.js').Env;

  it('404s the old host instead of serving it in place', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal', {}, noRedirect);
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('serves the share host at the same time, so its own links are untouched', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal', {}, noRedirect);
    expect(res.status).toBe(200);
  });

  it('never looks the share up on a host it does not recognise', async () => {
    await fetchAs('https://htmlradar.com/r/acme-proposal?x=1', {}, noRedirect);
    await fetchAs(
      'https://htmlradar.com/r/acme-proposal/m/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=2',
      {},
      noRedirect,
    );
    expect(getShareBySlug).not.toHaveBeenCalled();
  });

  it('still upgrades plain HTTP, which is a separate rule from the host', async () => {
    const res = await fetchAs('http://htmlradar.com/r/acme-proposal', {}, noRedirect);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.com/r/acme-proposal');
  });
});
