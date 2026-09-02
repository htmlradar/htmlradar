import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type Env,
  type TelegramUpdate,
  handleTelegramUpdate,
  handleWebhookRequest,
  parseRedditThread,
} from '../src/index.js';

// One-tap posting. The rule these tests hold is the SOP's, not a UX
// preference: nothing reaches Reddit without a tap from the founder, and a tap
// reaches Reddit exactly once. Every test stubs Supabase, Telegram and Reddit;
// none touches the network.

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  RESEND_FROM: 'HTMLRadar <hello@htmlradar.com>',
  ALERT_TO: 'hello@htmlradar.com',
  POSTHOG_HOST: 'https://posthog.test',
  TELEGRAM_BOT_TOKEN: 'bot-token-that-must-never-appear-anywhere',
  TELEGRAM_CHAT_ID: '106874',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  REDDIT_CLIENT_ID: 'client-id',
  REDDIT_CLIENT_SECRET: 'client-secret-that-must-never-appear-anywhere',
  REDDIT_REFRESH_TOKEN: 'refresh-token-that-must-never-appear-anywhere',
  REDDIT_USERNAME: 'founder',
} as Env;

const NOW = Date.parse('2026-09-03T06:00:00.000Z');
const THREAD_URL = 'https://www.reddit.com/r/sales/comments/abc123/how_do_i_share_a_deck/';
const PERMALINK = '/r/sales/comments/abc123/how_do_i_share_a_deck/def456/';

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// A small stand-in for the three systems the handler talks to.

interface DraftRecord {
  id: string;
  source_url: string;
  thing_id: string;
  subreddit: string | null;
  draft_text: string;
  status: string;
  permalink: string | null;
  posted_at: string | null;
  error: string | null;
  telegram_message_id: number | null;
  created_at: string;
}

function draftRecord(over: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    source_url: THREAD_URL,
    thing_id: 't3_abc123',
    subreddit: 'sales',
    draft_text: 'DRAFT (personal account, edit before posting): You can send it as a link.',
    status: 'pending',
    permalink: null,
    posted_at: null,
    error: null,
    telegram_message_id: 500,
    created_at: '2026-09-03T05:00:00.000Z',
    ...over,
  };
}

/** PostgREST's filter grammar, only the three operators this code uses. */
function matches(row: DraftRecord, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const got = String((row as unknown as Record<string, unknown>)[key] ?? '');
    if (value.startsWith('eq.')) {
      if (got !== value.slice(3)) return false;
    } else if (value.startsWith('gte.')) {
      if (!(got >= value.slice(4))) return false;
    } else if (value.startsWith('in.')) {
      if (
        !value
          .slice(3)
          .replace(/^\(|\)$/g, '')
          .split(',')
          .includes(got)
      )
        return false;
    }
  }
  return true;
}

interface World {
  drafts: DraftRecord[];
  /** What Reddit's POST /api/comment answers. Default: accepted. */
  comment?: { status: number; body: string };
  /** What the token exchange answers. Default: a token. */
  token?: { status: number; body: string };
}

