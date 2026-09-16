import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Env, userFeed } from '../src/index.js';

// The user feed exists because the people were invisible: the first paying
// customer was noticed a day after he paid. These tests hold the properties
// that stop being true if it regresses — one message per moment and not one
// per row, our own accounts and the public demo link never counted as news,
// the cursor closing the window so a second run over the same rows is silent,
// and a Supabase refusal costing nothing (nothing sent, cursor unmoved, so the
// next run covers the same window rather than skipping it).

// Run on vitest's forks pool (see package.json), same as sentinel.test.ts.

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  RESEND_FROM: 'HTMLRadar <hello@htmlradar.com>',
  ALERT_TO: 'hello@htmlradar.com',
  POSTHOG_HOST: 'https://posthog.test',
  TELEGRAM_BOT_TOKEN: 'bot-token-that-must-never-appear-in-a-row',
  TELEGRAM_CHAT_ID: '106874',
} as Env;

const OUTBOX_URL = 'https://db.test/rest/v1/telegram_outbox';
const TELEGRAM_URL = 'https://api.telegram.org/bot';

const NOW = Date.parse('2026-09-16T10:05:00.000Z');
const NEXT_RUN = NOW + 5 * 60_000;
const CURSOR_AT = '2026-09-16T10:00:00.000Z';
/** Inside [CURSOR_AT, NOW) — every fixture row is stamped with it. */
const AT = '2026-09-16T10:02:00.000Z';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NEWCOMER = '22222222-2222-4222-8222-222222222222';
const US = '33333333-3333-4333-8333-333333333333';

interface OutboxWrite {
  kind: string;
  source: string;
  message: string;
  telegram_ok: boolean | null;
  meta?: Record<string, unknown>;
}

/** Canned rows, or a Response for a refusal (a 500 is not an empty table). */
type Answer = unknown[] | Response;

interface World {
  /** Rows in the tables the feed reads per run. Anything unnamed is empty. */
  signups?: Answer;
  shares?: Answer;
  sessions?: Answer;
  intents?: Answer;
  /** Every share the named owners hold, for the "first ever" test. */
  allShares?: Answer;
  /** profiles?id=in.(...) — the owner-email lookup. */
  profiles?: Answer;
  /** The user.signed_up attribution rows. */
  signupEvents?: Answer;
  /** Absent means the cursor row exists and reads CURSOR_AT. */
  cursorMissing?: boolean;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Applies the request's own [gte, lt) to the canned rows, so "the second run
 * says nothing" is the real behaviour rather than an assertion about a URL.
 * A row with no timestamp is a fixture bug and says so.
 */
function inWindow(url: string, rows: unknown[]): unknown[] {
  const bound = (op: string): number =>
    Date.parse(decodeURIComponent(new RegExp(`${op}\\.([^&]+)`).exec(url)![1]!));
  const gte = bound('gte');
  const lt = bound('lt');
  return rows.filter((r) => {
    const row = r as Record<string, unknown>;
    const stamp = row['created_at'] ?? row['started_at'] ?? row['timestamp'];
    if (typeof stamp !== 'string') throw new Error(`fixture row has no timestamp: ${url}`);
    const at = Date.parse(stamp);
    return at >= gte && at < lt;
  });
}

/**
 * Routes every fetch by URL, keeps what was sent and written, and honours the
 * PATCH — so a second userFeed() call against the same stub sees the window the
 * first one closed.
 */
function stubWorld(world: World) {
  const outbox: OutboxWrite[] = [];
  const telegram: { text: string; chat_id: string }[] = [];
  const cursor = { at: world.cursorMissing ? null : CURSOR_AT };
  const reply = (url: string, value: Answer | undefined, windowed: boolean): Response => {
    if (value instanceof Response) return value.clone();
    return json(windowed ? inWindow(url, value ?? []) : (value ?? []));
  };

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(TELEGRAM_URL)) {
        telegram.push(JSON.parse(String(init?.body)) as { text: string; chat_id: string });
        return json({ ok: true, result: { message_id: 7 } });
      }
      if (url.startsWith(OUTBOX_URL) && init?.method === 'POST') {
        outbox.push(JSON.parse(String(init.body)) as OutboxWrite);
        return new Response('', { status: 201 });
      }
      if (url.includes('/user_feed_cursor')) {
        if (init?.method === 'PATCH') {
          cursor.at = (JSON.parse(String(init.body)) as { last_run_at: string }).last_run_at;
          // PostgREST answers a PATCH with 204 and no body.
          return new Response(null, { status: 204 });
        }
        return json(cursor.at ? [{ last_run_at: cursor.at }] : []);
      }
      // A window filter is what separates a per-run read from a lookup.
      const windowed = url.includes('gte.') && url.includes('lt.');
      if (url.includes('/profiles')) {
        return reply(url, windowed ? world.signups : world.profiles, windowed);
      }
      if (url.includes('/document_shares')) {
        return reply(url, windowed ? world.shares : world.allShares, windowed);
      }
      if (url.includes('/sessions')) return reply(url, world.sessions, windowed);
      if (url.includes('/app_events')) {
        const attribution = url.includes('user.signed_up');
        return reply(url, attribution ? world.signupEvents : world.intents, windowed);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  );
  return { outbox, telegram, cursor };
}

