import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The recipient route, end to end through the worker's fetch handler.
//
// Two things are guarded here, both introduced with customer-chosen link
// addresses (schema/033):
//
//   1. Case. Stored slugs are always lowercase, the route regex is
//      case-insensitive, and the PostgREST lookup is not. A memorable address
//      is the kind somebody retypes off a printed page or gets back
//      title-cased from an email client, so /r/Acme-Proposal must resolve.
//      A random slug was never retyped by hand, which is why this could not
//      break before.
//
//   2. X-Robots-Tag. robots.txt only asks crawlers not to FETCH /r/; a
//      memorable address discovered elsewhere can still be indexed from that
//      reference. The header is the thing that actually prevents it, and it
//      has to be on every response, not just the document.

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
  lock_deck: true,
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
    listAttachmentsForDocument: vi.fn(async () => []),
    getAttachment: vi.fn(async () => null),
    logAttachmentDownload: vi.fn(async () => undefined),
    getViewerIdByShareEmail: vi.fn(async () => null),
    logAppEvent: vi.fn(async () => undefined),
    verifySharePassword: vi.fn(async () => 'ok'),
    notifyDisabledAttempt: vi.fn(async () => undefined),
  };
});

// HTMLRewriter is a Workers runtime global with no Node equivalent, so the
// real injectTracker cannot run here. Its own behaviour is covered by
// inject.test.ts; this file only needs a document-shaped response coming back
// so the header wrapper around it can be checked.
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

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: 'test-session-secret',
  TRACKER_URL: 'https://htmlradar.com/tracker.js',
} as unknown as import('../src/env.js').Env;

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function get(path: string): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  return worker.fetch(new Request(`https://htmlradar.page${path}`), env, ctx);
}

async function post(path: string, body: Record<string, string>): Promise<Response> {
  const worker = (await import('../src/index.js')).default;
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  return worker.fetch(
    new Request(`https://htmlradar.page${path}`, { method: 'POST', body: form }),
    env,
    ctx,
  );
}

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
});

afterEach(() => vi.clearAllMocks());

describe('slug case handling', () => {
  it('looks up an uppercase address in its lowercase form', async () => {
    const res = await get('/r/Acme-Proposal');
    expect(getShareBySlug).toHaveBeenCalledWith(env, 'acme-proposal');
    expect(res.status).toBe(200);
  });

  it('handles a fully uppercase address', async () => {
    await get('/r/ACME-PROPOSAL');
    expect(getShareBySlug).toHaveBeenCalledWith(env, 'acme-proposal');
  });

  it('leaves an already-lowercase address alone', async () => {
    await get('/r/acme-proposal');
    expect(getShareBySlug).toHaveBeenCalledWith(env, 'acme-proposal');
  });

  it('lowercases the attachment-download route too', async () => {
    await get('/r/Acme-Proposal/m/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(getShareBySlug).toHaveBeenCalledWith(env, 'acme-proposal');
  });
});

describe('X-Robots-Tag', () => {
  it('is present on a served document', async () => {
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is present on a not-found response', async () => {
    getShareBySlug.mockResolvedValue(null);
    const res = await get('/r/no-such-link');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is present on a revoked link, which must still reveal nothing', async () => {
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const body = await res.text();
    expect(body).not.toContain('owner-1');
    expect(body).not.toContain('doc-1');
    expect(body).not.toContain('acme-proposal');
  });

  it('is present on an expired link', async () => {
    getShareBySlug.mockResolvedValue({ ...share, expires_at: '2020-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(410);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is present on the email gate', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await get('/r/acme-proposal');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is present on a path that matches no route at all', async () => {
    const res = await get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  // The header is added by rebuilding the response. A gate that lost its
  // Set-Cookie on the way through would lock every recipient out of every
  // password-protected link, so this is the one that must never regress.
  it('does not cost the password gate its cookie', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await post('/r/acme-proposal/auth', { password: 'correct-horse' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Set-Cookie')).toMatch(/^htmlradar_auth_acme-proposal=/);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('CSP sandbox on every proxy response', () => {
  // Customer documents are served on the same origin as the application and
  // carry their own scripts, so every proxy response is sandboxed into an
  // opaque origin.
  //
  // allow-same-origin must never appear here — its absence is the control.
  it('is present on a served document', async () => {
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('is present on a not-found response', async () => {
    getShareBySlug.mockResolvedValue(null);
    const res = await get('/r/no-such-link');
    expect(res.status).toBe(404);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('is present on a revoked link, which must still reveal nothing', async () => {
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(403);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
    const body = await res.text();
    expect(body).not.toContain('owner-1');
    expect(body).not.toContain('doc-1');
    expect(body).not.toContain('acme-proposal');
  });

  it('is present on an expired link', async () => {
    getShareBySlug.mockResolvedValue({ ...share, expires_at: '2020-01-01T00:00:00Z' });
    const res = await get('/r/acme-proposal');
    expect(res.status).toBe(410);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('is present on the email gate', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await get('/r/acme-proposal');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  it('is present on a path that matches no route at all', async () => {
    const res = await get('/definitely-not-a-route');
    expect(res.status).toBe(404);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });

  // The header is added by rebuilding the response. A gate that lost its
  // Set-Cookie on the way through would lock every recipient out of every
  // password-protected link, so this is the one that must never regress.
  it('does not cost the password gate its cookie', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await post('/r/acme-proposal/auth', { password: 'correct-horse' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Set-Cookie')).toMatch(/^htmlradar_auth_acme-proposal=/);
    expect(res.headers.get('Location')).toBe('/r/acme-proposal');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('sandbox');
    expect(csp).toContain('allow-scripts');
    expect(csp).not.toContain('allow-same-origin');
  });
});
