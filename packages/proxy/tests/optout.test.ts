import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { issueOptOutToken } from '../src/auth.js';

// Recipient opt-out, end to end through the worker's fetch handler.
//
// The opt-out has to be server-side. Every proxy response carries
// `Content-Security-Policy: sandbox …` without allow-same-origin, which puts
// the document in an opaque origin where localStorage and document.cookie
// both throw — so the tracker had nowhere to record the recipient's choice.
// A cookie set by the proxy is the one store that survives, because the
// browser attaches cookies to a navigation based on the URL being requested,
// not on the origin the previous document happened to be given.
//
// That last claim is what the "carries the hr_optout cookie" test below
// pins down: a request with the cookie header must come back as the
// document WITHOUT the tracker in it.
//
// The other half of this file is that the WRITE is behind a POST. A document
// in a sandboxed frame may still navigate its own browsing context, and a
// crafted link reaches anyone who clicks it, so a GET that set the cookie let
// either party switch tracking off across every sender's shares — or switch
// it back on over the recipient's choice. `?optout=` now only asks; the form
// on the answer carries a ten-minute HMAC, and only that POST writes.
//
// Unlike recipient-route.test.ts, this file does NOT mock injectTracker —
// the assertions are about what is and isn't in the served body, so the real
// injection has to run. HTMLRewriter is a Workers-runtime global with no
// Node equivalent, so it gets the same treatment as in inject.test.ts: a
// stand-in that collects whatever the handlers append and returns it as the
// body. Enough to see whether the tracker tag landed.

const share = {
  id: 'share-1',
  document_id: 'doc-1',
  owner_id: 'owner-1',
  slug: 'acme-proposal',
  recipient_label: null,
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
    getDocument: vi.fn(async () => doc),
    getProfileTier: vi.fn(async () => 'free'),
    listAttachmentsForDocument: vi.fn(async () => []),
    logAppEvent: vi.fn(async () => undefined),
    notifyDisabledAttempt: vi.fn(async () => undefined),
  };
});

// The app mints owner-document-preview tokens, not the proxy, so there is no
// signing helper here to borrow. Accepting the token is all this file needs.
vi.mock('../src/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../src/auth.js')>('../src/auth.js');
  return { ...actual, verifyOwnerDocPreviewToken: vi.fn(async () => true) };
});

vi.mock('../src/fetch-html.js', () => ({
  fetchDocumentHtml: vi.fn(
    async () =>
      new Response('<html><head></head><body><h1>Deck</h1></body></html>', { status: 200 }),
  ),
}));

type Sink = { append(content: string, opts: { html: true }): void };

class FakeHTMLRewriter {
  private handlers: Record<string, { element(el: Sink): void }> = {};
  private appended: string[] = [];
  on(selector: string, handler: { element(el: Sink): void }): this {
    this.handlers[selector] = handler;
    return this;
  }
  onDocument(): this {
    return this;
  }
  transform(res: Response): Response {
    const sink: Sink = { append: (html) => void this.appended.push(html) };
    this.handlers['head']?.element(sink);
    this.handlers['body']?.element(sink);
    return new Response(`<html>${this.appended.join('')}</html>`, {
      status: res.status,
      headers: res.headers,
    });
  }
}
(globalThis as unknown as { HTMLRewriter: typeof FakeHTMLRewriter }).HTMLRewriter =
  FakeHTMLRewriter;

const env = {
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

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(`https://htmlradar.page${path}`, { headers }), env, ctx);
}

async function post(path: string, body: Record<string, string>): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  return worker.fetch(
    new Request(`https://htmlradar.page${path}`, { method: 'POST', body: form }),
    env,
    ctx,
  );
}

// The token the confirmation page hands back to its own form. Read out of the
// rendered page rather than minted here, so the test exercises the same value
// a recipient's browser would post.
function tokenFrom(html: string): string {
  const match = /name="token" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('no token in the confirmation page');
  return match[1]!;
}

const CONFIRM_OFF = 'Turn off read tracking for HTMLRadar links in this browser?';
const CONFIRM_ON = 'Turn read tracking back on?';

// Relative on purpose: the tracker is served from the document's own host,
// so it is first-party to the document (see TRACKER_PATH in src/index.ts).
const TRACKER_TAG = 'src="/v1/tracker.js"';

