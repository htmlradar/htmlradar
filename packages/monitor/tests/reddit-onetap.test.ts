import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DRAFT_ANSWER_SLOT,
  type Env,
  type TelegramUpdate,
  handleTelegramUpdate,
  handleWebhookRequest,
  parseRedditThread,
} from '../src/index.js';

// One-tap posting. The rule these tests hold is the SOP's, not a UX preference:
// nothing reaches Reddit unless the founder tapped a live button in his own
// chat, and a tap reaches Reddit at most once. After Sol's review of 3 Sep the
// adversarial half matters more than the happy path — a webhook secret proves
// somebody holds a value, not that a human tapped — so most of what follows is
// about taps that must NOT post. Every test stubs Supabase, Telegram and
// Reddit; none touches the network.

const FOUNDER_ID = 771122;
const CHAT_ID = '106874';

const env = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  RESEND_FROM: 'HTMLRadar <hello@htmlradar.com>',
  ALERT_TO: 'hello@htmlradar.com',
  POSTHOG_HOST: 'https://posthog.test',
  TELEGRAM_BOT_TOKEN: 'bot-token-that-must-never-appear-anywhere',
  TELEGRAM_CHAT_ID: CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_FOUNDER_USER_ID: String(FOUNDER_ID),
  REDDIT_CLIENT_ID: 'client-id',
  REDDIT_CLIENT_SECRET: 'client-secret-that-must-never-appear-anywhere',
  REDDIT_REFRESH_TOKEN: 'refresh-token-that-must-never-appear-anywhere',
  REDDIT_USERNAME: 'founder',
} as Env;

const NOW = Date.parse('2026-09-03T06:00:00.000Z');
const THREAD_URL = 'https://www.reddit.com/r/sales/comments/abc123/how_do_i_share_a_deck/';
const PERMALINK = '/r/sales/comments/abc123/how_do_i_share_a_deck/def456/';
const NONCE = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const MSG = 500;

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// A stand-in for the three systems the handler talks to, faithful on the two
// things that carry the safety guarantees: PostgREST applies the filters as
// part of the UPDATE, and reserve_radar_post is one atomic decision.

interface DraftRecord {
  id: string;
  source_url: string;
  thing_id: string;
  subreddit: string | null;
  draft_text: string;
  version: number;
  status: string;
  nonce: string | null;
  nonce_used_at: string | null;
  expires_at: string;
  permalink: string | null;
  posted_at: string | null;
  posted_version: number | null;
  error: string | null;
  telegram_message_id: number | null;
  created_at: string;
  meta: unknown;
}

function draftRecord(over: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    source_url: THREAD_URL,
    thing_id: 't3_abc123',
    subreddit: 'sales',
    draft_text: 'DRAFT (personal account, edit before posting): You can send it as a link.',
    version: 1,
    status: 'pending',
    nonce: NONCE,
    nonce_used_at: null,
    expires_at: new Date(NOW + 72 * 3_600_000).toISOString(),
    permalink: null,
    posted_at: null,
    posted_version: null,
    error: null,
    telegram_message_id: MSG,
    created_at: '2026-09-03T05:00:00.000Z',
    meta: null,
    ...over,
  };
}

/** PostgREST's filter grammar, only the operators this code uses. */
function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const cell = row[key];
    const got = cell === null || cell === undefined ? null : String(cell);
    if (value === 'is.null') {
      if (got !== null) return false;
    } else if (value.startsWith('eq.')) {
      if (got !== value.slice(3)) return false;
    } else if (value.startsWith('gte.')) {
      if (got === null || !(got >= value.slice(4))) return false;
    } else if (value.startsWith('gt.')) {
      if (got === null || !(got > value.slice(3))) return false;
    } else if (value.startsWith('not.in.')) {
      if (got !== null && listOf(value.slice(7)).includes(got)) return false;
    } else if (value.startsWith('in.')) {
      if (got === null || !listOf(value.slice(3)).includes(got)) return false;
    }
  }
  return true;
}

const listOf = (v: string) => v.replace(/^\(|\)$/g, '').split(',');

