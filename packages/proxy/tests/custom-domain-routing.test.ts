import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A customer's own domain, and which host may serve which share once one
// exists.
//
// Design: docs/workstreams/content-domain/CUSTOM-DOMAINS-PRD-2026-09-16.md and
// the sprint file beside it. The table below is Astra's attack matrix, section
// 6 of ASTRA-CUSTOM-DOMAINS-SPRINT-REVIEW-2026-09-16.md, cell by cell:
//
//   | Share kind | Host kind                          | Expected           |
//   |------------|------------------------------------|--------------------|
//   | Apex       | Apex                               | served             |
//   | Apex       | Any handle / any custom            | 404                |
//   | Handle     | Matching handle                    | served             |
//   | Handle     | Apex, handles off                  | served             |
//   | Handle     | Apex, handles on                   | 301 / 308          |
//   | Handle     | Other handle / any custom          | 404                |
//   | Custom     | Matching live claim                | served             |
//   | Custom     | Apex / handle / another claim      | 404                |
//   | Any        | Pending, disconnected, retired,     |                    |
//   |            | unknown custom hostname            | 404                |
//   | Revoked    | Correct host                       | 403, report and    |
//   |            |                                    | opt-out still work |
//   | Expired    | Correct host                       | 410, report and    |
//   |            |                                    | opt-out still work |
//
// The rule underneath all of it: a share is served on the hostname it stored
// and on no other. A custom share is not served on the apex and the apex does
// not redirect to it — a redirect would let anybody turn an htmlradar.page
// address into one that wears the customer's name.
//
// The handle rows are pinned in handle-routing.test.ts and are not repeated
// here except where a custom domain changes them.

const OWNER = 'owner-1';

const LIVE = {
  id: 'dom-1',
  owner_id: OWNER,
  hostname: 'decks.acme.com',
  state: 'live' as const,
};
const OTHER_LIVE = {
  id: 'dom-2',
  owner_id: 'owner-2',
  hostname: 'links.rival.com',
  state: 'live' as const,
};
const PENDING = {
  id: 'dom-3',
  owner_id: OWNER,
  hostname: 'soon.acme.com',
  state: 'pending' as const,
};
const DISCONNECTED = {
  id: 'dom-4',
  owner_id: OWNER,
  hostname: 'gone.acme.com',
  state: 'disconnected' as const,
};
// getCustomDomainByHostname filters retired rows out in the query, so this row
// should never reach the worker. It is here anyway: the worker must refuse a
// retired state on its own, not because a query happened to hide it.
const RETIRED = {
  id: 'dom-5',
  owner_id: OWNER,
  hostname: 'old.acme.com',
  state: 'retired' as const,
};

const DOMAINS = new Map(
  [LIVE, OTHER_LIVE, PENDING, DISCONNECTED, RETIRED].map((d) => [d.hostname, d]),
);

const apexShare = {
  id: 'share-1',
  document_id: 'doc-1',
  owner_id: OWNER,
  slug: 'acme-proposal',
  recipient_label: null,
  require_email: false,
  require_password: false,
  allowed_email_domains: null,
  allowed_emails: null,
  expires_at: null,
  revoked_at: null,
  lock_deck: false,
  host_handle: null,
  owner_handle: null,
  owner_tier: 'pro',
  custom_domain_id: null,
  custom_domain_hostname: null,
  custom_domain_state: null,
  custom_domain_owner_id: null,
};

const handleShare = { ...apexShare, host_handle: 'acme', owner_handle: 'acme' };

const customShare = {
  ...apexShare,
  custom_domain_id: LIVE.id,
  custom_domain_hostname: LIVE.hostname,
  custom_domain_state: 'live',
  custom_domain_owner_id: LIVE.owner_id,
};

const doc = {
  id: 'doc-1',
  owner_id: OWNER,
  title: 'Deck',
  source_type: 'url',
  source_url: 'https://example.test/deck.html',
  r2_key: null,
  current_version: 1,
  deleted_at: null,
};

const attachment = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  document_id: 'doc-1',
  owner_id: OWNER,
  filename: 'terms.pdf',
  mime_type: 'application/pdf',
  size_bytes: 12,
  r2_key: 'docs/terms.pdf',
  created_at: '2026-09-16T00:00:00Z',
};

