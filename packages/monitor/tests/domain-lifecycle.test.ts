import { afterEach, describe, expect, it, vi } from 'vitest';

import { domainLifecycle, type Env } from '../src/index.js';

// A customer's own hostname is the one part of this product where being wrong
// is loud: promote too early and they send a link that shows a certificate
// warning; disconnect too readily and their live links stop working. These
// tests hold the properties that stop being true if the state machine
// regresses — both Cloudflare AND our own probe have to agree before anything
// is called live; a failure of OURS (the Cloudflare API down, slow or
// unreadable) is never counted against the customer's domain; one probe
// failure is a blip and two are a fact; every write names the row it read, so
// neither a retired row nor a newer check can be overwritten by a slow one;
// and a promotion that dies half way is finished by a later run rather than
// leaving the domain live but unusable.

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
/** Inside the first five-minute slot of an hour, when the retired sweep runs. */
const SWEEP_NOW = Date.parse('2026-09-17T11:02:00.000Z');
const AT = '2026-09-17T10:05:00.000Z';
const AN_HOUR = 60 * 60_000;
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
  cloudflare_deleted_at: string | null;
  /** What the row really is when the PATCH lands, if it moved on since. */
  actualState?: string;
  /** Likewise its last_checked_at, if a newer run already wrote one. */
  actualLastCheckedAt?: string | null;
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
    cloudflare_deleted_at: null,
    ...over,
  };
}

const live = (over: Partial<RowFixture> = {}) =>
  row({ state: 'live', last_checked_at: OLD, ...over });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const cfActive = () => json({ result: { status: 'active', ssl: { status: 'active' } } });
const probeBody = (id: string, body: string) =>
  new Response(body, { status: 200, headers: { 'x-htmlradar-domain': id } });
const probeOk = (id: string) => probeBody(id, `htmlradar-domain:${id}`);

interface World {
  rows: RowFixture[];
  /** Cloudflare's answer; the default is an active hostname and certificate. */
  cf?: () => Response;
  /** The hostname's answer; the default is a correct probe response. */
  probe?: () => Response;
  /** Cloudflare's answer to the retired sweep's DELETE; default is success. */
  cfDelete?: () => Response;
  /** A canned answer for the profiles PATCH; null falls through to the real
   *  conditional behaviour, so a test can break the write and then mend it. */
  profilePatch?: () => Response | null;
}

interface PatchCall {
  url: string;
  body: Record<string, unknown>;
}

/**
 * One fake world per test: the Cloudflare API, the customer's hostname,
 * Telegram, and a Supabase that honours the conditional PATCHes.
 *
 * Each row is held twice on purpose — what a GET returns, and what a PATCH is
 * matched against. They start equal, and `actualState` / `actualLastCheckedAt`
 * pull them apart to rehearse the two races that matter: the row retired since
 * we read it, and a newer check that has already written its result. A PATCH
 * matches only when BOTH the state and the last_checked_at in its URL are what
 * the row currently holds; when it matches, both copies move on, so several
 * runs against one world behave as they would against one database.
 */
