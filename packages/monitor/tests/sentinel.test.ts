import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Env, sentinel } from '../src/index.js';

// The sentinel exists because the maintenance register was a thing a human
// read by hand, so a fortnight of nobody reading it looked exactly like a
// fortnight of everything being fine. These tests hold the properties that
// stop being true if it regresses: findings arrive as ONE message, a clean
// day is silent, a clean Monday still proves the cron is alive, a check that
// could not run is named rather than counted as clean, and a missing scan_run
// row — the shape of a cron that never fired — is itself a finding.

// Run on vitest's forks pool (see package.json). On the threads pool this
// file's worker intermittently fails to terminate after the tests pass — the
// run then sits at "close timed out" forever, which in CI is a hung job rather
// than a red one. Nothing in the assertions depends on the pool.

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

// 03:30 UTC on a Monday and on the Tuesday after it. The all-clear keys off
// the scheduled timestamp, so these are the only two days that matter.
const MONDAY = Date.parse('2026-08-31T03:30:00.000Z');
const TUESDAY = Date.parse('2026-09-01T03:30:00.000Z');

interface OutboxWrite {
  kind: string;
  source: string;
  message: string;
  telegram_ok: boolean | null;
  meta?: Record<string, unknown>;
}

/**
 * Answers each read with canned rows; anything unnamed answers empty. A
 * Response stands in for a refusal (a 401 is not an empty table), an Error for
 * a fetch that never got one.
 */
type Answer = unknown[] | Response | Error;

interface World {
  abuse?: Answer;
  /** Content-Range total for the failed-notification count. */
  notificationsFailed?: number | Error;
  /** Content-Range total for the unverified-notification count. */
  notificationsUnverified?: number | Error;
  scanRun?: Answer;
  radarDigest?: Answer;
  heartbeat?: Answer;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Routes every fetch by URL and keeps what was POSTed to the outbox. The
 * outbox is both read from and written to here, so writes are recognised by
 * the method rather than the URL.
 */
function stubWorld(world: World) {
  const outbox: OutboxWrite[] = [];
  const telegram: { text: string; chat_id: string }[] = [];
  const reply = (value: Answer | undefined): Response => {
    if (value instanceof Error) throw value;
    if (value instanceof Response) return value.clone();
    return json(value ?? []);
  };
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(TELEGRAM_URL)) {
        telegram.push(JSON.parse(String(init?.body)) as { text: string; chat_id: string });
        return json({ ok: true, result: { message_id: 7 } });
      }
      if (url.startsWith(OUTBOX_URL) && init?.method === 'POST') {
        outbox.push(JSON.parse(String(init.body)) as OutboxWrite);
        return new Response('', { status: 201 });
      }
      if (url.includes('/abuse_reports')) return reply(world.abuse);
      if (url.includes('/notifications_log')) {
        const unverified = url.includes('status=eq.unverified');
        const answer = unverified ? world.notificationsUnverified : world.notificationsFailed;
        if (answer instanceof Error) throw answer;
        // Null body on purpose: the count travels in the header, and the
        // check never reads the body, so an unread stream would just linger.
        return new Response(null, {
          status: 200,
          headers: { 'content-range': `0-0/${answer ?? 0}` },
        });
      }
      if (url.includes('kind=eq.scan_run')) return reply(world.scanRun);
      if (url.includes('kind=eq.radar')) return reply(world.radarDigest);
      if (url.includes('kind=eq.heartbeat')) return reply(world.heartbeat);
      throw new Error(`unexpected fetch: ${url}`);
    });
  return { outbox, telegram, spy };
}

/** A scan_run row like the one scanThreads writes, with every fetch healthy. */
function healthyScanRun(nowMs: number, extra: Record<string, unknown> = {}) {
  return [
    {
      created_at: new Date(nowMs - 23.5 * 3_600_000).toISOString(),
      meta: {
        total_items: 0,
        fetches: [{ source: 'HN', query: '"docsend alternative"', status: 200, items: 0 }],
        ...extra,
      },
    },
  ];
}

/** A radar row like the one dailyDigest writes — the real digest, or its
 *  zero-item marker — 22.5h before the sentinel's 03:30 run. */
const healthyRadarDigest = (nowMs: number) => [
  { created_at: new Date(nowMs - 22.5 * 3_600_000).toISOString() },
];

const freshHeartbeat = (nowMs: number, hoursAgo: number) => [
  { created_at: new Date(nowMs - hoursAgo * 3_600_000).toISOString() },
];

/** Everything clean, heartbeat stamped two hours ago. */
const allClear = (nowMs: number): World => ({
  abuse: [],
  notificationsFailed: 0,
  notificationsUnverified: 0,
  scanRun: healthyScanRun(nowMs),
  radarDigest: healthyRadarDigest(nowMs),
  heartbeat: freshHeartbeat(nowMs, 2),
});

afterEach(() => vi.restoreAllMocks());