const getShareBySlug = vi.fn();
const getCustomDomainByHostname = vi.fn();

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    getCustomDomainByHostname: (...args: unknown[]) => getCustomDomainByHostname(...args),
    getDocument: vi.fn(async () => doc),
    getAttachment: vi.fn(async () => attachment),
    listAttachmentsForDocument: vi.fn(async () => []),
    logAppEvent: vi.fn(async () => undefined),
    logAttachmentDownload: vi.fn(async () => undefined),
    getViewerIdByShareEmail: vi.fn(async () => null),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: vi.fn(async () => undefined),
    reportAbuse: vi.fn(async () => 'ok'),
  };
});

// HTMLRewriter is a Workers global with no Node equivalent; what the injection
// does to a document is inject.test.ts's business, not this file's.
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
  TRUST_HANDLES: '*',
  DOCS_BUCKET: { get: async () => ({ body: null }) },
} as unknown as Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function fetchAs(url: string, init: RequestInit = {}, e: Env = env): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(url, init), e, ctx);
}

// Every route that carries a share identifier, with what a host that IS
// allowed to serve this share answers. The wrapper is on, so the document
// route answers with HTMLRadar's own page and the frame route with the
// document inside it.
const SHARE_ROUTES = [
  { name: 'the document', path: '/r/acme-proposal', init: {}, served: 200 },
  { name: 'the report form', path: '/r/acme-proposal/report', init: {}, served: 200 },
  {
    name: 'the report itself',
    path: '/r/acme-proposal/report',
    init: { method: 'POST', body: new URLSearchParams({ reason: 'phishing' }) },
    served: 200,
  },
  {
    name: 'the frame',
    path: '/r/acme-proposal/frame',
    init: { headers: { 'Sec-Fetch-Dest': 'iframe' } },
    served: 200,
  },
  {
    name: 'an attachment download',
    path: `/r/acme-proposal/m/${attachment.id}`,
    init: {},
    served: 200,
  },
  {
    name: 'the password gate',
    path: '/r/acme-proposal/auth',
    init: { method: 'POST', body: new URLSearchParams({ password: 'correct-horse' }) },
    served: 303,
  },
  {
    name: 'the email gate',
    path: '/r/acme-proposal/email',
    init: { method: 'POST', body: new URLSearchParams({ email: 'reader@example.org' }) },
    served: 303,
  },
  { name: 'the opt-out question', path: '/r/acme-proposal?optout=1', init: {}, served: 200 },
];

// The one answer every refusal gives, so that a wrong handle, another
// customer's domain, a claim that is not live and a slug that does not exist
// are indistinguishable from outside.
async function expectStandardNotFound(res: Response, label: string): Promise<void> {
  expect(res.status, label).toBe(404);
  expect(res.headers.get('X-Robots-Tag'), label).toBe('noindex, nofollow');
  expect(await res.text(), label).toContain("This link doesn't open anything.");
}

async function expectEveryRouteRefused(host: string, label: string): Promise<void> {
  for (const route of SHARE_ROUTES) {
    const res = await fetchAs(`https://${host}${route.path}`, route.init);
    await expectStandardNotFound(res, `${label}: ${route.name}`);
  }
  // The print route and the opt-out write, which need credentials a refused
  // host must never be asked for.
  await expectStandardNotFound(
    await fetchAs(`https://${host}/r/acme-proposal/print?g=1.deadbeef`),
    `${label}: print`,
  );
  await expectStandardNotFound(
    await fetchAs(`https://${host}/r/acme-proposal`, {
      method: 'POST',
      body: new URLSearchParams({ optout: '1', token: '9999999999.deadbeef' }),
    }),
    `${label}: the opt-out write`,
  );
}

