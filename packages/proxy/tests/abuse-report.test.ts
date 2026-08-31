import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The recipient's abuse report, end to end through the worker's fetch handler.
//
// This is the one control in the pipeline that a phishing sender cannot
// remove: their HTML never renders on a gate page, so the link lives there
// and the form lives on a path of ours. What has to hold:
//
//   1. The form is reachable on whichever host the recipient's link points
//      at — the share host today, and the old host too while it still serves
//      documents in place.
//
//   2. A report on a link the sender has since turned off still goes
//      through, and does NOT fire the owner's disabled-open email. Telling a
//      phishing sender "somebody just came back to your dead link" is the one
//      thing this path must never do.
//
//   3. Nothing about the reporter reaches the database except a hash. The
//      report is anonymous by design; the address is the rate-limit identity
//      and stays inside the worker.
//
//   4. Every refusal — a bad reason, the rate limit, a transport failure —
//      comes back as a sentence on the form rather than as a dead end.

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
const reportAbuse = vi.fn();
const notifyDisabledAttempt = vi.fn();

vi.mock('../src/supabase.js', async () => {
  const actual = await vi.importActual<typeof import('../src/supabase.js')>('../src/supabase.js');
  return {
    ...actual,
    getShareBySlug: (...args: unknown[]) => getShareBySlug(...args),
    getDocument: vi.fn(async () => doc),
    listAttachmentsForDocument: vi.fn(async () => []),
    logAppEvent: vi.fn(async () => undefined),
    notifyDisabledAttempt: (...args: unknown[]) => notifyDisabledAttempt(...args),
    reportAbuse: (...args: unknown[]) => reportAbuse(...args),
  };
});

// HTMLRewriter is a Workers global with no Node equivalent; the document path
// is not what this file is about.
vi.mock('../src/inject.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inject.js')>('../src/inject.js');
  return {
    ...actual,
    injectTracker: vi.fn(async () => new Response('<html></html>', { status: 200 })),
  };
});

vi.mock('../src/fetch-html.js', () => ({
  fetchDocumentHtml: vi.fn(async () => new Response('<html></html>', { status: 200 })),
}));

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: 'test-session-secret',
  TRACKER_URL: 'https://htmlradar.com/v1/tracker.js',
} as unknown as import('../src/env.js').Env;

// How the worker ships before the redirect is switched on, and where a
// rollback puts it: both hosts serve documents in place.
const bothHosts = { ...baseEnv, LEGACY_HOSTS: '' } as import('../src/env.js').Env;

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

function reportPost(fields: Record<string, string>): RequestInit {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { method: 'POST', body: form };
}

const payloadOf = (
  call: unknown[],
): { slug: string; reason: string; note: string | null; ipHash: string } =>
  call[1] as { slug: string; reason: string; note: string | null; ipHash: string };

beforeEach(() => {
  getShareBySlug.mockReset();
  getShareBySlug.mockResolvedValue(share);
  reportAbuse.mockReset();
  reportAbuse.mockResolvedValue('ok');
  notifyDisabledAttempt.mockReset();
  notifyDisabledAttempt.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('the form is reachable from the link the recipient was sent', () => {
  it('renders on the share host', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('action="/r/acme-proposal/report"');
    expect(body).toContain('Report this document.');
  });

  it('renders on the old host too, while that host still serves in place', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal/report', {}, bothHosts);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('action="/r/acme-proposal/report"');
  });

  it('follows the same redirect as everything else once the old host is legacy', async () => {
    const res = await fetchAs('https://htmlradar.com/r/acme-proposal/report');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://htmlradar.page/r/acme-proposal/report');
  });

  it('accepts the report where it was submitted on the old host', async () => {
    // A 301 would turn this POST into a GET and drop the report with it.
    const res = await fetchAs(
      'https://htmlradar.com/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Report received.');
  });

  it('offers every reason the database will accept, and no others', async () => {
    const body = await (await fetchAs('https://htmlradar.page/r/acme-proposal/report')).text();
    for (const value of ['phishing', 'malware', 'personal_data', 'other']) {
      expect(body).toContain(`value="${value}"`);
    }
    // Five options, because the menu opens on an empty "Choose one" rather
    // than on whichever reason happens to be listed first.
    expect(body.match(/<option /g)).toHaveLength(5);
    expect(body).toContain('<option value="" disabled selected>');
  });

  it('caps the note in the markup as well as on the way in', async () => {
    const body = await (await fetchAs('https://htmlradar.page/r/acme-proposal/report')).text();
    expect(body).toContain('maxlength="500"');
  });

  it('is never indexed, like every other page this worker serves', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('404s for a link that opens nothing', async () => {
    getShareBySlug.mockResolvedValue(null);
    const res = await fetchAs('https://htmlradar.page/r/no-such-link/report');
    expect(res.status).toBe(404);
    expect(reportAbuse).not.toHaveBeenCalled();
  });
});

describe('a gate is never in the way of a report', () => {
  // The report block sits above the password and email gates on purpose. A
  // recipient who cannot get past the gate — because the document is a fake
  // sign-in page and they have no password for it — is exactly the person
  // most likely to want to report it. Moving the block below the gates would
  // make a gated phishing page the one kind nobody can report.
  it('renders behind a password gate without the password', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_password: true });
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('action="/r/acme-proposal/report"');
  });

  it('accepts a report behind an email gate without the email', async () => {
    getShareBySlug.mockResolvedValue({ ...share, require_email: true });
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(200);
    expect(reportAbuse).toHaveBeenCalledTimes(1);
  });
});