function expectSandboxed(res: Response): void {
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  expect(csp).toContain('sandbox');
  expect(csp).toContain('allow-scripts');
  expect(csp).not.toContain('allow-same-origin');
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('recipient opt-out', () => {
  // The blocker this design exists for: a GET must be inert. A sender's
  // script navigating its own frame, or anyone who mails the link, reaches
  // exactly this request.
  it('asks rather than acts on GET ?optout=1 — a confirmation page and no cookie', async () => {
    const res = await get('/r/acme-proposal?optout=1');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const html = await res.text();
    expect(html).toContain(CONFIRM_OFF);
    expect(html).toContain('method="POST" action="/r/acme-proposal"');
    expect(html).toContain('name="optout" value="1"');
    expectSandboxed(res);
  });

  it('asks rather than acts on GET ?optout=0 — the opposite question, still no cookie', async () => {
    const res = await get('/r/acme-proposal?optout=0', { Cookie: 'hr_optout=1' });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const html = await res.text();
    expect(html).toContain(CONFIRM_ON);
    expect(html).toContain('name="optout" value="0"');
  });

  it('sets the opt-out cookie on the confirming POST, with exactly the attributes the flow depends on', async () => {
    const token = tokenFrom(await (await get('/r/acme-proposal?optout=1')).text());
    const res = await post('/r/acme-proposal', { optout: '1', token });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
    expect(res.headers.getSetCookie()).toContain(
      'hr_optout=1; Path=/r/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax',
    );
  });

  it('writes nothing for a forged or expired token, and asks again', async () => {
    const res = await post('/r/acme-proposal', { optout: '1', token: '9999999999.deadbeef' });
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.text()).toContain(CONFIRM_OFF);

    // And an expiry is a real expiry, not decoration: mint one, walk the
    // clock past ten minutes, and it stops being spendable.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const stale = await issueOptOutToken('1', 'acme-proposal', env.SESSION_SECRET);
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    const tooLate = await post('/r/acme-proposal', { optout: '1', token: stale });
    vi.useRealTimers();
    expect(tooLate.status).toBe(400);
    expect(tooLate.headers.getSetCookie()).toEqual([]);
  });

  // A token is bound to its answer and to its share, so neither can be
  // swapped out from under the recipient.
  it('will not spend an opt-out token as an opt-in, or on another share', async () => {
    const token = tokenFrom(await (await get('/r/acme-proposal?optout=1')).text());
    const flipped = await post('/r/acme-proposal', { optout: '0', token });
    expect(flipped.status).toBe(400);
    expect(flipped.headers.getSetCookie()).toEqual([]);

    const elsewhere = await post('/r/other-deck', { optout: '1', token });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.getSetCookie()).toEqual([]);
  });

  // The claim the whole design rests on: cookies ride along on a navigation
  // to /r/* regardless of the sandbox the previous document ran under, so a
  // returning request identifies itself even though storage could not.
  it('serves the un-injected document to a request carrying the hr_optout cookie', async () => {
    const res = await get('/r/acme-proposal', { Cookie: 'hr_optout=1' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain(TRACKER_TAG);
    expect(html).not.toContain('HTMLRadarConfig');
    // Nothing to re-issue — the recipient already holds the cookie.
    expect(res.headers.getSetCookie()).toEqual([]);
    expectSandboxed(res);
  });

  it('still injects the tracker for a recipient with no opt-out cookie', async () => {
    const res = await get('/r/acme-proposal');
    const html = await res.text();
    expect(html).toContain(TRACKER_TAG);
    expect(html).toContain('HTMLRadarConfig');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('clears the cookie on the confirming POST for ?optout=0', async () => {
    const token = tokenFrom(
      await (await get('/r/acme-proposal?optout=0', { Cookie: 'hr_optout=1' })).text(),
    );
    const res = await post('/r/acme-proposal', { optout: '0', token });
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie()).toContain(
      'hr_optout=; Path=/r/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    );
  });

  it('free-tier badge carries no opt-out link or state', async () => {
    const html = await (await get('/r/acme-proposal')).text();
    expect(html).toContain('Powered by');
    expect(html).not.toContain('Opt out');
    expect(html).not.toContain('Read tracking is off');
  });

  // The sender-side raw-document preview never injects a tracker and never
  // touches a share, and the opt-out must not change either fact.
  it('leaves the owner document preview alone', async () => {
    const res = await get('/r/_doc/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?owner_doc_preview=tok');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Deck</h1>');
    expect(html).not.toContain(TRACKER_TAG);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(getShareBySlug).not.toHaveBeenCalled();
  });
});
