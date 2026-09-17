// Tests for scripts/live-journey.mjs — the daily check that walks a real
// user's path through production.
//
// It exists because e-mail sign-in links landed people SIGNED OUT from 4 to
// 16 September 2026 and nothing caught it for twelve days. So the case that
// matters most here is the one that failed then: a callback that redirects to
// /docs but sets no session cookie must be a FAIL, not a pass.
//
// Every fetch is stubbed. Nothing in this file touches the network.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const run = promisify(execFile);
const scriptUrl = new URL('../../scripts/live-journey.mjs', import.meta.url).href;
const scriptPath = fileURLToPath(scriptUrl);

// A variable specifier, so `tsc` leaves the untyped .mjs alone.
const { signInStep, cleanupStep, customHostStep, runJourney } = await import(
  /* @vite-ignore */ scriptPath
);

const cfg = {
  baseUrl: 'https://htmlradar.com',
  supabaseUrl: 'https://project.supabase.co',
  serviceKey: 'service-key',
  apiKey: 'hr_live_test',
  journeyEmail: 'hello@htmlradar.com',
};

/** generate_link answers with a token; the callback answers with `callback`. */
function stubFetch(callback: { status: number; location: string; cookie?: string }) {
  const headers = new Headers([['location', callback.location]]);
  if (callback.cookie) headers.append('set-cookie', callback.cookie);
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    if (url.includes('/auth/v1/admin/generate_link')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ hashed_token: 'pkce_abc123' }),
      });
    }
    return Promise.resolve({ ok: false, status: callback.status, headers });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signInStep', () => {
  it('passes when the callback redirects to /docs and sets a session cookie', async () => {
    const calls = stubFetch({
      status: 307,
      location: 'https://htmlradar.com/docs',
      cookie: 'sb-project-auth-token=abc; Path=/; HttpOnly',
    });
    await expect(signInStep(cfg)).resolves.toContain('/docs');
    expect(calls[1]).toContain('token_hash=pkce_abc123');
    expect(calls[1]).toContain('type=email');
  });

  it('fails when the callback bounces to /sign-in', async () => {
    stubFetch({ status: 307, location: '/sign-in?error=expired&next=%2Fdocs' });
    await expect(signInStep(cfg)).rejects.toThrow(/\/sign-in/);
  });

  // The 4-16 September outage, exactly: the right destination, no session.
  it('fails when the callback reaches /docs with no sb- cookie', async () => {
    stubFetch({ status: 307, location: 'https://htmlradar.com/docs' });
    await expect(signInStep(cfg)).rejects.toThrow(/signed OUT/i);
  });
});

/** PostgREST answers: the owner lookup, then the delete. */
function stubRest(deletion: { status: number; body: string }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init: { method: string }) => {
    calls.push(`${init.method} ${url}`);
    if (url.includes('/rest/v1/profiles')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('[{"id":"owner-1"}]'),
      });
    }
    return Promise.resolve({
      ok: deletion.status < 400,
      status: deletion.status,
      text: () => Promise.resolve(deletion.body),
    });
  });
  return calls;
}

describe('cleanupStep', () => {
  it("deletes only the journey account's older journey documents and counts them", async () => {
    const calls = stubRest({ status: 200, body: '[{"id":"doc-1"}]' });
    await expect(cleanupStep(cfg)).resolves.toBe('removed 1 older journey documents');
    expect(calls[1]).toContain('owner_id=eq.owner-1');
    expect(calls[1]).toContain('title=like.live-journey%20*');
    expect(calls[1]).toMatch(/created_at=lt\.\d{4}-\d{2}-\d{2}T/);
    expect(calls[1]?.startsWith('DELETE ')).toBe(true);
  });

  // Housekeeping is not production. A failure here must not page anyone.
  it('warns rather than fails when the delete errors, leaving the exit code alone', async () => {
    stubRest({ status: 500, body: 'boom' });
    const { report, firstFailure } = await runJourney(cfg, {
      api: () => Promise.resolve('served'),
      cleanup: cleanupStep,
    });
    expect(report).toMatch(/^WARN cleanup \d+ms — .*returned 500/m);
    // null is what the script checks before exiting 1, so this is exit 0.
    expect(firstFailure).toBe(null);
  });
});