interface World {
  drafts: DraftRecord[];
  reservations?: { thing_id: string; draft_id: string; created_at: string }[];
  /** POST /api/comment. Default: accepted with a permalink. */
  comment?: { status: number; body: string } | 'throw';
  /** The token exchange. Default: a token. */
  token?: { status: number; body: string };
  /** GET /api/v1/me. Default: the configured username, plenty of quota. */
  me?: { status: number; body: string; headers?: Record<string, string> };
  /** GET /user/<name>/comments, for reconciliation. Default: nothing there. */
  userComments?: { status: number; body: string };
}

function stub(world: World) {
  const telegram: { method: string; body: Record<string, unknown> }[] = [];
  const reddit: { url: string; body: string; userAgent: string | null }[] = [];
  const outbox: Record<string, unknown>[] = [];
  world.reservations ??= [];
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
        const id =
          m === 'sendMessage' ? ++nextMessageId : Number(telegram.at(-1)?.body.message_id ?? 0);
        return json({ ok: true, result: { message_id: id } });
      }

      if (url.hostname.endsWith('reddit.com')) {
        const headers = new Headers(init?.headers);
        reddit.push({
          url: raw,
          body: String(init?.body ?? ''),
          userAgent: headers.get('User-Agent'),
        });
        if (url.pathname === '/api/v1/access_token') {
          const t = world.token ?? { status: 200, body: JSON.stringify({ access_token: 'at-1' }) };
          return new Response(t.body, { status: t.status });
        }
        if (url.pathname === '/api/v1/me') {
          const m = world.me ?? { status: 200, body: JSON.stringify({ name: 'founder' }) };
          return new Response(m.body, {
            status: m.status,
            headers: { 'x-ratelimit-remaining': '600', 'x-ratelimit-reset': '400', ...m.headers },
          });
        }
        if (url.pathname.endsWith('/comments') && url.pathname.startsWith('/user/')) {
          const c = world.userComments ?? {
            status: 200,
            body: JSON.stringify({ data: { children: [] } }),
          };
          return new Response(c.body, { status: c.status });
        }
        if (world.comment === 'throw') throw new Error('socket hang up');
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

      if (url.pathname === '/rest/v1/rpc/reserve_radar_post') {
        // One atomic decision, exactly as schema/046's function makes it.
        const { p_draft_id, p_thing_id } = JSON.parse(String(init?.body)) as Record<string, string>;
        const owner = world.reservations!.find((r) => r.thing_id === p_thing_id);
        if (owner) return json(owner.draft_id === p_draft_id ? 'ok' : 'thread_taken');
        const since = new Date(NOW - 24 * 3_600_000).toISOString();
        if (world.reservations!.filter((r) => r.created_at > since).length >= 5)
          return json('cap_reached');
        world.reservations!.push({
          thing_id: p_thing_id,
          draft_id: p_draft_id,
          created_at: new Date(NOW).toISOString(),
        });
        return json('ok');
      }

      if (url.pathname === '/rest/v1/radar_post_reservations') {
        return json(world.reservations!.filter((r) => matches(r, url.searchParams)));
      }

      if (url.pathname === '/rest/v1/radar_drafts') {
        const hits = world.drafts.filter((d) =>
          matches(d as unknown as Record<string, unknown>, url.searchParams),
        );
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
          for (const row of hits) {
            // The terminal-state trigger from schema/046, refusing to reopen.
            if (
              ['posted', 'skipped'].includes(row.status) &&
              patch.status !== undefined &&
              patch.status !== row.status
            )
              return new Response('{"code":"23514"}', { status: 400 });
            Object.assign(row, patch);
          }
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

interface TapOpts {
  nonce?: string;
  version?: number;
  messageId?: number;
  userId?: number;
  chatId?: string | number;
}
const tap = (action: 'post' | 'skip', o: TapOpts = {}): TelegramUpdate => ({
  callback_query: {
    id: 'cb-1',
    data: `${action}:${o.nonce ?? NONCE}:${o.version ?? 1}`,
    from: { id: o.userId ?? FOUNDER_ID },
    message: { message_id: o.messageId ?? MSG, chat: { id: o.chatId ?? CHAT_ID } },
  },
});

const reply = (text: string, parent = MSG, o: TapOpts = {}): TelegramUpdate => ({
  message: {
    message_id: 9001,
    text,
    from: { id: o.userId ?? FOUNDER_ID },
    chat: { id: o.chatId ?? CHAT_ID },
    reply_to_message: { message_id: parent },
  },
});

type TgCall = { method: string; body: Record<string, unknown> };
const lastEdit = (t: TgCall[]) =>
  String(t.filter((x) => x.method === 'editMessageText').at(-1)?.body.text ?? '');
const toast = (t: TgCall[]) =>
  String(t.filter((x) => x.method === 'answerCallbackQuery').at(-1)?.body.text ?? '');
const comments = (r: { url: string }[]) => r.filter((x) => x.url.includes('/api/comment'));

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
    expect(parseRedditThread('https://news.ycombinator.com/item?id=1')).toBeNull();
    expect(parseRedditThread('https://www.reddit.com/r/sales/')).toBeNull();
    expect(parseRedditThread('https://notreddit.com/r/sales/comments/abc123/t/')).toBeNull();
  });

  it('refuses a malformed path rather than inventing a parent id from part of it', () => {
    // Sol's finding: an unbounded pattern accepted these and produced a
    // thing_id belonging to some other thread — a comment on a stranger's post.
    expect(parseRedditThread('https://www.reddit.com/r/sales/comments/abc123extra_id')).toBeNull();
    expect(parseRedditThread('https://www.reddit.com/r/sales/comments/ab')).toBeNull();
  });
});

