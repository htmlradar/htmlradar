import { afterEach, describe, expect, it, vi } from 'vitest';

import { domainLifecycle, type Env } from '../src/index.js';

// A customer's own hostname is the one part of this product where being wrong
// is loud: promote too early and they send a link that shows a certificate
// warning; disconnect too readily and their live links stop working. These
// tests hold the properties that stop being true if the state machine
// regresses — both Cloudflare AND our own probe have to agree before anything
// is called live, one failure is a blip and two are a fact, and every write
// names the state it expected, so a check that started before the row was
// retired cannot land after and bring it back.

// Run on vitest's forks pool (see package.json), same as user-feed.test.ts.

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  RESEND_FROM: 'HTMLRadar <hello@htmlradar.com>',
  ALERT_TO: 'hello@htmlradar.com',
  POSTHOG_HOST: 'https://posthog.test',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_CHAT_ID: '106874',
  CLOUDFLARE_API_TOKEN: 'cf-token',
  CLOUDFLARE_ZONE_ID_PAGE: 'zone-page',
} as Env;

const TELEGRAM_URL = 'https://api.telegram.org/bot';
const OUTBOX_URL = 'https://db.test/rest/v1/telegram_outbox';
const CF_URL = 'https://api.cloudflare.com/client/v4/';

const NOW = Date.parse('2026-09-17T10:05:00.000Z');
const AT = '2026-09-17T10:05:00.000Z';
/** Older than the one-minute settle and the one-hour recheck alike. */
const OLD = '2026-09-17T08:00:00.000Z';

const DOMAIN_ID = 'd1111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const HOSTNAME = 'decks.acme.example';

interface RowFixture {
  id: string;
  owner_id: string;
  hostname: string;
  cloudflare_id: string | null;
  state: string;
  consecutive_failures: number | null;
  created_at: string;
  last_checked_at: string | null;
  /** What the row really is when the PATCH lands, if it moved on since. */
  actualState?: string;
}