describe('findings arrive as one message', () => {
  it('consolidates every finding into a single sentinel send', async () => {
    const { outbox, telegram } = stubWorld({
      abuse: [
        { reason: 'phishing', document_id: null },
        { reason: 'phishing', document_id: 'doc-1' },
        { reason: 'malware', document_id: 'doc-2' },
      ],
      notificationsFailed: 4,
      notificationsUnverified: 0,
      scanRun: [],
      radarDigest: healthyRadarDigest(TUESDAY),
      heartbeat: freshHeartbeat(TUESDAY, 70),
    });

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: 'sentinel', source: 'maintenance-sentinel' });
    expect(outbox[0]!.message).toBe(telegram[0]!.text);

    const text = telegram[0]!.text;
    // One recipient report, two automated flags — the split is the point.
    expect(text).toContain('abuse: 3 new in 24h — 1 recipient report(s), 2 automated flag(s)');
    expect(text).toContain('phishing, malware');
    expect(text).toContain('notifications: 4 email(s) failed in 24h');
    expect(text).toContain('no scan_run row in the last 26h');
    expect(text).toContain('no maintenance session has stamped the register in two days');
    expect(outbox[0]!.meta).toMatchObject({ findings: 4, abuse_reports: 3 });
  });

  it('reports the per-query errors of a scan run that did happen', async () => {
    const { telegram } = stubWorld({
      ...allClear(TUESDAY),
      scanRun: [
        {
          created_at: new Date(TUESDAY - 23.5 * 3_600_000).toISOString(),
          meta: {
            total_items: 2,
            fetches: [
              { source: 'HN', query: 'papermark alternative', status: 200, items: 2 },
              {
                source: 'Reddit',
                query: 'papermark alternative',
                status: 200,
                items: 0,
                error: 'non-XML body — Reddit refused this address',
              },
            ],
          },
        },
      ],
    });

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain('thread scan: 2 item(s), 1 of 2 fetch(es) failed');
    expect(telegram[0]!.text).toContain('Reddit refused this address');
  });

  it('flags a climbing unverified-notification count — the reconciler handoff from schema/044', async () => {
    const { telegram } = stubWorld({ ...allClear(TUESDAY), notificationsUnverified: 5 });

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain(
      'notifications: 5 unverified in 24h — reconciler cron or pg_net may be down',
    );
  });

  it('flags a missing radar row as the shape of a digest that never ran', async () => {
    const { telegram } = stubWorld({ ...allClear(TUESDAY), radarDigest: [] });

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain('radar: no radar row in the last 26h');
  });
});

describe('silence means checked and fine', () => {
  it('sends nothing at all on a clean weekday', async () => {
    const { outbox, telegram } = stubWorld(allClear(TUESDAY));

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(0);
    expect(outbox).toHaveLength(0);
  });

  it('sends the one-line all-clear on a clean Monday', async () => {
    const { outbox, telegram } = stubWorld(allClear(MONDAY));

    await sentinel(env, MONDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toBe('Sentinel: all clear this week; last heartbeat 2h ago');
    expect(outbox[0]).toMatchObject({ kind: 'sentinel', telegram_ok: true });
  });
});

describe('a check that could not run is never counted as clean', () => {
  it('names the unavailable check and still runs the others', async () => {
    const { telegram } = stubWorld({
      ...allClear(TUESDAY),
      abuse: new Error('supabase unreachable'),
      notificationsFailed: 3,
    });

    await sentinel(env, TUESDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain('check unavailable: abuse_reports — supabase unreachable');
    // The failure of one check did not hide the finding of the next.
    expect(telegram[0]!.text).toContain('notifications: 3 email(s) failed');
  });

  it('treats an HTTP refusal as unavailable, not as an empty table', async () => {
    // A 401 on the heartbeat read must not read as "no heartbeat" and must not
    // read as "heartbeat fine" — an unreadable table is neither.
    const { telegram } = stubWorld({
      ...allClear(MONDAY),
      heartbeat: new Response(null, { status: 401 }),
    });

    await sentinel(env, MONDAY);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain('check unavailable: heartbeat');
    expect(telegram[0]!.text).toContain('HTTP 401');
    expect(telegram[0]!.text).not.toContain('all clear');
  });
});

describe('the heartbeat age decides whether anyone is minding the register', () => {
  it('stays quiet at 47 hours and reports at 49', async () => {
    const quiet = stubWorld({ ...allClear(TUESDAY), heartbeat: freshHeartbeat(TUESDAY, 47) });
    await sentinel(env, TUESDAY);
    expect(quiet.telegram).toHaveLength(0);
    vi.restoreAllMocks();

    const loud = stubWorld({ ...allClear(TUESDAY), heartbeat: freshHeartbeat(TUESDAY, 49) });
    await sentinel(env, TUESDAY);
    expect(loud.telegram).toHaveLength(1);
    expect(loud.telegram[0]!.text).toContain(
      'no maintenance session has stamped the register in two days (last 49h ago)',
    );
    expect(loud.outbox[0]!.meta).toMatchObject({ heartbeat_hours: 49 });
  });

  it('says so plainly when no session has ever stamped one', async () => {
    const { telegram } = stubWorld({ ...allClear(TUESDAY), heartbeat: [] });

    await sentinel(env, TUESDAY);

    expect(telegram[0]!.text).toContain('(no heartbeat row ever)');
  });
});