const ownersShare = {
  slug: 'quiet-otter',
  owner_id: OWNER,
  document_id: 'doc-1',
  documents: { title: 'Series A deck' },
};

/** One of each moment, all inside [CURSOR_AT, NOW). */
const busyWindow = (): World => ({
  signups: [{ id: NEWCOMER, email: 'ceo@northwind.example', created_at: AT }],
  signupEvents: [
    {
      event: 'user.signed_up',
      user_id: NEWCOMER,
      properties: {
        provider: 'google',
        first_referrer: 'https://news.ycombinator.com/item?id=1',
        first_landing: '/convert',
      },
    },
  ],
  shares: [{ id: 'share-1', ...ownersShare, created_at: AT }],
  allShares: [{ owner_id: OWNER }],
  sessions: [
    {
      started_at: AT,
      viewers: { email: 'partner@fund.example', country_code: 'DE', device_type: 'desktop' },
      document_shares: ownersShare,
    },
  ],
  intents: [{ event: 'upgrade.viewed', user_id: OWNER, timestamp: AT }],
  profiles: [{ id: OWNER, email: 'founder@acme.example' }],
});

afterEach(() => vi.restoreAllMocks());

describe('one message per moment', () => {
  it('says each of the four moments once, and nothing else', async () => {
    const { outbox, telegram } = stubWorld(busyWindow());

    await userFeed(env, NOW);

    expect(telegram.map((t) => t.text)).toEqual([
      'New sign-up: northwind.example (google) via news.ycombinator.com /convert',
      "First share: acme.example — 'Series A deck'",
      "acme.example's 'Series A deck' was read from DE/desktop",
      'acme.example viewed upgrade',
    ]);
    // Every send leaves its receipt, under the kind schema/051 widened for.
    expect(outbox).toHaveLength(4);
    expect(outbox.every((r) => r.kind === 'user_feed')).toBe(true);
    expect(outbox.map((r) => r.source)).toEqual([
      'signup',
      'first-share',
      'outside-read',
      'upgrade-interest',
    ]);
    expect(outbox[0]!.message).toBe(telegram[0]!.text);
    // The bot token is in the URL, never in a row (schema/038).
    expect(JSON.stringify(outbox)).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });

  it('falls back to "source unknown" when the sign-up carries no attribution', async () => {
    const { telegram } = stubWorld({
      signups: [{ id: NEWCOMER, email: 'ceo@northwind.example', created_at: AT }],
      signupEvents: [],
    });

    await userFeed(env, NOW);

    expect(telegram[0]!.text).toBe('New sign-up: northwind.example via source unknown');
  });

  it('stays quiet about a share that is not the owner’s first', async () => {
    const world = busyWindow();
    world.allShares = [{ owner_id: OWNER }, { owner_id: OWNER }];
    const { telegram } = stubWorld(world);

    await userFeed(env, NOW);

    expect(telegram.map((t) => t.text)).not.toContain(
      "First share: acme.example — 'Series A deck'",
    );
    expect(telegram).toHaveLength(3);
  });

  it('reports one outside read per document, however many sessions it had', async () => {
    const world = busyWindow();
    const session = (world.sessions as unknown[])[0];
    world.sessions = [session, session, session];
    const { telegram } = stubWorld(world);

    await userFeed(env, NOW);

    expect(telegram.filter((t) => t.text.includes('was read from'))).toHaveLength(1);
  });

  it('ignores an owner reading their own document', async () => {
    const world = busyWindow();
    world.sessions = [
      {
        started_at: AT,
        viewers: { email: 'founder@acme.example', country_code: 'IN', device_type: 'desktop' },
        document_shares: ownersShare,
      },
    ];
    const { telegram } = stubWorld(world);

    await userFeed(env, NOW);

    expect(telegram.filter((t) => t.text.includes('was read from'))).toHaveLength(0);
  });

  it('counts an anonymous reader, whose domain is nobody’s', async () => {
    const world = busyWindow();
    world.sessions = [
      {
        started_at: AT,
        viewers: { email: null, country_code: null, device_type: null },
        document_shares: ownersShare,
      },
    ];
    const { telegram } = stubWorld(world);

    await userFeed(env, NOW);

    expect(telegram.map((t) => t.text)).toContain(
      "acme.example's 'Series A deck' was read from ??/unknown",
    );
  });

  it('names the free limit separately from an upgrade page view', async () => {
    const { telegram } = stubWorld({
      intents: [
        { event: 'free_tier.share_cap_hit', user_id: OWNER, timestamp: AT },
        // Same user, same event, twice in one window — one message.
        { event: 'free_tier.share_cap_hit', user_id: OWNER, timestamp: AT },
        { event: 'upgrade.viewed', user_id: OWNER, timestamp: AT },
        // Anonymous /upgrade view: no account, so nothing to say about it.
        { event: 'upgrade.viewed', user_id: null, timestamp: AT },
      ],
      profiles: [{ id: OWNER, email: 'founder@acme.example' }],
    });

    await userFeed(env, NOW);

    expect(telegram.map((t) => t.text)).toEqual([
      'acme.example hit the free limit',
      'acme.example viewed upgrade',
    ]);
  });
});