function stub(world: World) {
  const telegram: { method: string; body: Record<string, unknown> }[] = [];
  const reddit: { url: string; body: string; userAgent: string | null }[] = [];
  const outbox: Record<string, unknown>[] = [];
  let nextMessageId = 900;

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = String(input);
      const url = new URL(raw);
      const method = init?.method ?? 'GET';

      if (url.hostname === 'api.telegram.org') {
        const m = url.pathname.split('/').pop() ?? '';
        telegram.push({
          method: m,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        // Only a send makes a new message; an edit answers with the id it was
        // given, exactly as the real Bot API does.
        const id = m === 'sendMessage' ? ++nextMessageId : Number(telegram.at(-1)?.body.message_id);
        return json({ ok: true, result: { message_id: id } });
      }

      if (url.hostname.endsWith('reddit.com')) {
        const headers = new Headers(init?.headers);
        reddit.push({ url: raw, body: String(init?.body), userAgent: headers.get('User-Agent') });
        if (url.pathname === '/api/v1/access_token') {
          const t = world.token ?? { status: 200, body: JSON.stringify({ access_token: 'at-1' }) };
          return new Response(t.body, { status: t.status });
        }
        const c = world.comment ?? {
          status: 200,
          body: JSON.stringify({
            json: { errors: [], data: { things: [{ data: { permalink: PERMALINK } }] } },
          }),
        };
        return new Response(c.body, { status: c.status });
      }

      if (url.pathname === '/rest/v1/telegram_outbox') {
        outbox.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response('', { status: 201 });
      }

      if (url.pathname === '/rest/v1/radar_drafts') {
        const hits = world.drafts.filter((d) => matches(d, url.searchParams));
        if (method === 'GET') return json(hits);
        if (method === 'POST') {
          const row = draftRecord({
            ...(JSON.parse(String(init?.body)) as Partial<DraftRecord>),
            id: `new-${world.drafts.length}`,
            telegram_message_id: null,
          });
          world.drafts.push(row);
          return json([row]);
        }
        if (method === 'PATCH') {
          const patch = JSON.parse(String(init?.body)) as Partial<DraftRecord>;
          for (const row of hits) Object.assign(row, patch);
          return json(hits);
        }
      }
      throw new Error(`unexpected fetch: ${method} ${raw}`);
    },
  );

  return { telegram, reddit, outbox };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

const tap = (action: 'post' | 'skip', id: string, messageId = 500): TelegramUpdate => ({
  callback_query: { id: 'cb-1', data: `${action}:${id}`, message: { message_id: messageId } },
});

/** The text of the last editMessageText, which is what the founder ends up
 *  looking at on his phone. */
function lastEdit(telegram: { method: string; body: Record<string, unknown> }[]): string {
  const edits = telegram.filter((t) => t.method === 'editMessageText');
  return String(edits[edits.length - 1]?.body.text ?? '');
}

// ---------------------------------------------------------------------------

describe('parseRedditThread finds the thread a comment would hang from', () => {
  it('reads the subreddit and the t3_ fullname out of a thread URL', () => {
    expect(parseRedditThread(THREAD_URL)).toEqual({ subreddit: 'sales', thingId: 't3_abc123' });
  });

  it('accepts the old and np hosts the radar also sees', () => {
    expect(parseRedditThread('https://old.reddit.com/r/startups/comments/x1y2/t/')).toEqual({
      subreddit: 'startups',
      thingId: 't3_x1y2',
    });
  });

  it('returns null for anything that is not a Reddit thread', () => {
    // A Hacker News item, a subreddit front page, and a lookalike domain. None
    // of the three can be commented on by thing_id, so none may get a button.
    expect(parseRedditThread('https://news.ycombinator.com/item?id=1')).toBeNull();
    expect(parseRedditThread('https://www.reddit.com/r/sales/')).toBeNull();
    expect(parseRedditThread('https://notreddit.com/r/sales/comments/abc123/t/')).toBeNull();
  });
});

describe('the webhook refuses everything that is not Telegram with the secret', () => {
  const body = JSON.stringify(tap('post', 'any-id'));
  const req = (headers: Record<string, string>, url = 'https://w.test/telegram/webhook') =>
    new Request(url, { method: 'POST', body, headers });

  it('404s a request with no secret header at all', async () => {
    const res = await handleWebhookRequest(req({}), env);
    expect(res.status).toBe(404);
  });

  it('404s a request carrying the wrong secret', async () => {
    const res = await handleWebhookRequest(req({ 'X-Telegram-Bot-Api-Secret-Token': 'nope' }), env);
    expect(res.status).toBe(404);
  });

  it('404s every request when the secret is not configured, rather than opening up', async () => {
    const noSecret = { ...env, TELEGRAM_WEBHOOK_SECRET: undefined } as Env;
    const res = await handleWebhookRequest(
      req({ 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' }),
      noSecret,
    );
    expect(res.status).toBe(404);
  });

  it('404s the right secret on the wrong path or the wrong method', async () => {
    const h = { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' };
    expect((await handleWebhookRequest(req(h, 'https://w.test/'), env)).status).toBe(404);
    expect(
      (
        await handleWebhookRequest(
          new Request('https://w.test/telegram/webhook', { headers: h }),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it('accepts a correctly signed delivery and answers 200', async () => {
    const world: World = { drafts: [draftRecord()] };
    stub(world);
    const res = await handleWebhookRequest(
      new Request('https://w.test/telegram/webhook', {
        method: 'POST',
        body: JSON.stringify(tap('skip', draftRecord().id)),
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(world.drafts[0]!.status).toBe('skipped');
  });
});

describe('Post as me posts that exact text and reports back the permalink', () => {
  it('posts the draft body, records the permalink, and rewrites the message', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit, outbox } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    // Reddit was called with the thread's fullname and the draft body — never
    // the "DRAFT (personal account…)" label, which is Telegram framing only.
    const comment = reddit.find((r) => r.url.includes('/api/comment'));
    expect(comment).toBeDefined();
    const sent = new URLSearchParams(comment!.body);
    expect(sent.get('thing_id')).toBe('t3_abc123');
    expect(sent.get('text')).toBe('You can send it as a link.');
    expect(sent.get('text')).not.toContain('DRAFT (personal account');
    expect(comment!.userAgent).toBe('htmlradar-radar/1.0 by founder');

    // The row carries the outcome, and the message on his phone shows it.
    expect(world.drafts[0]).toMatchObject({
      status: 'posted',
      permalink: `https://www.reddit.com${PERMALINK}`,
    });
    expect(lastEdit(telegram)).toContain(`Posted: https://www.reddit.com${PERMALINK}`);
    expect(telegram.some((t) => t.method === 'answerCallbackQuery')).toBe(true);

    // The comment is written down in the outbox, and no secret is in the row.
    expect(outbox[0]).toMatchObject({ kind: 'radar', source: 'onetap-post' });
    const written = JSON.stringify(outbox);
    expect(written).not.toContain('refresh-token-that-must-never-appear-anywhere');
    expect(written).not.toContain('client-secret-that-must-never-appear-anywhere');
    expect(written).not.toContain('bot-token-that-must-never-appear-anywhere');
  });

  it('surfaces a Reddit refusal in plain words and leaves the buttons alive', async () => {
    const world: World = {
      drafts: [draftRecord()],
      comment: {
        status: 200,
        body: JSON.stringify({
          json: { errors: [['RATELIMIT', 'you are doing that too much, try again in 8 minutes']] },
        }),
      },
    };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(lastEdit(telegram)).toContain('you are doing that too much');
    // Failed, not posted — and the claim is released so the thread is free.
    expect(world.drafts[0]).toMatchObject({ status: 'failed', posted_at: null });
    const edit = telegram.filter((t) => t.method === 'editMessageText').pop()!;
    expect(JSON.stringify(edit.body.reply_markup)).toContain('Post as me');
  });

  it('says plainly when the saved Reddit login has been revoked', async () => {
    const world: World = {
      drafts: [draftRecord()],
      token: { status: 400, body: '{"error":"invalid_grant"}' },
    };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(lastEdit(telegram)).toContain('reddit_auth.py');
    expect(world.drafts[0]!.status).toBe('failed');
  });
});

describe('Skip closes the draft without speaking', () => {
  it('marks it skipped, removes the buttons, and never calls Reddit', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('skip', draftRecord().id), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('skipped');
    expect(lastEdit(telegram)).toContain('Skipped.');
    const edit = telegram.filter((t) => t.method === 'editMessageText').pop()!;
    expect(edit.body.reply_markup).toEqual({ inline_keyboard: [] });
  });
});

describe('an edit is a new draft awaiting its own tap, never a post', () => {
  it('replaces the text and offers it again with buttons, posting nothing', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(
      env,
      {
        message: {
          message_id: 501,
          text: 'My own wording.',
          reply_to_message: { message_id: 500 },
        },
      },
      NOW,
    );

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]).toMatchObject({ status: 'edited', draft_text: 'My own wording.' });
    // The replacement arrives as its own message, with its own buttons, and
    // becomes the draft's live message so a further reply chains onto it.
    const sends = telegram.filter((t) => t.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toContain('My own wording.');
    expect(JSON.stringify(sends[0]!.body.reply_markup)).toContain('Post as me');
    expect(world.drafts[0]!.telegram_message_id).toBe(901);
    // The old message loses its buttons so there is one live offer, not two.
    const edit = telegram.filter((t) => t.method === 'editMessageText').pop()!;
    expect(edit.body.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it('posts the edited wording, and only after the tap on it', async () => {
    const world: World = { drafts: [draftRecord()] };
    stub(world);

    await handleTelegramUpdate(
      env,
      {
        message: {
          message_id: 501,
          text: 'My own wording.',
          reply_to_message: { message_id: 500 },
        },
      },
      NOW,
    );
    vi.restoreAllMocks();
    const { reddit } = stub(world);
    await handleTelegramUpdate(env, tap('post', draftRecord().id, 901), NOW);

    const comment = reddit.find((r) => r.url.includes('/api/comment'))!;
    expect(new URLSearchParams(comment.body).get('text')).toBe('My own wording.');
  });

  it('ignores a reply to any message that is not a draft', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(
      env,
      { message: { message_id: 9, text: 'ok', reply_to_message: { message_id: 4242 } } },
      NOW,
    );

    expect(reddit).toHaveLength(0);
    expect(telegram).toHaveLength(0);
  });
});

describe('nothing is ever said twice', () => {
  it('a second tap on a posted draft re-shows the permalink and posts nothing', async () => {
    const world: World = {
      drafts: [
        draftRecord({
          status: 'posted',
          permalink: `https://www.reddit.com${PERMALINK}`,
          posted_at: '2026-09-03T05:30:00.000Z',
        }),
      ],
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(reddit).toHaveLength(0);
    expect(lastEdit(telegram)).toContain(`Posted: https://www.reddit.com${PERMALINK}`);
  });

  it('refuses a thread another draft already answered', async () => {
    const world: World = {
      drafts: [
        draftRecord(),
        draftRecord({
          id: 'other-draft',
          status: 'posted',
          permalink: `https://www.reddit.com${PERMALINK}`,
          posted_at: '2026-09-03T05:30:00.000Z',
          telegram_message_id: 400,
        }),
      ],
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(reddit).toHaveLength(0);
    expect(lastEdit(telegram)).toContain('already commented on this thread');
    expect(world.drafts[0]!.status).toBe('pending');
  });

  it('the claim is a compare-and-swap, so a redelivered tap posts once', async () => {
    // Telegram redelivers a webhook it believes failed. Both deliveries read a
    // pending row; only the one that wins the conditional update calls Reddit.
    const world: World = { drafts: [draftRecord()] };
    const { reddit } = stub(world);

    await Promise.all([
      handleTelegramUpdate(env, tap('post', draftRecord().id), NOW),
      handleTelegramUpdate(env, tap('post', draftRecord().id), NOW),
    ]);

    expect(reddit.filter((r) => r.url.includes('/api/comment'))).toHaveLength(1);
  });
});

describe('the daily cap is five comments in twenty-four hours', () => {
  const posted = (n: number, hoursAgo: number) =>
    draftRecord({
      id: `posted-${n}`,
      thing_id: `t3_old${n}`,
      status: 'posted',
      permalink: 'https://www.reddit.com/x',
      posted_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
    });

  it('refuses the sixth and says so in the message', async () => {
    const world: World = {
      drafts: [draftRecord(), ...[1, 2, 3, 4, 5].map((n) => posted(n, n))],
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(reddit).toHaveLength(0);
    expect(lastEdit(telegram)).toContain('more than 5 comments in 24 hours');
    expect(world.drafts[0]!.status).toBe('pending');
  });

  it('lets the sixth through once one of the five has aged out of the window', async () => {
    const world: World = {
      drafts: [draftRecord(), ...[1, 2, 3, 4].map((n) => posted(n, n)), posted(5, 25)],
    };
    const { reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post', draftRecord().id), NOW);

    expect(reddit.filter((r) => r.url.includes('/api/comment'))).toHaveLength(1);
    expect(world.drafts[0]!.status).toBe('posted');
  });
});