function stubWorld(world: World) {
  const domainPatches: PatchCall[] = [];
  const profilePatches: PatchCall[] = [];
  const telegram: string[] = [];
  const outbox: { kind: string; source: string; message: string }[] = [];
  const calls: string[] = [];
  const byHostname = new Map(world.rows.map((r) => [r.hostname, r.id]));
  const store = new Map(
    world.rows.map((r) => {
      const { actualState, actualLastCheckedAt, ...read } = r;
      return [
        r.id,
        {
          read: read as Record<string, unknown>,
          actual: {
            state: actualState ?? r.state,
            last_checked_at:
              actualLastCheckedAt === undefined ? r.last_checked_at : actualLastCheckedAt,
            cloudflare_deleted_at: r.cloudflare_deleted_at,
          },
        },
      ];
    }),
  );
  /** The owner's default, as the database holds it. */
  let defaultDomainId: string | null = null;

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
      if (url.startsWith(CF_URL)) {
        if (init?.method === 'DELETE') return (world.cfDelete ?? (() => json({ result: {} })))();
        return (world.cf ?? cfActive)();
      }
      if (url.includes('/.well-known/htmlradar-domain-check')) {
        const id = byHostname.get(new URL(url).hostname)!;
        return world.probe ? world.probe() : probeOk(id);
      }

      if (url.includes('/rest/v1/custom_domains')) {
        if (init?.method !== 'PATCH') return json([...store.values()].map((r) => r.read));
        domainPatches.push({ url, body: body() });
        const id = /id=eq\.([^&]+)/.exec(url)![1]!;
        const state = /state=eq\.([^&]+)/.exec(url)![1]!;
        // The live path conditions on last_checked_at, the retired sweep on
        // cloudflare_deleted_at; both condition on the state.
        const checked = /last_checked_at=(is\.null|eq\.[^&]+)/.exec(url)?.[1];
        const swept = /cloudflare_deleted_at=(is\.null|eq\.[^&]+)/.exec(url)?.[1];
        const held = store.get(id)!;
        const heldChecked =
          held.actual.last_checked_at === null
            ? 'is.null'
            : `eq.${encodeURIComponent(held.actual.last_checked_at)}`;
        const heldSwept = held.actual.cloudflare_deleted_at === null ? 'is.null' : 'eq.something';
        if (held.actual.state !== state) return json([]);
        if (checked !== undefined && checked !== heldChecked) return json([]);
        if (swept !== undefined && swept !== heldSwept) return json([]);
        const fields = body();
        Object.assign(held.read, fields);
        if (typeof fields['state'] === 'string') held.actual.state = fields['state'];
        if (typeof fields['last_checked_at'] === 'string') {
          held.actual.last_checked_at = fields['last_checked_at'];
        }
        if (typeof fields['cloudflare_deleted_at'] === 'string') {
          held.actual.cloudflare_deleted_at = fields['cloudflare_deleted_at'];
        }
        return json([{ id }]);
      }

      if (url.includes('/rest/v1/profiles')) {
        // The line names the hostname and nothing else, so there is no reason
        // to read a profile — a read here is a regression.
        if (init?.method !== 'PATCH') throw new Error(`profiles must not be read: ${url}`);
        profilePatches.push({ url, body: body() });
        const canned = world.profilePatch?.();
        if (canned) return canned;
        const wanted = /default_custom_domain_id=(is\.null|eq\.[^&]+)/.exec(url)![1]!;
        const matches =
          wanted === 'is.null' ? defaultDomainId === null : wanted === `eq.${defaultDomainId}`;
        if (!matches) return json([]);
        defaultDomainId = body()['default_custom_domain_id'] as string | null;
        return json([{ id: OWNER }]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  );

  return {
    domainPatches,
    profilePatches,
    telegram,
    outbox,
    calls,
    defaultDomain: () => defaultDomainId,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('promotion', () => {
  it('goes live when Cloudflare and the probe both agree, and says so once', async () => {
    const w = stubWorld({ rows: [row()] });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain(`id=eq.${DOMAIN_ID}&state=eq.pending`);
    expect(w.domainPatches[0]!.url).toContain('last_checked_at=is.null');
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
    expect(w.telegram).toEqual([`${HOSTNAME} connected`]);
    expect(outboxKinds(w.outbox)).toEqual([['user_feed', 'domain-connected']]);
  });

  it('says it once and not again on every later re-check', async () => {
    const w = stubWorld({ rows: [row()] });

    await domainLifecycle(env, NOW);
    await domainLifecycle(env, NOW + AN_HOUR);
    await domainLifecycle(env, NOW + 2 * AN_HOUR);

    expect(w.telegram).toEqual([`${HOSTNAME} connected`]);
    expect(w.domainPatches[2]!.body).toEqual({
      last_checked_at: new Date(NOW + 2 * AN_HOUR).toISOString(),
      consecutive_failures: 0,
      last_error: null,
    });
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

  it('does not touch a row that was retired while we were checking it', async () => {
    const w = stubWorld({ rows: [row({ actualState: 'retired' })] });

    await domainLifecycle(env, NOW);

    // The PATCH is attempted — and matches nothing, because it names 'pending'.
    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain('state=eq.pending');
    expect(w.profilePatches).toEqual([]);
    expect(w.telegram).toEqual([]);
  });

  it('rejects a probe body that is right except for the whitespace round it', async () => {
    const w = stubWorld({
      rows: [row()],
      probe: () => probeBody(DOMAIN_ID, ` htmlradar-domain:${DOMAIN_ID}\n`),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.body).toEqual({
      last_error: 'probe answered with the wrong body',
      last_checked_at: AT,
    });
    expect(w.telegram).toEqual([]);
  });

  it('rejects a probe body that starts right and then runs on', async () => {
    const w = stubWorld({
      rows: [row()],
      probe: () => probeBody(DOMAIN_ID, `htmlradar-domain:${DOMAIN_ID}` + 'x'.repeat(4_096)),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.body['last_error']).toBe('probe answered with the wrong body');
    expect(w.telegram).toEqual([]);
  });
});

describe('a failure of ours is not a failure of theirs', () => {
  it('records a Cloudflare 5xx against a pending domain and counts nothing', async () => {
    const w = stubWorld({ rows: [row()], cf: () => json({ errors: [] }, 502) });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches[0]!.body).toEqual({
      last_error: 'cloudflare HTTP 502',
      last_checked_at: AT,
    });
    expect(w.telegram).toEqual([]);
    expect(w.profilePatches).toEqual([]);
  });

  it('leaves a live domain live through two Cloudflare 502s in a row', async () => {
    const w = stubWorld({ rows: [live()], cf: () => json({ errors: [] }, 502) });

    await domainLifecycle(env, NOW);
    await domainLifecycle(env, NOW + AN_HOUR);

    // Two runs, two reasons recorded, not one failure counted: the API being
    // down tells us nothing about the customer's DNS.
    expect(w.domainPatches).toHaveLength(2);
    expect(w.domainPatches.map((p) => p.body['last_error'])).toEqual([
      'cloudflare HTTP 502',
      'cloudflare HTTP 502',
    ]);
    expect(w.domainPatches.some((p) => 'consecutive_failures' in p.body)).toBe(false);
    expect(w.domainPatches.some((p) => 'state' in p.body)).toBe(false);
    expect(w.telegram).toEqual([]);
  });

  it('treats an unreadable Cloudflare body the same way', async () => {
    const w = stubWorld({
      rows: [live({ consecutive_failures: 1 })],
      cf: () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
    });

    await domainLifecycle(env, NOW);

    // One strike already on the row, and this run adds nothing to it.
    expect(w.domainPatches[0]!.body).toEqual({
      last_error: 'cloudflare answered with a body we could not read',
      last_checked_at: AT,
    });
    expect(w.telegram).toEqual([]);
  });
});

describe('the hourly re-check', () => {
  it('counts one probe failure without disconnecting anything', async () => {
    const w = stubWorld({ rows: [live()], probe: () => new Response('nope', { status: 404 }) });

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
    expect(w.telegram).toEqual([`${HOSTNAME} connected`]);
    expect(w.defaultDomain()).toBe(DOMAIN_ID);
  });

  it('leaves a live domain alone until its hour is up', async () => {
    const w = stubWorld({ rows: [live({ last_checked_at: '2026-09-17T10:00:00.000Z' })] });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toEqual([]);
    expect(w.calls.some((u) => u.startsWith(CF_URL))).toBe(false);
  });
});

describe('a check that overlaps a newer one', () => {
  it('cannot overwrite the newer result with its own', async () => {
    // Read as live and last checked at OLD; by the time this PATCH lands,
    // another run has already written a fresher last_checked_at.
    const w = stubWorld({
      rows: [live({ actualLastCheckedAt: '2026-09-17T10:04:00.000Z' })],
      probe: () => new Response('nope', { status: 404 }),
    });

    await domainLifecycle(env, NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain(`last_checked_at=eq.${encodeURIComponent(OLD)}`);
    // Matched nothing: no failure recorded, no default cleared, nothing said.
    expect(w.profilePatches).toEqual([]);
    expect(w.telegram).toEqual([]);
  });
});

describe('a promotion that dies half way', () => {
  it('is finished by the next run rather than leaving the domain unusable', async () => {
    let profileWriteBroken = true;
    const w = stubWorld({
      rows: [row()],
      profilePatch: () => (profileWriteBroken ? json({ message: 'boom' }, 500) : null),
    });

    await domainLifecycle(env, NOW);

    // The row is live, but no default was claimed and nobody was told — which
    // is the failure mode worth catching: a domain live in the database and
    // useless to the customer.
    expect(w.domainPatches[0]!.body['state']).toBe('live');
    expect(w.telegram).toEqual([]);
    expect(w.defaultDomain()).toBeNull();

    profileWriteBroken = false;
    await domainLifecycle(env, NOW + AN_HOUR);

    expect(w.defaultDomain()).toBe(DOMAIN_ID);
    expect(w.telegram).toEqual([`${HOSTNAME} connected`]);
  });
});

describe('the retired sweep', () => {
  const retired = (over: Partial<RowFixture> = {}) =>
    row({ state: 'retired', last_checked_at: OLD, ...over });

  it('gives the hostname back to Cloudflare and stamps the row', async () => {
    const w = stubWorld({ rows: [retired()] });

    await domainLifecycle(env, SWEEP_NOW);

    expect(w.calls.filter((u) => u.startsWith(CF_URL))).toHaveLength(1);
    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.url).toContain('state=eq.retired&cloudflare_deleted_at=is.null');
    // Exactly one field. A retired row's state, hostname and history are
    // evidence now, and nothing here may rewrite them.
    expect(w.domainPatches[0]!.body).toEqual({
      cloudflare_deleted_at: new Date(SWEEP_NOW).toISOString(),
    });
    expect(w.telegram).toEqual([]);
  });

  it('counts a 404 as gone, because that is the state we asked for', async () => {
    const w = stubWorld({ rows: [retired()], cfDelete: () => json({ errors: [] }, 404) });

    await domainLifecycle(env, SWEEP_NOW);

    expect(w.domainPatches[0]!.body).toEqual({
      cloudflare_deleted_at: new Date(SWEEP_NOW).toISOString(),
    });
  });

  it('leaves a row for the next hour when Cloudflare 5xxs', async () => {
    const w = stubWorld({ rows: [retired()], cfDelete: () => json({ errors: [] }, 503) });

    await domainLifecycle(env, SWEEP_NOW);

    expect(w.domainPatches).toHaveLength(1);
    expect(w.domainPatches[0]!.body).toEqual({ last_error: 'cloudflare DELETE HTTP 503' });
    expect(w.domainPatches[0]!.body['cloudflare_deleted_at']).toBeUndefined();
  });

  it('does not touch a row that is already marked deleted', async () => {
    const w = stubWorld({ rows: [retired({ cloudflare_deleted_at: '2026-09-16T09:00:00.000Z' })] });

    await domainLifecycle(env, SWEEP_NOW);

    expect(w.calls.some((u) => u.startsWith(CF_URL))).toBe(false);
    expect(w.domainPatches).toEqual([]);
  });

  it('does not sweep outside the first five minutes of the hour', async () => {
    const w = stubWorld({ rows: [retired()] });

    await domainLifecycle(env, NOW);

    expect(w.calls.some((u) => u.startsWith(CF_URL))).toBe(false);
    expect(w.domainPatches).toEqual([]);
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