describe('our own accounts and our own demo link are never news', () => {
  it('drops internal sign-ups, shares, reads and upgrade views', async () => {
    const internalShare = {
      slug: 'internal-test',
      owner_id: US,
      document_id: 'doc-us',
      documents: { title: 'Test upload' },
    };
    const { telegram, outbox, cursor } = stubWorld({
      signups: [
        { id: US, email: 'abhinandan@draconic.ai', created_at: AT },
        { id: US, email: 'hello@htmlradar.com', created_at: AT },
      ],
      signupEvents: [],
      shares: [{ id: 'share-us', ...internalShare, created_at: AT }],
      allShares: [{ owner_id: US }],
      sessions: [
        {
          started_at: AT,
          viewers: { email: 'stranger@example.com', country_code: 'US', device_type: 'mobile' },
          document_shares: internalShare,
        },
      ],
      intents: [{ event: 'upgrade.viewed', user_id: US, timestamp: AT }],
      profiles: [{ id: US, email: 'abhinandan@draconic.ai' }],
    });

    await userFeed(env, NOW);

    expect(telegram).toHaveLength(0);
    expect(outbox).toHaveLength(0);
    // Silent, but the window still closed.
    expect(cursor.at).toBe(new Date(NOW).toISOString());
  });

  it('drops the public demo share, whose readers are blog traffic', async () => {
    const demoShare = {
      slug: 'lumenforge-demo',
      owner_id: OWNER,
      document_id: 'doc-demo',
      documents: { title: 'Lumenforge' },
    };
    const { telegram } = stubWorld({
      shares: [{ id: 'share-demo', ...demoShare, created_at: AT }],
      allShares: [{ owner_id: OWNER }],
      sessions: [
        {
          started_at: AT,
          viewers: { email: null, country_code: 'BR', device_type: 'mobile' },
          document_shares: demoShare,
        },
      ],
      profiles: [{ id: OWNER, email: 'founder@acme.example' }],
    });

    await userFeed(env, NOW);

    expect(telegram).toHaveLength(0);
  });
});

describe('the cursor, not the worker, is what stops a repeat', () => {
  it('advances to now, and a second run over the same rows says nothing', async () => {
    const stub = stubWorld(busyWindow());

    await userFeed(env, NOW);
    expect(stub.telegram).toHaveLength(4);
    expect(stub.cursor.at).toBe(new Date(NOW).toISOString());

    // Same stub, same rows, five minutes later. The rows now sit before the
    // window's open edge, so nothing is said a second time.
    await userFeed(env, NEXT_RUN);
    expect(stub.telegram).toHaveLength(4);
    expect(stub.outbox).toHaveLength(4);
    expect(stub.cursor.at).toBe(new Date(NEXT_RUN).toISOString());
  });

  it('opens a five-minute window when there is no cursor row yet', async () => {
    const { telegram } = stubWorld({ ...busyWindow(), cursorMissing: true });

    // AT is three minutes before NOW, so it falls inside the fallback window.
    await userFeed(env, NOW);

    expect(telegram).toHaveLength(4);
  });
});

describe('a Supabase refusal costs nothing', () => {
  it('sends nothing and leaves the cursor alone', async () => {
    const world = busyWindow();
    world.shares = new Response('permission denied', { status: 500 });
    const { telegram, outbox, cursor } = stubWorld(world);

    // The caller logs this; scheduled() catches it so the health checks run on.
    await expect(userFeed(env, NOW)).rejects.toThrow('document_shares read HTTP 500');

    expect(telegram).toHaveLength(0);
    expect(outbox).toHaveLength(0);
    // Unmoved, so the next run covers this window again rather than skipping it.
    expect(cursor.at).toBe(CURSOR_AT);
  });

  it('does nothing at all when there is no Telegram to say it to', async () => {
    const { telegram, cursor } = stubWorld(busyWindow());

    await userFeed({ ...env, TELEGRAM_BOT_TOKEN: undefined }, NOW);

    expect(telegram).toHaveLength(0);
    expect(cursor.at).toBe(CURSOR_AT);
  });
});

describe('a quiet window', () => {
  it('sends nothing, closes the window, and skips the lookups it cannot need', async () => {
    const { telegram, cursor } = stubWorld({});

    await userFeed(env, NOW);

    expect(telegram).toHaveLength(0);
    expect(cursor.at).toBe(new Date(NOW).toISOString());

    // Four window reads, the cursor read, the cursor write. No id=in.() lookup
    // and no attribution read when there is nothing to look up.
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('id=in.('))).toHaveLength(0);
    expect(urls.filter((u) => u.includes('user.signed_up'))).toHaveLength(0);
    expect(urls).toHaveLength(6);
  });
});