describe('the webhook refuses everything that is not Telegram with the secret', () => {
  const body = JSON.stringify(tap('post'));
  const req = (headers: Record<string, string>, url = 'https://w.test/telegram/webhook') =>
    new Request(url, { method: 'POST', body, headers });
  const good = { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret' };

  it('404s a request with no secret header at all', async () => {
    expect((await handleWebhookRequest(req({}), env)).status).toBe(404);
  });

  it('404s a request carrying the wrong secret', async () => {
    expect(
      (await handleWebhookRequest(req({ 'X-Telegram-Bot-Api-Secret-Token': 'nope' }), env)).status,
    ).toBe(404);
  });

  it('404s every request when the secret is not configured, rather than opening up', async () => {
    const noSecret = { ...env, TELEGRAM_WEBHOOK_SECRET: undefined } as Env;
    expect((await handleWebhookRequest(req(good), noSecret)).status).toBe(404);
  });

  it('404s the right secret on the wrong path or the wrong method', async () => {
    expect((await handleWebhookRequest(req(good, 'https://w.test/'), env)).status).toBe(404);
    expect(
      (
        await handleWebhookRequest(
          new Request('https://w.test/telegram/webhook', { headers: good }),
          env,
        )
      ).status,
    ).toBe(404);
  });

  it('400s malformed JSON', async () => {
    const res = await handleWebhookRequest(
      new Request('https://w.test/telegram/webhook', {
        method: 'POST',
        body: '{not json',
        headers: good,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('413s an oversized payload without parsing it', async () => {
    // The address is public (workers.dev), so the body is capped before JSON.parse.
    const res = await handleWebhookRequest(
      new Request('https://w.test/telegram/webhook', {
        method: 'POST',
        body: JSON.stringify({ pad: 'x'.repeat(40_000) }),
        headers: good,
      }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('accepts a correctly signed delivery and answers 200', async () => {
    const world: World = { drafts: [draftRecord()] };
    stub(world);
    const res = await handleWebhookRequest(
      new Request('https://w.test/telegram/webhook', {
        method: 'POST',
        body: JSON.stringify(tap('skip')),
        headers: good,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(world.drafts[0]!.status).toBe('skipped');
  });
});

describe('the secret is not proof of a tap: only the founder, in his chat', () => {
  it('drops a perfectly formed callback from another Telegram user, in silence', async () => {
    // This is the forged-body case. The caller holds the webhook secret and
    // sends a valid-looking callback; only from.id separates it from a real tap.
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleTelegramUpdate(env, tap('post', { userId: 999 }), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('pending');
    // Not even an answerCallbackQuery: replying confirms the endpoint is real.
    expect(telegram).toHaveLength(0);
  });

  it('drops a callback delivered from a different chat', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleTelegramUpdate(env, tap('post', { chatId: '-100999' }), NOW);

    expect(reddit).toHaveLength(0);
    expect(telegram).toHaveLength(0);
  });

  it('drops an edit reply that did not come from the founder', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram } = stub(world);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleTelegramUpdate(env, reply('post this instead', MSG, { userId: 999 }), NOW);

    expect(world.drafts[0]!.draft_text).toContain('You can send it as a link.');
    expect(telegram).toHaveLength(0);
  });
});

describe('an approval is bound to one message, one version, one token, one window', () => {
  const cases: [string, TapOpts, string][] = [
    ['a tap from a message that is no longer the live one', { messageId: 499 }, 'replaced'],
    ['a tap carrying an older version of the text', { version: 0 }, 'older version'],
    ['a tap carrying a token nothing knows', { nonce: 'f'.repeat(32) }, 'no longer valid'],
  ];
  for (const [name, opts, says] of cases) {
    it(`refuses ${name}, and says why`, async () => {
      const world: World = { drafts: [draftRecord()] };
      const { telegram, reddit } = stub(world);

      await handleTelegramUpdate(env, tap('post', opts), NOW);

      expect(reddit).toHaveLength(0);
      expect(world.drafts[0]!.status).toBe('pending');
      expect(toast(telegram).toLowerCase()).toContain(says);
    });
  }

  it('refuses a token that has already been spent', async () => {
    const world: World = { drafts: [draftRecord({ nonce_used_at: '2026-09-03T05:59:00.000Z' })] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(reddit).toHaveLength(0);
    expect(toast(telegram).toLowerCase()).toContain('already been used');
  });

  it('refuses a draft whose 72 hours have run out', async () => {
    const world: World = { drafts: [draftRecord({ expires_at: '2026-09-01T00:00:00.000Z' })] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('pending');
    expect(toast(telegram).toLowerCase()).toContain('expired');
  });

  it('posts once when the same tap is delivered twice', async () => {
    // Telegram redelivers a webhook it believes failed. The nonce is spent by
    // the first delivery's conditional update; the second finds nothing to do.
    const world: World = { drafts: [draftRecord()] };
    const { reddit } = stub(world);

    await Promise.all([
      handleTelegramUpdate(env, tap('post'), NOW),
      handleTelegramUpdate(env, tap('post'), NOW),
    ]);

    expect(comments(reddit)).toHaveLength(1);
  });
});

describe('Post as me posts that exact text and reports back the permalink', () => {
  it('posts the draft body, records the permalink, and rewrites the message', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit, outbox } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    const comment = comments(reddit)[0]!;
    const sent = new URLSearchParams(comment.body);
    expect(sent.get('thing_id')).toBe('t3_abc123');
    expect(sent.get('text')).toBe('You can send it as a link.');
    expect(sent.get('text')).not.toContain('DRAFT (personal account');
    // Reddit's published User-Agent format: platform, app, version, human.
    expect(comment.userAgent).toBe('web:htmlradar-radar:1.0 (by /u/founder)');

    expect(world.drafts[0]).toMatchObject({
      status: 'posted',
      permalink: `https://www.reddit.com${PERMALINK}`,
      posted_version: 1,
    });
    // The reservation was taken, and it is what the cap counts.
    expect(world.reservations).toHaveLength(1);
    expect(lastEdit(telegram)).toContain(`Posted: https://www.reddit.com${PERMALINK}`);

    const written = JSON.stringify(outbox);
    expect(outbox[0]).toMatchObject({ kind: 'radar', source: 'onetap-post' });
    expect(written).not.toContain('refresh-token-that-must-never-appear-anywhere');
    expect(written).not.toContain('client-secret-that-must-never-appear-anywhere');
    expect(written).not.toContain('bot-token-that-must-never-appear-anywhere');
  });

  it('checks which Reddit account the saved login is for, and refuses a mismatch', async () => {
    const world: World = {
      drafts: [draftRecord()],
      me: { status: 200, body: JSON.stringify({ name: 'somebody_else' }) },
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('failed');
    expect(lastEdit(telegram)).toContain('different account');
  });

  it('backs off when Reddit says the quota is nearly gone', async () => {
    const world: World = {
      drafts: [draftRecord()],
      me: {
        status: 200,
        body: JSON.stringify({ name: 'founder' }),
        headers: { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '90' },
      },
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(0);
    expect(lastEdit(telegram)).toContain('90 seconds');
  });
});

describe("Reddit's own words never reach a row or a message", () => {
  it('maps a known error code to our sentence and quotes nothing upstream', async () => {
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

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(lastEdit(telegram)).toContain('rate-limiting the account');
    expect(lastEdit(telegram)).not.toContain('you are doing that too much');
    expect(String(world.drafts[0]!.error)).not.toContain('you are doing that too much');
    expect(world.drafts[0]!.status).toBe('failed');
  });

  it('never echoes an HTTP error body, however inviting it looks', async () => {
    const world: World = {
      drafts: [draftRecord()],
      comment: { status: 400, body: '{"secretish":"Authorization: Bearer at-1"}' },
    };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(lastEdit(telegram)).not.toContain('Bearer');
    expect(JSON.stringify(world.drafts[0])).not.toContain('Bearer');
    expect(lastEdit(telegram)).toContain('HTTP 400');
  });

  it('reports an unknown error code as a code, not as text', async () => {
    const world: World = {
      drafts: [draftRecord()],
      comment: {
        status: 200,
        body: JSON.stringify({ json: { errors: [['SOME_NEW_CODE', 'free text from upstream']] } }),
      },
    };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(lastEdit(telegram)).toContain('SOME_NEW_CODE');
    expect(lastEdit(telegram)).not.toContain('free text from upstream');
  });
});

describe('an outcome nobody can be sure of blocks everything until it is checked', () => {
  const hangUp: World = { drafts: [draftRecord()], comment: 'throw' };

  it('goes to reconcile, keeps the reservation, and does not claim success', async () => {
    const world: World = { ...hangUp, drafts: [draftRecord()], reservations: [] };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(world.drafts[0]!.status).toBe('reconcile');
    expect(world.drafts[0]!.permalink).toBeNull();
    // The reservation stays: the thread may already carry our comment.
    expect(world.reservations).toHaveLength(1);
    expect(toast(telegram)).toContain('unknown');
  });

  it('a redelivered tap during reconcile sends nothing a second time', async () => {
    const world: World = { ...hangUp, drafts: [draftRecord()], reservations: [] };
    const { reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);
    // The token is spent and the status is no longer pending; a redelivery of
    // the very same callback must not reach Reddit again.
    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(1);
  });

  it('resolves to posted when the account turns out to carry the comment', async () => {
    const world: World = {
      drafts: [draftRecord()],
      comment: 'throw',
      userComments: {
        status: 200,
        body: JSON.stringify({
          data: { children: [{ data: { link_id: 't3_abc123', permalink: PERMALINK } }] },
        }),
      },
    };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(world.drafts[0]).toMatchObject({
      status: 'posted',
      permalink: `https://www.reddit.com${PERMALINK}`,
    });
    expect(lastEdit(telegram)).toContain('Posted:');
  });

  it('re-checks before re-sending when the new button is tapped', async () => {
    const world: World = {
      drafts: [
        draftRecord({
          status: 'reconcile',
          nonce: 'c'.repeat(32),
          nonce_used_at: null,
          version: 2,
          telegram_message_id: 777,
        }),
      ],
      reservations: [
        {
          thing_id: 't3_abc123',
          draft_id: draftRecord().id,
          created_at: new Date(NOW).toISOString(),
        },
      ],
      userComments: {
        status: 200,
        body: JSON.stringify({
          data: { children: [{ data: { link_id: 't3_abc123', permalink: PERMALINK } }] },
        }),
      },
    };
    const { reddit } = stub(world);

    await handleTelegramUpdate(
      env,
      tap('post', { nonce: 'c'.repeat(32), version: 2, messageId: 777 }),
      NOW,
    );

    // It found the earlier comment, so it posted nothing new.
    expect(comments(reddit)).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('posted');
  });
});

describe('Skip closes the draft without speaking, and closes it for good', () => {
  it('marks it skipped, removes the buttons, and never calls Reddit', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('skip'), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('skipped');
    expect(lastEdit(telegram)).toContain('Skipped.');
  });

  it('a post tap arriving after a Skip cannot reopen it', async () => {
    // Sol's race: Skip used to rewrite status unconditionally. Now Skip spends
    // the token, so the post tap has nothing left to consume.
    const world: World = { drafts: [draftRecord()] };
    const { reddit, telegram } = stub(world);

    await handleTelegramUpdate(env, tap('skip'), NOW);
    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('skipped');
    expect(toast(telegram).toLowerCase()).toContain('skipped');
  });

  it('a skip tap arriving after a post cannot unclaim it', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);
    await handleTelegramUpdate(env, tap('skip'), NOW);

    expect(world.drafts[0]!.status).toBe('posted');
    expect(toast(telegram).toLowerCase()).toContain('already posted');
  });
});

describe('an edit is a new version awaiting its own tap, never a post', () => {
  it('replaces the text, bumps the version, mints a new token, posts nothing', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, reply('My own wording.'), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]).toMatchObject({
      status: 'edited',
      draft_text: 'My own wording.',
      version: 2,
      nonce_used_at: null,
    });
    expect(world.drafts[0]!.nonce).not.toBe(NONCE);
    const sends = telegram.filter((t) => t.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.body.text)).toContain('My own wording.');
    expect(JSON.stringify(sends[0]!.body.reply_markup)).toContain('Post as me');
    expect(world.drafts[0]!.telegram_message_id).toBe(901);
  });

  it('the button on the message before the edit is inert', async () => {
    // The old keyboard may survive: editMessageText is fire and forget. What
    // makes it safe is the token, not the redraw.
    const world: World = { drafts: [draftRecord()] };
    const { reddit, telegram } = stub(world);

    await handleTelegramUpdate(env, reply('My own wording.'), NOW);
    await handleTelegramUpdate(env, tap('post', { nonce: NONCE, version: 1, messageId: MSG }), NOW);

    expect(reddit).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('edited');
    expect(toast(telegram).toLowerCase()).toContain('no longer valid');
  });

  it('posts the edited wording, and only after the tap on it', async () => {
    const world: World = { drafts: [draftRecord()] };
    stub(world);
    await handleTelegramUpdate(env, reply('My own wording.'), NOW);
    const fresh = world.drafts[0]!;
    vi.restoreAllMocks();

    const { reddit } = stub(world);
    await handleTelegramUpdate(
      env,
      tap('post', {
        nonce: fresh.nonce!,
        version: fresh.version,
        messageId: fresh.telegram_message_id!,
      }),
      NOW,
    );

    expect(new URLSearchParams(comments(reddit)[0]!.body).get('text')).toBe('My own wording.');
  });

  it('ignores a reply to any message that is not a draft', async () => {
    const world: World = { drafts: [draftRecord()] };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, reply('ok', 4242), NOW);

    expect(reddit).toHaveLength(0);
    expect(telegram).toHaveLength(0);
  });
});

describe('the daily cap is five reservations in twenty-four hours', () => {
  const reservation = (n: number, hoursAgo: number) => ({
    thing_id: `t3_old${n}`,
    draft_id: `posted-${n}`,
    created_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  });

  it('refuses the sixth before the tap is even spent, so the button survives', async () => {
    const world: World = {
      drafts: [draftRecord()],
      reservations: [1, 2, 3, 4, 5].map((n) => reservation(n, n)),
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(reddit).toHaveLength(0);
    expect(toast(telegram)).toContain('more than 5 in 24 hours');
    // Not consumed: the same button works tomorrow.
    expect(world.drafts[0]).toMatchObject({ status: 'pending', nonce_used_at: null });
  });

  it('lets the sixth through once one has aged out of the window', async () => {
    const world: World = {
      drafts: [draftRecord()],
      reservations: [...[1, 2, 3, 4].map((n) => reservation(n, n)), reservation(5, 25)],
    };
    const { reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(1);
    expect(world.drafts[0]!.status).toBe('posted');
  });

  it('refuses a thread another draft already reserved', async () => {
    const world: World = {
      drafts: [draftRecord()],
      reservations: [
        {
          thing_id: 't3_abc123',
          draft_id: 'some-other-draft',
          created_at: new Date(NOW).toISOString(),
        },
      ],
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(0);
    expect(world.drafts[0]!.status).toBe('failed');
    expect(lastEdit(telegram)).toContain('already replied on that thread');
  });
});

describe('an unedited draft is never posted', () => {
  it('refuses while the placeholder line is still there, and takes no reservation', async () => {
    const world: World = {
      drafts: [
        draftRecord({
          draft_text:
            `DRAFT (personal account, edit before posting): ${DRAFT_ANSWER_SLOT}\n\n` +
            'You can send it as a link.',
        }),
      ],
    };
    const { telegram, reddit } = stub(world);

    await handleTelegramUpdate(env, tap('post'), NOW);

    expect(comments(reddit)).toHaveLength(0);
    // The reservation is never released, so it must never be taken for a draft
    // that was never going to be sent.
    expect(world.reservations ?? []).toHaveLength(0);
    expect(world.drafts[0]).toMatchObject({ status: 'failed' });
    expect(lastEdit(telegram)).toContain('placeholder first line');
  });
});
