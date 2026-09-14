import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALERT_REPEAT_MS, type Env, deliverHealthAlert } from '../src/index.js';

// The health alert used to email on every failing five-minute run. On
// 14 Sep 2026 a single Cloudflare colo returned 503 for one edge route for
// three hours and the founder got 31 identical emails. These tests hold the
// new contract: the same set of tripped checks emails once per window, a
// changed set emails again, a clean run after an alert emails one recovery
// note, and an outbox that cannot be read never silences a real outage.

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  RESEND_FROM: 'HTMLRadar <hello@htmlradar.com>',
  ALERT_TO: 'hello@htmlradar.com',
} as Env;

const OUTBOX_URL = 'https://db.test/rest/v1/telegram_outbox';
const RESEND_URL = 'https://api.resend.com/emails';
const NOW = Date.UTC(2026, 8, 14, 4, 0, 0);

interface OutboxRow {
  message: string;
  meta?: { recovered?: boolean };
}

/** Stubs the outbox read (what it answers) and captures every send and write. */
function stubWorld(previous: OutboxRow[] | Error) {
  const emails: { subject: string; text: string }[] = [];
  const writes: {
    kind: string;
    source: string;
    message: string;
    meta?: Record<string, unknown>;
  }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith(RESEND_URL)) {
        emails.push(JSON.parse(init!.body as string));
        return new Response('{"id":"x"}', { status: 200 });
      }
      if (url.startsWith(OUTBOX_URL) && method === 'POST') {
        writes.push(JSON.parse(init!.body as string));
        return new Response('', { status: 201 });
      }
      if (url.startsWith(OUTBOX_URL)) {
        if (previous instanceof Error) return new Response('', { status: 500 });
        return new Response(JSON.stringify(previous), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  );
  return { emails, writes };
}

afterEach(() => vi.restoreAllMocks());

const tripped = [
  'https://htmlradar.com/sign-in returned HTTP 503 (expected 200) — failed all 3 attempts',
];

describe('health alerts are throttled', () => {
  it('emails the first time a set of checks trips and writes one outbox row', async () => {
    const world = stubWorld([]);
    expect(await deliverHealthAlert(env, tripped, NOW)).toBe('sent');
    expect(world.emails).toHaveLength(1);
    expect(world.emails[0]!.subject).toBe('[HTMLRadar] 1 prod check failing');
    expect(world.emails[0]!.text).toContain(tripped[0]);
    expect(world.writes).toEqual([
      expect.objectContaining({ kind: 'alert', source: 'prodcheck', message: tripped[0] }),
    ]);
  });

  it('stays silent while the same set keeps tripping inside the window', async () => {
    const world = stubWorld([{ message: tripped[0]!, meta: { recovered: false } }]);
    expect(await deliverHealthAlert(env, tripped, NOW + 5 * 60_000)).toBe('suppressed');
    expect(world.emails).toHaveLength(0);
    expect(world.writes).toHaveLength(0);
  });

  it('emails again when the set of failing checks changes', async () => {
    const world = stubWorld([{ message: tripped[0]!, meta: { recovered: false } }]);
    const more = [...tripped, 'https://htmlradar.page/robots.txt returned HTTP 500 (expected 200)'];
    expect(await deliverHealthAlert(env, more, NOW + 5 * 60_000)).toBe('sent');
    expect(world.emails[0]!.subject).toBe('[HTMLRadar] 2 prod checks failing');
  });

  it('sends one recovery note when a clean run follows an alert', async () => {
    const world = stubWorld([{ message: tripped[0]!, meta: { recovered: false } }]);
    expect(await deliverHealthAlert(env, [], NOW + 10 * 60_000)).toBe('recovered');
    expect(world.emails).toHaveLength(1);
    expect(world.emails[0]!.subject).toBe('[HTMLRadar] prod checks recovered');
    expect(world.emails[0]!.text).toContain(tripped[0]);
    expect(world.writes[0]).toEqual(
      expect.objectContaining({
        kind: 'alert',
        meta: expect.objectContaining({ recovered: true }),
      }),
    );
  });

  it('does not repeat the recovery note on the next clean run', async () => {
    const world = stubWorld([{ message: tripped[0]!, meta: { recovered: true } }]);
    expect(await deliverHealthAlert(env, [], NOW + 15 * 60_000)).toBe('quiet');
    expect(world.emails).toHaveLength(0);
  });

  it('says nothing on a clean run with no alert in the window', async () => {
    const world = stubWorld([]);
    expect(await deliverHealthAlert(env, [], NOW)).toBe('quiet');
    expect(world.emails).toHaveLength(0);
    expect(world.writes).toHaveLength(0);
  });

  it('still emails when the outbox cannot be read, so a lookup failure never hides an outage', async () => {
    const world = stubWorld(new Error('db down'));
    expect(await deliverHealthAlert(env, tripped, NOW)).toBe('sent');
    expect(world.emails).toHaveLength(1);
  });

  it('exposes a one-hour window', () => {
    expect(ALERT_REPEAT_MS).toBe(60 * 60_000);
  });
});