// A link on a customer's own hostname has its own certificate and its own
// renewal clock, so htmlradar.page answering says nothing about it. What this
// pins is the address assertion — a link created on a domain must come back on
// that domain — and that an account with no domain skips rather than fails.
describe('customHostStep', () => {
  const HOSTNAME = 'decks.gethtmlradar.com';

  /** PostgREST answers the owner and domain lookups; the API answers `url`. */
  function stubCustomHost(domains: unknown[], url: string) {
    const calls: string[] = [];
    // The served page echoes the title the step actually created, so the
    // "200 but not the document" branch stays a real assertion rather than
    // one that fires because the stub guessed the timestamp wrong.
    let served = '';
    vi.stubGlobal('fetch', (target: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${target}`);
      const body = (value: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(value)),
        });
      if (target.includes('/rest/v1/profiles')) return body([{ id: 'owner-1' }]);
      if (target.includes('/rest/v1/custom_domains')) return body(domains);
      if (target.endsWith('/api/v1/shares')) {
        served = (JSON.parse(String(init?.body)) as { html: string }).html;
        return body({ share_id: 'share-1', url });
      }
      if (target.includes('/revoke')) return body({ ok: true });
      // The recipient fetch of the link itself.
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(served) });
    });
    return calls;
  }

  it('creates the link on the live domain and asserts the address it came back on', async () => {
    const calls = stubCustomHost(
      [{ id: 'domain-1', hostname: HOSTNAME }],
      `https://${HOSTNAME}/r/quick-glass`,
    );

    await expect(customHostStep(cfg)).resolves.toContain(`${HOSTNAME} served the document`);
    expect(calls[1]).toContain('owner_id=eq.owner-1');
    expect(calls[1]).toContain('state=eq.live');
    expect(calls[2]).toContain('POST https://htmlradar.com/api/v1/shares');
    expect(calls.at(-1)).toContain('/api/v1/shares/share-1/revoke');
  });

  // The failure that would otherwise pass: a healthy 200 from the wrong host.
  it('fails when the link comes back on htmlradar.page instead', async () => {
    stubCustomHost(
      [{ id: 'domain-1', hostname: HOSTNAME }],
      'https://htmlradar.page/r/quick-glass',
    );
    await expect(customHostStep(cfg)).rejects.toThrow(/not on decks\.gethtmlradar\.com/);
  });

  it('skips with a reason, and passes the journey, when no domain is live', async () => {
    stubCustomHost([], '');

    const { report, firstFailure } = await runJourney(cfg, { 'custom-host': customHostStep });

    expect(report).toBe('SKIP custom-host — no live domain on the journey account');
    expect(firstFailure).toBe(null);
  });
});

describe('the report', () => {
  it('marks the failing step FAIL and names it as the first failure', async () => {
    const { report, firstFailure } = await runJourney(cfg, {
      'sign-in': () => Promise.reject(new Error('no sb- cookie')),
      api: () => Promise.resolve('served'),
    });
    expect(report).toMatch(/^FAIL sign-in \d+ms — no sb- cookie$/m);
    expect(report).toMatch(/^PASS api \d+ms — served$/m);
    expect(firstFailure).toBe('sign-in');
  });

  it('exits 1 and prints the report when a step fails', async () => {
    // The script self-runs; fetch is replaced before it is imported, so the
    // whole journey fails without a packet leaving the machine.
    const failure = await run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `globalThis.fetch = () => Promise.reject(new Error('stubbed: no network'));
       process.argv[1] = ${JSON.stringify(scriptPath)};
       await import(${JSON.stringify(scriptUrl)});`,
      ],
      { env: { ...process.env, JOURNEY_EMAIL: 'journey@example.com' } },
    ).catch((error: { code: number; stdout: string }) => error);

    expect((failure as { code: number }).code).toBe(1);
    expect((failure as { stdout: string }).stdout).toMatch(/FAIL sign-in .*stubbed: no network/);
  });

  // JOURNEY_EMAIL has no default: the account has to be a Pro or comped one,
  // and guessing wrong means a daily 402 that looks like a product failure.
  it('refuses to run at all when JOURNEY_EMAIL is unset', async () => {
    const failure = await run(process.execPath, [scriptPath], {
      env: { ...process.env, JOURNEY_EMAIL: '' },
    }).catch((error: { code: number; stderr: string }) => error);

    expect((failure as { code: number }).code).toBe(1);
    expect((failure as { stderr: string }).stderr).toMatch(/JOURNEY_EMAIL is not set/);
  });
});