describe('a link the sender has turned off can still be reported', () => {
  // A revoked or expired link is exactly the kind somebody comes back to
  // report, and the report must not tell its owner that they did.
  it('serves the form for a revoked share and sends the owner nothing', async () => {
    getShareBySlug.mockResolvedValue({ ...share, revoked_at: '2026-08-01T00:00:00Z' });
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Report this document.');
    expect(notifyDisabledAttempt).not.toHaveBeenCalled();
  });

  it('accepts a report on an expired share, and sends the owner nothing', async () => {
    getShareBySlug.mockResolvedValue({ ...share, expires_at: '2026-08-01T00:00:00Z' });
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(200);
    expect(reportAbuse).toHaveBeenCalledTimes(1);
    expect(notifyDisabledAttempt).not.toHaveBeenCalled();
  });
});

describe('what a report carries', () => {
  it('sends the slug, the reason and the note', async () => {
    await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'malware', note: 'It downloads a file on open.' }),
    );
    const payload = payloadOf(reportAbuse.mock.calls[0]!);
    expect(payload.slug).toBe('acme-proposal');
    expect(payload.reason).toBe('malware');
    expect(payload.note).toBe('It downloads a file on open.');
  });

  it('treats a blank note as no note', async () => {
    await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'other', note: '   ' }),
    );
    expect(payloadOf(reportAbuse.mock.calls[0]!).note).toBeNull();
  });

  it('cuts an over-long note to 500 characters rather than refusing it', async () => {
    // Somebody who typed six hundred characters about a fake login page
    // should not lose them to a validation message.
    await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'other', note: 'x'.repeat(900) }),
    );
    expect(payloadOf(reportAbuse.mock.calls[0]!).note).toHaveLength(500);
  });
});

describe('the reporter stays anonymous', () => {
  const from = (ip: string) => ({
    ...reportPost({ reason: 'phishing' }),
    headers: { 'CF-Connecting-IP': ip },
  });

  it('sends a hash, never the address', async () => {
    await fetchAs('https://htmlradar.page/r/acme-proposal/report', from('203.0.113.7'));
    const payload = payloadOf(reportAbuse.mock.calls[0]!);
    expect(payload.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(payload)).not.toContain('203.0.113.7');
  });

  it('gives the same reporter the same hash, so five an hour can be counted', async () => {
    await fetchAs('https://htmlradar.page/r/acme-proposal/report', from('203.0.113.7'));
    await fetchAs('https://htmlradar.page/r/acme-proposal/report', from('203.0.113.7'));
    expect(payloadOf(reportAbuse.mock.calls[0]!).ipHash).toBe(
      payloadOf(reportAbuse.mock.calls[1]!).ipHash,
    );
  });

  it('gives a different reporter a different budget', async () => {
    await fetchAs('https://htmlradar.page/r/acme-proposal/report', from('203.0.113.7'));
    await fetchAs('https://htmlradar.page/r/acme-proposal/report', from('198.51.100.4'));
    expect(payloadOf(reportAbuse.mock.calls[0]!).ipHash).not.toBe(
      payloadOf(reportAbuse.mock.calls[1]!).ipHash,
    );
  });

  it('still reports when the address header is absent', async () => {
    // Every local run, and any request that reaches the worker without one.
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(200);
    expect(payloadOf(reportAbuse.mock.calls[0]!).ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('a refusal is a sentence, not a dead end', () => {
  it('asks again when the reason is missing', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report', reportPost({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Please choose a reason.');
    expect(reportAbuse).not.toHaveBeenCalled();
  });

  it('asks again when the reason is not one of the four', async () => {
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'i-do-not-like-it' }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Please choose a reason.');
    expect(reportAbuse).not.toHaveBeenCalled();
  });

  it('says wait when the address has spent its five reports', async () => {
    reportAbuse.mockResolvedValue('rate_limited');
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Try again a little later.');
    // The form comes back with it, so a genuine reporter can retry in place.
    expect(body).toContain('action="/r/acme-proposal/report"');
  });

  it('says try again when the write itself failed', async () => {
    reportAbuse.mockResolvedValue('error');
    const res = await fetchAs(
      'https://htmlradar.page/r/acme-proposal/report',
      reportPost({ reason: 'phishing' }),
    );
    expect(res.status).toBe(400);
    // Escaped in the shell, so match the half of the sentence that has no
    // apostrophe in it.
    expect(await res.text()).toContain('Try again in a moment.');
  });

  it('405s a method that is neither the form nor a report', async () => {
    const res = await fetchAs('https://htmlradar.page/r/acme-proposal/report', {
      method: 'DELETE',
    });
    expect(res.status).toBe(405);
  });
});
