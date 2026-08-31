import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GET /r/{slug}/print — the document unframed, behind a signed grant.
//
// Design: docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md,
// "Printing, and why it needs a grant". A browser printing a page that
// contains a frame prints only the part on screen, so Cmd+P breaks inside the
// wrapper and the strip has to offer Print itself. The first draft answered
// with a public address, and that was a way ROUND the badge: a sender could
// email it directly or hide it behind a fake strip.
//
// P7 — Print cannot be reached without the wrapper. The whole matrix is here:
// missing grant, expired grant, valid grant with no cookie, valid grant with
// another browser's cookie, a grant issued for another hostname, and one for
// another share. All redirect to the wrapper; a valid pair serves with the
// sandbox intact.

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
    notifyDisabledAttempt: vi.fn(async () => undefined),
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

async function fetchAs(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(url, { headers }), env, ctx);
}

// Open the wrapper the way a recipient does, and read back the two halves of
// the binding it hands out: the cookie the sender's code cannot read, and the
// grant in the strip's Print link.
async function openWrapper(host = 'htmlradar.page'): Promise<{ cookie: string; href: string }> {
  const res = await fetchAs(`https://${host}/r/acme-proposal`);
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const html = await res.text();
  const href = /href="(\/r\/acme-proposal\/print\?g=[^"]+)"/.exec(html)?.[1] ?? '';
  return { cookie: setCookie.split(';')[0] ?? '', href };
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.restoreAllMocks());

describe('the wrapper hands out both halves of the binding', () => {
  it('sets a random cookie the framed document cannot read', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal');
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^hr_print=[0-9a-f]{32};/);
    // HttpOnly is what puts it out of the sender's reach; no Domain attribute
    // is what binds it to this exact hostname.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Domain=');
  });

  it('puts a grant in the strip, and a different one every time', async () => {
    const first = await openWrapper();
    expect(first.href).toMatch(/\/r\/acme-proposal\/print\?g=\d+\.[0-9a-f]{64}$/);
    const second = await openWrapper();
    expect(second.cookie).not.toBe(first.cookie);
  });

  it('re-uses the cookie a reader already holds, so a second tab keeps working', async () => {
    const first = await openWrapper();
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal', { cookie: first.cookie });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    // And the grant minted against it still opens the print view.
    const html = await res.text();
    const href = /href="(\/r\/acme-proposal\/print\?g=[^"]+)"/.exec(html)?.[1] ?? '';
    const printed = await fetchAs(`https://htmlradar.page${href}`, { cookie: first.cookie });
    expect(printed.status).toBe(200);
  });

  it('offers no Print link and mints no cookie when the sender locked the deck', async () => {
    // Printing is already blocked on a locked deck, so there is nothing to
    // grant.
    getShareBySlug.mockResolvedValue({ ...share, lock_deck: true });
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await res.text()).not.toContain('/print?g=');
  });
});