function row(over: Partial<RowFixture> = {}): RowFixture {
  return {
    id: DOMAIN_ID,
    owner_id: OWNER,
    hostname: HOSTNAME,
    cloudflare_id: 'cf-host-1',
    state: 'pending',
    consecutive_failures: 0,
    created_at: OLD,
    last_checked_at: null,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const cfActive = () => json({ result: { status: 'active', ssl: { status: 'active' } } });
const probeOk = (id: string) =>
  new Response(`htmlradar-domain:${id}`, {
    status: 200,
    headers: { 'x-htmlradar-domain': id },
  });

interface World {
  rows: RowFixture[];
  /** Cloudflare's answer; the default is an active hostname and certificate. */
  cf?: () => Response;
  /** The hostname's answer; the default is a correct probe response. */
  probe?: () => Response;
  email?: string;
}

interface PatchCall {
  url: string;
  body: Record<string, unknown>;
}

function stubWorld(world: World) {
  const domainPatches: PatchCall[] = [];
  const profilePatches: PatchCall[] = [];
  const telegram: string[] = [];
  const outbox: { kind: string; source: string; message: string }[] = [];
  const calls: string[] = [];
  const byHostname = new Map(world.rows.map((r) => [r.hostname, r.id]));
  const serverState = new Map(world.rows.map((r) => [r.id, r.actualState ?? r.state]));

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const body = (): Record<string, unknown> =>
        JSON.parse(String(init?.body)) as Record<string, unknown>;

      if (url.startsWith(TELEGRAM_URL)) {
        telegram.push((body() as { text: string }).text);
        return json({ ok: true, result: { message_id: 7 } });
      }
      if (url.startsWith(OUTBOX_URL)) {
        outbox.push(body() as unknown as { kind: string; source: string; message: string });
        return new Response('', { status: 201 });
      }
      if (url.startsWith(CF_URL)) return (world.cf ?? cfActive)();
      if (url.includes('/.well-known/htmlradar-domain-check')) {
        const id = byHostname.get(new URL(url).hostname)!;
        return world.probe ? world.probe() : probeOk(id);
      }
      if (url.includes('/rest/v1/custom_domains')) {
        if (init?.method !== 'PATCH') {
          return json(world.rows.map(({ actualState: _drop, ...r }) => r));
        }
        domainPatches.push({ url, body: body() });
        // The conditional the whole design rests on: PostgREST matches the
        // row only if its CURRENT state is the one the URL names.
        const id = /id=eq\.([^&]+)/.exec(url)![1]!;
        const expected = /state=eq\.([^&]+)/.exec(url)![1]!;
        if (serverState.get(id) !== expected) return json([]);
        const next = body()['state'];
        if (typeof next === 'string') serverState.set(id, next);
        return json([{ id }]);
      }
      if (url.includes('/rest/v1/profiles')) {
        if (init?.method !== 'PATCH') return json([{ email: world.email ?? 'ceo@acme.example' }]);
        profilePatches.push({ url, body: body() });
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  );

  return { domainPatches, profilePatches, telegram, outbox, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('promotion', () => {
  it('goes live when Cloudflare and the probe both agree, and says so once', async () => {
    const w = stubWorld({ rows: [row()] });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain(`id=eq.${DOMAIN_ID}&state=eq.pending`);
    expect(w.domainPatches[0]!.body).toEqual({
      state: 'live',
      verified_at: AT,
      last_checked_at: AT,
      consecutive_failures: 0,
      last_error: null,
    });
    // A live domain becomes the default for new links with no toggle, but only
    // where the owner has not already chosen one.
    expect(w.profilePatches).toHaveLength(1);
    expect(w.profilePatches[0]!.url).toContain(`id=eq.${OWNER}&default_custom_domain_id=is.null`);
    expect(w.profilePatches[0]!.body).toEqual({ default_custom_domain_id: DOMAIN_ID });
    expect(w.telegram).toEqual([`${HOSTNAME} connected for acme.example`]);
    expect(outboxKinds(w.outbox)).toEqual([['user_feed', 'domain-connected']]);
  });

  it('leaves a pending domain pending while the certificate is still issuing', async () => {
    const w = stubWorld({
      rows: [row()],
      cf: () => json({ result: { status: 'active', ssl: { status: 'pending_validation' } } }),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.body).toEqual({
      last_error: 'cloudflare hostname active, certificate pending_validation',
      last_checked_at: AT,
    });
    // Not yet is not a failure: nothing counted, nothing said, and the hostname
    // is not probed at all while Cloudflare is still working.
    expect(w.calls.some((u) => u.includes('.well-known'))).toBe(false);
    expect(w.telegram).toEqual([]);
  });

  it('records a Cloudflare 5xx as the reason and changes nothing else', async () => {
    const w = stubWorld({ rows: [row()], cf: () => json({ errors: [] }, 502) });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.body).toEqual({
      last_error: 'cloudflare HTTP 502',
      last_checked_at: AT,
    });
    expect(w.telegram).toEqual([]);
    expect(w.profilePatches).toEqual([]);
  });

  it('does not touch a row that was retired while we were checking it', async () => {
    const w = stubWorld({ rows: [row({ actualState: 'retired' })] });

    await domainLifecycle(env, NOW);

    // The PATCH is attempted — and matches nothing, because it names 'pending'.
    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain('state=eq.pending');
    expect(w.profilePatches).toEqual([]);
    expect(w.telegram).toEqual([]);
  });
});

describe('the hourly re-check', () => {
  const live = (over: Partial<RowFixture> = {}) =>
    row({ state: 'live', last_checked_at: OLD, ...over });

  it('counts one failure without disconnecting anything', async () => {
    const w = stubWorld({
      rows: [live()],
      probe: () => new Response('nope', { status: 404 }),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.body).toEqual({
      consecutive_failures: 1,
      last_error: 'probe HTTP 404',
      last_checked_at: AT,
    });
    expect(w.domainPatches[0]!.body['state']).toBeUndefined();
    expect(w.telegram).toEqual([]);
    expect(w.profilePatches).toEqual([]);
  });

  it('disconnects on the second failure in a row, clears the default and says why', async () => {
    const w = stubWorld({
      rows: [live({ consecutive_failures: 1 })],
      probe: () => new Response('nope', { status: 404 }),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.url).toContain('state=eq.live');
    expect(w.domainPatches[0]!.body).toEqual({
      state: 'disconnected',
      consecutive_failures: 2,
      last_error: 'probe HTTP 404',
      last_checked_at: AT,
    });
    // Only if it is still this domain — the filter, not a read-then-write.
    expect(w.profilePatches[0]!.url).toContain(`default_custom_domain_id=eq.${DOMAIN_ID}`);
    expect(w.profilePatches[0]!.body).toEqual({ default_custom_domain_id: null });
    expect(w.telegram).toEqual([`${HOSTNAME} disconnected: probe HTTP 404`]);
    expect(outboxKinds(w.outbox)).toEqual([['user_feed', 'domain-disconnected']]);
  });

  it('puts a disconnected domain back to live when it answers again', async () => {
    const w = stubWorld({
      rows: [row({ state: 'disconnected', consecutive_failures: 2, last_checked_at: OLD })],
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.url).toContain('state=eq.disconnected');
    expect(w.domainPatches[0]!.body).toEqual({
      state: 'live',
      verified_at: AT,
      last_checked_at: AT,
      consecutive_failures: 0,
      last_error: null,
    });
    expect(w.telegram).toEqual([`${HOSTNAME} reconnected for acme.example`]);
  });

  it('leaves a live domain alone until its hour is up', async () => {
    const w = stubWorld({ rows: [live({ last_checked_at: '2026-09-17T10:00:00.000Z' })] });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toEqual([]);
    expect(w.calls.some((u) => u.startsWith(CF_URL))).toBe(false);
  });
});

describe('without the two Cloudflare secrets', () => {
  it('returns without a single fetch', async () => {
    const w = stubWorld({ rows: [row()] });

    await domainLifecycle({ ...env, CLOUDFLARE_API_TOKEN: undefined }, NOW);
    await domainLifecycle({ ...env, CLOUDFLARE_ZONE_ID_PAGE: undefined }, NOW);

    expect(w.calls).toEqual([]);
  });
});

function outboxKinds(rows: { kind: string; source: string }[]): string[][] {
  return rows.map((r) => [r.kind, r.source]);
}