async function expectEveryRouteServed(host: string, label: string): Promise<void> {
  for (const route of SHARE_ROUTES) {
    const res = await fetchAs(`https://${host}${route.path}`, route.init);
    expect(res.status, `${label}: ${route.name}`).toBe(route.served);
  }

  // Print, with the pair the wrapper hands out on this exact host: the
  // HttpOnly cookie and the grant in the strip's Print link.
  const wrapper = await fetchAs(`https://${host}/r/acme-proposal`);
  const cookie = (wrapper.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const html = await wrapper.text();
  const href = /href="(\/r\/acme-proposal\/print\?g=[^"]+)"/.exec(html)?.[1] ?? '';
  expect(href, `${label}: the strip carries a print link`).not.toBe('');
  const printed = await fetchAs(`https://${host}${href}`, { headers: { Cookie: cookie } });
  expect(printed.status, `${label}: print`).toBe(200);

  // The opt-out write, with the token the confirmation page on this host
  // minted for it.
  const asked = await fetchAs(`https://${host}/r/acme-proposal?optout=1`);
  const token = /name="token" value="([^"]+)"/.exec(await asked.text())?.[1] ?? '';
  expect(token, `${label}: the confirmation page carries a token`).not.toBe('');
  const written = await fetchAs(`https://${host}/r/acme-proposal`, {
    method: 'POST',
    body: new URLSearchParams({ optout: '1', token }),
  });
  expect(written.status, `${label}: the opt-out write`).toBe(303);
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(apexShare);
  getCustomDomainByHostname.mockReset();
  getCustomDomainByHostname.mockImplementation(
    async (_e: unknown, hostname: string) => DOMAINS.get(hostname) ?? null,
  );
});

afterEach(() => vi.clearAllMocks());

describe('resolveHost learns a third shape', () => {
  it('reads the claim on every request and never caches it', async () => {
    // Astra's finding: a cached "live" outlives a disconnect, and during a
    // hostname's reassignment that cached answer is one customer's host
    // serving another customer's document.
    getShareBySlug.mockResolvedValue(customShare);
    await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`);
    await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`);
    await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`);
    expect(getCustomDomainByHostname).toHaveBeenCalledTimes(3);
  });

  it('asks nothing about the apex or a handle host', async () => {
    await fetchAs('https://htmlradar.page/r/acme-proposal');
    await fetchAs('https://acme.htmlradar.page/r/acme-proposal');
    expect(getCustomDomainByHostname).not.toHaveBeenCalled();
  });

  it('refuses a hostname nobody has claimed, before it looks anything up', async () => {
    await expectStandardNotFound(
      await fetchAs('https://decks.stranger.com/r/acme-proposal'),
      'an unclaimed hostname',
    );
    expect(getShareBySlug).not.toHaveBeenCalled();
  });

  it('refuses a retired claim, whatever the query would have filtered', async () => {
    await expectStandardNotFound(
      await fetchAs(`https://${RETIRED.hostname}/r/acme-proposal`),
      'a retired claim',
    );
    expect(getShareBySlug).not.toHaveBeenCalled();
  });
});

describe('a custom share is served on its own hostname', () => {
  beforeEach(() => getShareBySlug.mockResolvedValue(customShare));

  it('serves every route there', async () => {
    await expectEveryRouteServed(LIVE.hostname, 'the matching live claim');
  });

  it('serves the tracker there, first-party to the document', async () => {
    // The injected tag is relative, so on a customer's domain the tracker is
    // fetched from the customer's domain. Nothing for a script blocker to
    // recognise, and no second DNS lookup.
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('/* tracker */', { status: 200 }));
    const res = await fetchAs(`https://${LIVE.hostname}/v1/tracker.js`);
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith('https://htmlradar.com/v1/tracker.js');
    upstream.mockRestore();
  });

  it('records a read there, because the tracker posts to Supabase and not to us', async () => {
    // The recorded read is the tracker's own call to Supabase from the
    // document; the worker's part is handing the document the anon key and
    // the share id on this host exactly as it does on the apex.
    const injected = (await import('../src/inject.js')).injectTracker as unknown as ReturnType<
      typeof vi.fn
    >;
    await fetchAs(`https://${LIVE.hostname}/r/acme-proposal/frame`, {
      headers: { 'Sec-Fetch-Dest': 'iframe' },
    });
    expect(injected).toHaveBeenCalled();
    const config = injected.mock.calls[0]![1] as {
      trackingEnabled: boolean;
      trackerUrl: string;
      share: { id: string };
    };
    expect(config.trackingEnabled).toBe(true);
    expect(config.trackerUrl).toBe('/v1/tracker.js');
    expect(config.share.id).toBe('share-1');
  });
});

