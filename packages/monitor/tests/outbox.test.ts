import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Env, recordOutbox, scanThreads, sendTelegram } from '../src/index.js';

// The outbox is the answer to a question nobody could answer before: what did
// this worker actually say, and when it said nothing, why?
//
// A Telegram bot cannot read its own sent history, so the only record of a
// sent message was the founder's phone, and a scan that found nothing left no
// record at all. These tests hold the four properties that fix makes real:
// a send is written down, a refusal is written down WITH the refusal, a run
// that sends nothing still writes a row, and none of the bookkeeping can cost
// the founder a message.

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

interface OutboxWrite {
  kind: string;
  source: string;
  message: string;
  telegram_ok: boolean | null;
  telegram_error?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Routes every fetch by URL and keeps whatever was POSTed to the outbox.
 * `answer` decides what each destination replies with; anything it returns
 * `null` for gets a bare 200, which is enough for the outbox insert.
 */
function stubWorld(answer: (url: string) => Response | Error | null) {
  const outbox: OutboxWrite[] = [];
  const telegram: { text: string; chat_id: string }[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (url.startsWith(OUTBOX_URL)) outbox.push(body as OutboxWrite);
      if (url.startsWith(TELEGRAM_URL)) telegram.push(body as { text: string; chat_id: string });
      const reply = answer(url);
      if (reply instanceof Error) throw reply;
      // Clone: production hands back a fresh Response every call, and these
      // canned ones are shared across tests — an already-read body would make
      // the second test in a file fail for reasons that have nothing to do
      // with the code.
      return reply ? reply.clone() : new Response('', { status: 201 });
    });
  return { outbox, telegram, spy };
}

const telegramOk = new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

afterEach(() => vi.restoreAllMocks());

describe('sendTelegram writes down what it sent', () => {
  it('records the full text and ok:true when Telegram takes the message', async () => {
    const { outbox, telegram } = stubWorld((url) =>
      url.startsWith(TELEGRAM_URL) ? telegramOk : null,
    );

    const ok = await sendTelegram(env, 'test', 'manual', 'Outbox instrumentation live.');

    expect(ok).toBe(true);
    expect(telegram).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      kind: 'test',
      source: 'manual',
      message: 'Outbox instrumentation live.',
      telegram_ok: true,
      telegram_error: null,
    });
  });

  it('carries the chat id but never the bot token', async () => {
    const { outbox } = stubWorld((url) => (url.startsWith(TELEGRAM_URL) ? telegramOk : null));

    await sendTelegram(env, 'scan', 'scanThreads', 'a message', { items_sent: 3 });

    expect(outbox[0]!.meta).toMatchObject({ chat_id: '106874', items_sent: 3 });
    expect(JSON.stringify(outbox[0])).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });

  it('records ok:false and Telegram’s own words when the send is refused', async () => {
    const refusal = new Response(
      JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
    const { outbox } = stubWorld((url) => (url.startsWith(TELEGRAM_URL) ? refusal : null));

    const ok = await sendTelegram(env, 'scan', 'scanThreads', 'a message nobody will read');

    expect(ok).toBe(false);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.telegram_ok).toBe(false);
    expect(outbox[0]!.telegram_error).toContain('HTTP 403');
    expect(outbox[0]!.telegram_error).toContain('bot was blocked');
    // The text still gets written, so a refused message can be re-sent by hand.
    expect(outbox[0]!.message).toBe('a message nobody will read');
  });

  it('records a thrown fetch, which is what a timeout looks like', async () => {
    const { outbox } = stubWorld((url) =>
      url.startsWith(TELEGRAM_URL) ? new Error('The operation was aborted') : null,
    );

    expect(await sendTelegram(env, 'alert', 'health', 'prod is down')).toBe(false);
    expect(outbox[0]!.telegram_ok).toBe(false);
    expect(outbox[0]!.telegram_error).toBe('fetch threw: The operation was aborted');
  });

  it('treats a 200 that is not Telegram JSON as a failure rather than a success', async () => {
    const edge502 = new Response('<html>Bad gateway</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const { outbox } = stubWorld((url) => (url.startsWith(TELEGRAM_URL) ? edge502 : null));

    expect(await sendTelegram(env, 'test', 'manual', 'hello')).toBe(false);
    expect(outbox[0]!.telegram_ok).toBe(false);
    expect(outbox[0]!.telegram_error).toContain('Bad gateway');
  });
});