describe('a valid pair prints', () => {
  it('serves the document to the browser that opened the wrapper', async () => {
    const { cookie, href } = await openWrapper();
    const res = await fetchAs(`https://htmlradar.page${href}`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Deck</h1>');
  });

  it('keeps the opaque-origin sandbox, like every customer-controlled response', async () => {
    const { cookie, href } = await openWrapper();
    const res = await fetchAs(`https://htmlradar.page${href}`, { cookie });
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts allow-forms allow-popups allow-downloads');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('is not framed, because a framed page is the thing that will not print', async () => {
    const { cookie, href } = await openWrapper();
    await fetchAs(`https://htmlradar.page${href}`, { cookie });
    expect(injectTracker.mock.lastCall![1]).toMatchObject({ framed: false });
  });

  it('starts no session of its own', async () => {
    // Today's Cmd+P on the unwrapped page does not either, and a print address
    // carrying a viewer's identity would be a worse thing to leave in a
    // browser's history.
    const { cookie, href } = await openWrapper();
    await fetchAs(`https://htmlradar.page${href}`, { cookie });
    expect(injectTracker.mock.lastCall![1]).toMatchObject({ trackingEnabled: false });
  });
});

describe('everything else lands back on the wrapper', () => {
  const toWrapper = (res: Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
  };

  it('a guessed address with no grant at all', async () => {
    toWrapper(await fetchAs('https://htmlradar.page/r/acme-proposal/print'));
  });

  it('an empty or malformed grant', async () => {
    for (const g of ['', 'nonsense', '1.2.3', 'abc.def']) {
      toWrapper(
        await fetchAs(`https://htmlradar.page/r/acme-proposal/print?g=${encodeURIComponent(g)}`),
      );
    }
  });

  it('a grant lifted from the wrapper but opened in another browser', async () => {
    // The other browser has no cookie, which is the whole point of binding the
    // grant to one.
    const { href } = await openWrapper();
    toWrapper(await fetchAs(`https://htmlradar.page${href}`));
  });

  it("a grant opened with another browser's cookie", async () => {
    const mine = await openWrapper();
    const theirs = await openWrapper();
    toWrapper(await fetchAs(`https://htmlradar.page${mine.href}`, { cookie: theirs.cookie }));
  });

  it('a grant that has aged past its few minutes', async () => {
    // Moved with a Date.now spy rather than vitest's fake timers: taking over
    // the timers hangs the worker pool's teardown, and expiry is the only
    // clock this path reads.
    const { cookie, href } = await openWrapper();
    const later = Date.now() + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    toWrapper(await fetchAs(`https://htmlradar.page${href}`, { cookie }));
  });

  it('a grant issued for another hostname', async () => {
    // Which is what stops a grant minted on one customer's host from working
    // on another's, or on the apex. Asserted against the grant itself rather
    // than through the router, because reaching a share from the wrong host is
    // separately refused before the grant is ever read (handle-routing.test.ts)
    // — this is the binding underneath that.
    const { issuePrintGrant, verifyPrintGrant, newPrintSecret } = await import('../src/auth.js');
    const secret = newPrintSecret();
    const cookie = `hr_print=${secret}`;
    const grant = await issuePrintGrant('acme-proposal', 'acme.htmlradar.page', secret, 'k');
    await expect(
      verifyPrintGrant(grant, 'acme-proposal', 'acme.htmlradar.page', cookie, 'k'),
    ).resolves.toBe(true);
    await expect(
      verifyPrintGrant(grant, 'acme-proposal', 'htmlradar.page', cookie, 'k'),
    ).resolves.toBe(false);
    await expect(
      verifyPrintGrant(grant, 'acme-proposal', 'other.htmlradar.page', cookie, 'k'),
    ).resolves.toBe(false);
  });

  it('a grant issued for another share', async () => {
    const { cookie, href } = await openWrapper();
    const grant = href.split('g=')[1]!;
    getShareBySlug.mockResolvedValue({ ...share, slug: 'other-deck' });
    const res = await fetchAs(`https://htmlradar.page/r/other-deck/print?g=${grant}`, { cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/r/other-deck');
  });

  it('a tampered signature on an otherwise live grant', async () => {
    const { cookie, href } = await openWrapper();
    const tampered = href.replace(/[0-9a-f]{4}$/, '0000');
    toWrapper(await fetchAs(`https://htmlradar.page${tampered}`, { cookie }));
  });

  it('but a share that does not exist is not-found, not a redirect', async () => {
    // The grant is read after the share lookup and the stored-hostname check,
    // so that print answers the same not-found as every other share-bearing
    // route when it is asked for on a host the share was never created for.
    getShareBySlug.mockResolvedValue(null);
    const res = await fetchAs('https://htmlradar.page/r/no-such-share/print?g=nonsense');
    expect(res.status).toBe(404);
  });
});

describe('print is not a route while the gate is off', () => {
  it('is not-found with TRUST_WRAPPER unset, grant or no grant', async () => {
    const worker = (await import('../src/index.js')).default;
    const off = { ...env, TRUST_WRAPPER: '' } as Env;
    const res = await worker.fetch(
      new Request('https://htmlradar.page/r/acme-proposal/print?g=1.abc'),
      off,
      ctx,
    );
    expect(res.status).toBe(404);
  });
});

describe('the gates hold on the print route', () => {
  // P8 again. A grant proves the reader came through the wrapper; it does not
  // prove they passed the password or email gate.
  it('is not-found on a password share with a valid grant but no gate cookie', async () => {
    const { cookie, href } = await openWrapper();
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await fetchAs(`https://htmlradar.page${href}`, { cookie });
    expect(res.status).toBe(404);
  });

  it('is not-found on a revoked share with a valid grant', async () => {
    const { cookie, href } = await openWrapper();
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-01-01T00:00:00Z' });
    const res = await fetchAs(`https://htmlradar.page${href}`, { cookie });
    expect(res.status).toBe(404);
  });
});