describe('a custom share is served nowhere else', () => {
  beforeEach(() => getShareBySlug.mockResolvedValue(customShare));

  it('is not found on the apex, and is not redirected there either', async () => {
    // No redirect on purpose. Rule 2 moves a handle link off the apex because
    // its apex form was never printed; a redirect from the apex to a
    // customer's domain would let anybody turn an htmlradar.page address into
    // an address that wears the customer's name.
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal');
    await expectStandardNotFound(res, 'a custom share on the apex');
    expect(res.headers.get('Location')).toBeNull();
    await expectEveryRouteRefused('htmlradar.page', 'a custom share on the apex');
  });

  it("is not found on its owner's handle host", async () => {
    await expectEveryRouteRefused('acme.htmlradar.page', 'a custom share on a handle host');
  });

  it("is not found on another customer's live domain", async () => {
    await expectEveryRouteRefused(OTHER_LIVE.hostname, "a custom share on a rival's domain");
  });

  it('is not found once its own claim stops being live', async () => {
    // The share row still names the domain; the domain is no longer serving.
    // Both reads have to agree before anything is served.
    getCustomDomainByHostname.mockResolvedValue({ ...LIVE, state: 'disconnected' });
    await expectEveryRouteRefused(LIVE.hostname, 'a disconnected claim');
  });

  it('is not found when the share row and the claim disagree about the state', async () => {
    getShareBySlug.mockResolvedValue({ ...customShare, custom_domain_state: 'disconnected' });
    await expectEveryRouteRefused(LIVE.hostname, 'a share row that says not live');
  });

  it('is not found when the claim belongs to another owner', async () => {
    getCustomDomainByHostname.mockResolvedValue({ ...LIVE, owner_id: 'owner-2' });
    await expectEveryRouteRefused(LIVE.hostname, 'a claim owned by somebody else');
  });
});

describe('an apex or handle share is never served on a customer domain', () => {
  it('refuses an apex share on a live claim', async () => {
    getShareBySlug.mockResolvedValue(apexShare);
    await expectEveryRouteRefused(LIVE.hostname, 'an apex share on a customer domain');
  });

  it('refuses a handle share on a live claim', async () => {
    getShareBySlug.mockResolvedValue(handleShare);
    await expectEveryRouteRefused(LIVE.hostname, 'a handle share on a customer domain');
  });

  it('refuses every share kind on a pending, disconnected, retired or unknown hostname', async () => {
    for (const share of [apexShare, handleShare, customShare]) {
      getShareBySlug.mockResolvedValue(share);
      for (const host of [
        PENDING.hostname,
        DISCONNECTED.hostname,
        RETIRED.hostname,
        'nobody.example.net',
      ]) {
        await expectEveryRouteRefused(host, `${host} with a ${share.host_handle ?? 'plain'} share`);
      }
    }
  });
});

describe('a revoked or expired custom share behaves as it does on the apex', () => {
  const revoked = { ...customShare, revoked_at: '2026-09-01T00:00:00Z' };
  const expired = { ...customShare, expires_at: '2026-09-01T00:00:00Z' };

  it('answers 403 for a revoked share on its own hostname', async () => {
    getShareBySlug.mockResolvedValue(revoked);
    const res = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`);
    expect(res.status).toBe(403);
  });

  it('answers 410 for an expired share on its own hostname', async () => {
    getShareBySlug.mockResolvedValue(expired);
    const res = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`);
    expect(res.status).toBe(410);
  });

  it('keeps the report form and the opt-out working on both', async () => {
    // The two recipient controls outlive the link. Somebody comes back to
    // report a document precisely after the sender turned it off, and the
    // tracking preference is browser-wide rather than per-share.
    for (const [label, share] of [
      ['revoked', revoked],
      ['expired', expired],
    ] as const) {
      getShareBySlug.mockResolvedValue(share);
      const form = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal/report`);
      expect(form.status, `${label}: the report form`).toBe(200);

      const asked = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal?optout=1`);
      expect(asked.status, `${label}: the opt-out question`).toBe(200);
      const token = /name="token" value="([^"]+)"/.exec(await asked.text())?.[1] ?? '';
      const written = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`, {
        method: 'POST',
        body: new URLSearchParams({ optout: '1', token }),
      });
      expect(written.status, `${label}: the opt-out write`).toBe(303);
    }
  });

  it('still refuses both on the wrong host', async () => {
    getShareBySlug.mockResolvedValue(revoked);
    await expectStandardNotFound(
      await fetchAs('https://htmlradar.page/r/acme-proposal/report'),
      'a revoked custom share on the apex',
    );
  });
});

describe('the opt-out token is bound to the hostname that minted it', () => {
  beforeEach(() => getShareBySlug.mockResolvedValue(customShare));

  it('refuses a token minted on the apex when it is spent on a customer domain', async () => {
    getShareBySlug.mockResolvedValue(apexShare);
    const asked = await fetchAs('https://htmlradar.page/r/acme-proposal?optout=1');
    const token = /name="token" value="([^"]+)"/.exec(await asked.text())?.[1] ?? '';

    getShareBySlug.mockResolvedValue(customShare);
    const elsewhere = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`, {
      method: 'POST',
      body: new URLSearchParams({ optout: '1', token }),
    });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.getSetCookie()).toEqual([]);
  });

  it('spends a token on the host that minted it', async () => {
    const asked = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal?optout=1`);
    const token = /name="token" value="([^"]+)"/.exec(await asked.text())?.[1] ?? '';
    const written = await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`, {
      method: 'POST',
      body: new URLSearchParams({ optout: '1', token }),
    });
    expect(written.status).toBe(303);
    // No Domain attribute: the preference belongs to the exact host that set
    // it, so a customer's domain cannot write one for htmlradar.page.
    expect(written.headers.get('Set-Cookie')).not.toContain('Domain=');
  });
});