describe('the receipt never costs the founder the message', () => {
  it('still reports the send as delivered when the outbox write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { telegram } = stubWorld((url) => {
      if (url.startsWith(TELEGRAM_URL)) return telegramOk;
      return new Response('permission denied for table telegram_outbox', { status: 401 });
    });

    const ok = await sendTelegram(env, 'test', 'manual', 'the message that matters');

    expect(ok).toBe(true);
    expect(telegram).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('swallows an outbox write that throws outright', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { telegram } = stubWorld((url) => {
      if (url.startsWith(TELEGRAM_URL)) return telegramOk;
      return new Error('supabase unreachable');
    });

    await expect(sendTelegram(env, 'test', 'manual', 'still sent')).resolves.toBe(true);
    expect(telegram).toHaveLength(1);
  });

  it('recordOutbox never throws on its own', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubWorld(() => new Error('supabase unreachable'));

    await expect(
      recordOutbox(env, { kind: 'test', source: 'manual', message: 'x', telegram_ok: null }),
    ).resolves.toBeUndefined();
  });
});

describe('a scan run is recorded even when it says nothing', () => {
  // The empty feeds both sources answer with when there is genuinely nothing.
  const emptyHN = new Response(JSON.stringify({ hits: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const emptyReddit = new Response('<feed></feed>', {
    status: 200,
    headers: { 'content-type': 'application/atom+xml' },
  });

  it('writes one scan_run row with zero items and sends no message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { outbox, telegram } = stubWorld((url) => {
      if (url.startsWith('https://hn.algolia.com')) return emptyHN;
      if (url.startsWith('https://www.reddit.com')) return emptyReddit;
      return null;
    });

    await scanThreads(env, 0);

    expect(telegram).toHaveLength(0);
    expect(outbox).toHaveLength(1);
    const run = outbox[0]!;
    expect(run.kind).toBe('scan_run');
    expect(run.source).toBe('scanThreads');
    expect(run.telegram_ok).toBeNull();
    expect(run.meta).toMatchObject({ total_items: 0, items_sent: 0, message_sent: false });
    // Five queries against two sources: every one of the ten is accounted for.
    expect(run.meta!['fetches']).toHaveLength(10);
  });

  it('names the source, query, status and count of every fetch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const blocked = new Response('<html>blocked</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const { outbox } = stubWorld((url) => {
      if (url.startsWith('https://hn.algolia.com')) return new Response('', { status: 503 });
      if (url.startsWith('https://www.reddit.com')) return blocked;
      return null;
    });

    await scanThreads(env, 0);

    const fetches = outbox[0]!.meta!['fetches'] as {
      source: string;
      query: string;
      status: number | null;
      items: number;
      error?: string;
    }[];
    expect(fetches).toHaveLength(10);
    const hn = fetches.find((f) => f.source === 'HN')!;
    expect(hn).toMatchObject({ status: 503, items: 0 });
    expect(hn.query).toBeTruthy();
    // A 200 with an HTML body is Reddit refusing, not Reddit finding nothing.
    const reddit = fetches.find((f) => f.source === 'Reddit')!;
    expect(reddit.status).toBe(200);
    expect(reddit.error).toContain('Reddit refused');
  });

  it('writes both a scan row and a scan_run row when it does have something to say', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const hnHit = new Response(
      JSON.stringify({
        hits: [
          {
            objectID: '42',
            title: 'Looking for a DocSend alternative',
            story_title: null,
            comment_text: null,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const { outbox, telegram } = stubWorld((url) => {
      if (url.startsWith('https://hn.algolia.com')) return hnHit;
      if (url.startsWith('https://www.reddit.com')) return emptyReddit;
      if (url.startsWith(TELEGRAM_URL)) return telegramOk;
      return null;
    });

    await scanThreads(env, 0);

    expect(telegram).toHaveLength(1);
    expect(telegram[0]!.text).toContain('Looking for a DocSend alternative');
    expect(outbox.map((r) => r.kind)).toEqual(['scan', 'scan_run']);
    // The sent row carries the message verbatim; the run row carries the run.
    expect(outbox[0]!.message).toBe(telegram[0]!.text);
    expect(outbox[0]!.telegram_ok).toBe(true);
    expect(outbox[1]!.telegram_ok).toBe(true);
    expect(outbox[1]!.meta).toMatchObject({ message_sent: true, items_sent: 1 });
  });

  it('does nothing at all without Telegram credentials', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { outbox, spy } = stubWorld(() => null);

    await scanThreads({ ...env, TELEGRAM_BOT_TOKEN: undefined } as Env, 0);

    expect(spy).not.toHaveBeenCalled();
    expect(outbox).toHaveLength(0);
  });
});