describe('the probe path, and nothing else, on a claimed hostname', () => {
  const PROBE = '/.well-known/htmlradar-domain-check';

  it('answers on a pending claim, with the body and header the app checks', async () => {
    const res = await fetchAs(`https://${PENDING.hostname}${PROBE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-htmlradar-domain')).toBe(PENDING.id);
    expect(await res.text()).toBe(`htmlradar-domain:${PENDING.id}`);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('answers on a disconnected claim, so a recovered domain can come back', async () => {
    const res = await fetchAs(`https://${DISCONNECTED.hostname}${PROBE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-htmlradar-domain')).toBe(DISCONNECTED.id);
  });

  it('answers on a live claim, because the monitor re-probes what it has already promoted', async () => {
    const res = await fetchAs(`https://${LIVE.hostname}${PROBE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-htmlradar-domain')).toBe(LIVE.id);
  });

  it('names one claim and nothing else — no share, no owner, no count', async () => {
    const body = await (await fetchAs(`https://${PENDING.hostname}${PROBE}`)).text();
    expect(body).toBe(`htmlradar-domain:${PENDING.id}`);
    expect(body).not.toContain(OWNER);
    expect(body).not.toContain('acme-proposal');
  });

  it('is not cached, so a retired claim cannot answer from an edge', async () => {
    const res = await fetchAs(`https://${PENDING.hostname}${PROBE}`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('is not there on the apex, a handle host, a retired claim or a stranger', async () => {
    for (const host of [
      'htmlradar.page',
      'acme.htmlradar.page',
      RETIRED.hostname,
      'nobody.example.net',
    ]) {
      expect((await fetchAs(`https://${host}${PROBE}`)).status, host).toBe(404);
    }
  });

  it('answers GET only', async () => {
    const res = await fetchAs(`https://${PENDING.hostname}${PROBE}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('is all a pending or disconnected hostname answers', async () => {
    getShareBySlug.mockResolvedValue(customShare);
    for (const host of [PENDING.hostname, DISCONNECTED.hostname]) {
      for (const path of ['/', '/r/acme-proposal', '/v1/tracker.js', '/sitemap.xml', '/anything']) {
        expect((await fetchAs(`https://${host}${path}`)).status, `${host}${path}`).toBe(404);
      }
      // Except robots.txt, which every host this worker serves answers.
      expect((await fetchAs(`https://${host}/robots.txt`)).status, host).toBe(200);
    }
  });
});

describe('robots, sitemap and the raw preview on a customer domain', () => {
  it('serves robots.txt on a customer domain, with the same blanket Disallow', async () => {
    // A customer's own domain is where a crawler is likeliest to find its way
    // in, because it has links pointing at it that ours does not.
    const res = await fetchAs(`https://${LIVE.hostname}/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('has no sitemap.xml on a customer domain, or anywhere else', async () => {
    for (const host of ['htmlradar.page', LIVE.hostname]) {
      expect((await fetchAs(`https://${host}/sitemap.xml`)).status, host).toBe(404);
    }
  });

  it('refuses the sender-side raw preview on a customer domain', async () => {
    // It carries no share and therefore no stored hostname to check, and it
    // serves the raw upload with no tracker and no gate. On a customer's
    // domain it would put a document there that no share ever chose.
    const path = `/r/_doc/${attachment.id}?owner_doc_preview=tok`;
    await expectStandardNotFound(
      await fetchAs(`https://${LIVE.hostname}${path}`),
      'the raw preview on a customer domain',
    );
  });
});

describe('customers.htmlradar.page is infrastructure, not a host', () => {
  // The fallback origin every customer CNAME points at. It is a valid handle
  // label, so without a rule of its own it would be served as a handle host.
  const RESERVED = 'customers.htmlradar.page';

  it('answers nothing at all', async () => {
    getShareBySlug.mockResolvedValue(apexShare);
    for (const path of [
      '/',
      '/robots.txt',
      '/v1/tracker.js',
      '/r/acme-proposal',
      '/.well-known/htmlradar-domain-check',
    ]) {
      expect((await fetchAs(`https://${RESERVED}${path}`)).status, path).toBe(404);
    }
  });

  it('never looks a share up', async () => {
    await fetchAs(`https://${RESERVED}/r/acme-proposal`);
    expect(getShareBySlug).not.toHaveBeenCalled();
  });
});

describe("schema/043's hostile names, re-run on a customer domain", () => {
  // The fixtures in schema/tests/043_trust_layer_foundation_test.sql: names an
  // abuser would want (a brand, a login page, a bank), Punycode lookalikes,
  // and labels the handle format refuses. None of them may borrow a
  // customer's domain, and a customer's domain may not borrow them.
  const HOSTILE_HANDLES = [
    'microsoft',
    'google',
    'login',
    'secure',
    'billing',
    'status',
    'cdn',
    'xn--80ak6aa92e',
  ];
  const HOSTILE_HOSTNAMES = [
    'htmlradar.page.acme.com',
    'login.htmlradar-secure.com',
    'xn--80ak6aa92e.com',
    'decks.acme.com.evil.net',
  ];

  it('refuses a hostile handle host for a share on a customer domain', async () => {
    getShareBySlug.mockResolvedValue(customShare);
    for (const handle of HOSTILE_HANDLES) {
      await expectStandardNotFound(
        await fetchAs(`https://${handle}.htmlradar.page/r/acme-proposal`),
        handle,
      );
    }
  });

  it("refuses a share stamped with a hostile handle on a customer's domain", async () => {
    for (const handle of HOSTILE_HANDLES) {
      getShareBySlug.mockResolvedValue({ ...apexShare, host_handle: handle });
      await expectStandardNotFound(
        await fetchAs(`https://${LIVE.hostname}/r/acme-proposal`),
        handle,
      );
    }
  });

  it('refuses a hostile hostname nobody has claimed', async () => {
    getShareBySlug.mockResolvedValue(customShare);
    for (const hostname of HOSTILE_HOSTNAMES) {
      await expectStandardNotFound(await fetchAs(`https://${hostname}/r/acme-proposal`), hostname);
      await expectStandardNotFound(
        await fetchAs(`https://${hostname}/.well-known/htmlradar-domain-check`),
        `${hostname} probe`,
      );
    }
  });

  it('gives every one of them the same answer as a slug that does not exist', async () => {
    getShareBySlug.mockResolvedValue(customShare);
    const bodies = await Promise.all(
      [
        `https://${OTHER_LIVE.hostname}/r/acme-proposal`,
        `https://${PENDING.hostname}/r/acme-proposal`,
        'https://microsoft.htmlradar.page/r/acme-proposal',
        'https://decks.acme.com.evil.net/r/acme-proposal',
        'https://htmlradar.page/r/acme-proposal',
      ].map(async (u) => `${(await fetchAs(u)).status}:${await (await fetchAs(u)).text()}`),
    );
    getShareBySlug.mockResolvedValue(null);
    const missing = await fetchAs('https://htmlradar.page/r/no-such-share');
    bodies.push(`${missing.status}:${await missing.text()}`);
    expect(new Set(bodies).size).toBe(1);
  });
});
