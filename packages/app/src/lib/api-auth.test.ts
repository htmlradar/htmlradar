import { beforeEach, describe, it, expect, vi } from 'vitest';

// api-auth reaches for the error log when the rate limiter's database call
// fails. Stubbed because error-log.ts imports Next's `server-only`, a module
// that resolves inside the Next build and nowhere else.
vi.mock('./error-log', () => ({ logServerError: vi.fn() }));

// The Supabase client authenticateApiKey builds for itself. Each test that
// needs one puts it here; nothing else in this file touches the network.
const supabase = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabase.current }));

import {
  apiKeyPrefix,
  API_KEY_PREFIX,
  authenticateApiKey,
  BODY_TIMED_OUT,
  creationMax,
  READ_ONLY_KEY,
  readBefore,
  FREE_LIMIT_REACHED,
  generateApiKey,
  hashApiKey,
  errorResponse,
  mapCreateShareError,
  parseBearerKey,
  rateLimited,
  readBodyCapped,
  REQUEST_TIMEOUT,
  tooLarge,
  URL_MODE_DISABLED,
  validationError,
} from './api-auth';
import { logServerError } from './error-log';

beforeEach(() => {
  vi.mocked(logServerError).mockReset();
});

const VALID = `${API_KEY_PREFIX}${'a1b2c3d4'.repeat(5)}`; // 40 hex characters

describe('parsing the bearer header', () => {
  it('accepts a well-formed key', () => {
    expect(parseBearerKey(`Bearer ${VALID}`)).toBe(VALID);
  });

  it('tolerates surrounding whitespace and extra spaces after Bearer', () => {
    expect(parseBearerKey(`  Bearer   ${VALID}  `)).toBe(VALID);
  });

  it('rejects a missing or empty header', () => {
    expect(parseBearerKey(null)).toBeNull();
    expect(parseBearerKey(undefined)).toBeNull();
    expect(parseBearerKey('')).toBeNull();
  });

  it('rejects anything that is not a Bearer scheme', () => {
    expect(parseBearerKey(VALID)).toBeNull();
    expect(parseBearerKey(`Basic ${VALID}`)).toBeNull();
    expect(parseBearerKey(`bearer ${VALID}`)).toBeNull();
  });

  it('rejects keys that are the wrong shape', () => {
    expect(parseBearerKey('Bearer hr_test_' + 'a'.repeat(40))).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'a'.repeat(39)}`)).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'a'.repeat(41)}`)).toBeNull();
    // Uppercase hex is not what we issue, so it is not what we accept.
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'A1B2C3D4'.repeat(5)}`)).toBeNull();
    expect(parseBearerKey(`Bearer ${API_KEY_PREFIX}${'z'.repeat(40)}`)).toBeNull();
  });

  it('rejects a key with anything appended', () => {
    expect(parseBearerKey(`Bearer ${VALID} extra`)).toBeNull();
    expect(parseBearerKey(`Bearer ${VALID}'--`)).toBeNull();
  });
});

describe('hashing', () => {
  it('is SHA-256 in lowercase hex', async () => {
    // Standard vector, so a change of algorithm cannot pass unnoticed.
    expect(await hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the whole key including its prefix', async () => {
    expect(await hashApiKey(VALID)).not.toBe(await hashApiKey(VALID.slice(API_KEY_PREFIX.length)));
  });

  it('is stable and 64 characters wide', async () => {
    const once = await hashApiKey(VALID);
    expect(once).toBe(await hashApiKey(VALID));
    expect(once).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generating a key', () => {
  it('produces a key its own parser accepts', () => {
    const key = generateApiKey();
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
  });

  it('does not repeat itself', () => {
    const keys = new Set(Array.from({ length: 200 }, generateApiKey));
    expect(keys.size).toBe(200);
  });

  it('stores only a short, non-authenticating prefix', () => {
    const key = generateApiKey();
    const prefix = apiKeyPrefix(key);
    expect(prefix).toHaveLength(14);
    expect(key.startsWith(prefix)).toBe(true);
    expect(parseBearerKey(`Bearer ${prefix}`)).toBeNull();
  });
});

describe('mapping a create_share failure to a response', () => {
  it('turns the free-tier cap into 402 with an upgrade URL', () => {
    const byName = mapCreateShareError('free_tier_share_cap_reached');
    const byHint = mapCreateShareError('Free tier is 2 tracked links, lifetime. Upgrade to Pro.');
    expect(byName).toEqual(FREE_LIMIT_REACHED);
    expect(byHint).toEqual(FREE_LIMIT_REACHED);
    expect(byName.status).toBe(402);
    expect(byName.body).toEqual({
      error: 'free_limit_reached',
      message: 'Free accounts get 2 tracked links. Upgrade at https://htmlradar.com/upgrade',
      upgrade_url: 'https://htmlradar.com/upgrade',
    });
  });

  it('turns chosen-address failures into 422 with the customer-facing copy', () => {
    expect(mapCreateShareError('slug_requires_pro').status).toBe(422);
    expect(mapCreateShareError('slug_requires_pro').body['message']).toMatch(/Pro feature/);
    expect(mapCreateShareError('slug_reserved').body['message']).toMatch(/reserved/);
    expect(mapCreateShareError('slug_invalid_format').body['message']).toMatch(/3 to 60/);
    expect(mapCreateShareError('slug_unavailable').body['message']).toMatch(/not available/);
  });

  it('explains a missing document rather than leaking the exception name', () => {
    const r = mapCreateShareError('document_not_found');
    expect(r.status).toBe(422);
    expect(r.body['message']).toBe('That document does not exist, or it is not yours.');
  });

  // The point of the fallback is that it forwards nothing. A raw Postgres
  // message carries constraint names, column names and sometimes the offending
  // value, none of which a caller can act on and all of which describe the
  // system behind the endpoint.
  it('says nothing at all about an error it does not recognise', () => {
    expect(mapCreateShareError('duplicate key value violates constraint "x_pkey"')).toEqual({
      status: 500,
      body: { error: 'internal' },
    });
    expect(JSON.stringify(mapCreateShareError('column "secret_col" does not exist'))).not.toContain(
      'secret_col',
    );
  });
});

describe('the other error responses the contract fixes', () => {
  it('413 carries the byte cap', () => {
    // 5 MB — the API's own ceiling, well under the 30 MB the browser upload
    // takes, because an edge isolate has to decode this one in memory.
    expect(tooLarge(5 * 1024 * 1024)).toEqual({
      status: 413,
      body: { error: 'too_large', max_bytes: 5242880 },
    });
  });

  it('422 carries a message', () => {
    expect(validationError('Provide either "html" or "url".')).toEqual({
      status: 422,
      body: { error: 'validation', message: 'Provide either "html" or "url".' },
    });
  });
});

describe('rate limiting', () => {
  it('429 carries the wait in the body and the header, saying the same thing twice', async () => {
    const err = rateLimited(1800);
    expect(err).toEqual({
      status: 429,
      body: { error: 'rate_limited', retry_after_seconds: 1800 },
      headers: { 'retry-after': '1800' },
    });

    const res = errorResponse(err);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1800');
    expect(await res.json()).toEqual({ error: 'rate_limited', retry_after_seconds: 1800 });
  });

  it('leaves a response with no headers of its own alone', () => {
    const res = errorResponse(validationError('nope'));
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});

// The shares route's read cap. Above the 5 MB document ceiling by half a
// megabyte, which is the room JSON string escaping needs.
const MAX_REQUEST_BYTES = 5.5 * 1024 * 1024;

/**
 * A POST whose body arrives in chunks and declares no Content-Length — which
 * is what a chunked request actually looks like, and the shape the header
 * check on its own cannot see. `pulled` counts the chunks the stream was asked
 * for, so a test can tell "refused" from "refused after reading all of it".
 */
function chunkedRequest(chunks: Uint8Array[]): { req: Request; pulled: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[sent];
      if (!chunk) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(chunk);
    },
  });
  const req = new Request('https://htmlradar.com/api/v1/shares', {
    method: 'POST',
    body: stream,
    duplex: 'half', // required by Node/undici for a streamed request body
  } as RequestInit);
  return { req, pulled: () => sent };
}

/** A POST whose first chunk arrives and whose second never does. */
function stalledRequest(first: Uint8Array): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
    },
    pull: () => new Promise<void>(() => {}), // the rest of the body never comes
  });
  return new Request('https://htmlradar.com/api/v1/shares', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('reading a request body under a cap', () => {
  it('reads a chunked body that declares no Content-Length', async () => {
    const enc = new TextEncoder();
    const { req } = chunkedRequest([enc.encode('{"html":'), enc.encode('"<p>hi</p>"}')]);
    expect(req.headers.get('content-length')).toBeNull();
    expect(await readBodyCapped(req, MAX_REQUEST_BYTES)).toBe('{"html":"<p>hi</p>"}');
  });

  // The finding this closes: no Content-Length means the header check sees
  // nothing, and buffering first means the isolate holds the whole body before
  // anyone measures it.
  it('refuses a chunked body over the cap without reading it to the end', async () => {
    const oneMb = new Uint8Array(1024 * 1024);
    const { req, pulled } = chunkedRequest(Array.from({ length: 100 }, () => oneMb));
    expect(req.headers.get('content-length')).toBeNull();
    expect(await readBodyCapped(req, MAX_REQUEST_BYTES)).toBeNull();
    // 5.5 MB of budget: the sixth megabyte is the one that goes over. What
    // matters is that the remaining 94 never arrive.
    expect(pulled()).toBeGreaterThanOrEqual(6);
    expect(pulled()).toBeLessThan(12);
  });

  it('accepts a body exactly at the cap and refuses one byte more', async () => {
    const enc = new TextEncoder();
    expect(await readBodyCapped(chunkedRequest([enc.encode('abcde')]).req, 5)).toBe('abcde');
    expect(await readBodyCapped(chunkedRequest([enc.encode('abcdef')]).req, 5)).toBeNull();
  });

  it('keeps a multi-byte character that straddles two chunks', async () => {
    const euro = new TextEncoder().encode('€'); // three bytes
    const { req } = chunkedRequest([euro.slice(0, 1), euro.slice(1)]);
    expect(await readBodyCapped(req, 10)).toBe('€');
  });

  // A missing body is a 422 about JSON at the call site, not a 413. Reading it
  // as oversized would tell the caller the opposite of what went wrong.
  it('treats an absent body as empty rather than oversized', async () => {
    const req = new Request('https://htmlradar.com/api/v1/shares', { method: 'POST' });
    expect(await readBodyCapped(req, MAX_REQUEST_BYTES)).toBe('');
  });

  // The finding this closes: the cap ends a body that is too big, and nothing
  // ended a body that simply stopped. Staying under the cap and never closing
  // the connection left reader.read() pending for as long as the platform
  // allowed, with the isolate held open behind it.
  it('gives up on a body that stops arriving, far below the cap', async () => {
    vi.useFakeTimers();
    try {
      const req = stalledRequest(new TextEncoder().encode('{"html":"<p>'));
      const reading = readBodyCapped(req, MAX_REQUEST_BYTES, { timeoutMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await reading).toBe(BODY_TIMED_OUT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind when the body arrives', async () => {
    vi.useFakeTimers();
    try {
      const enc = new TextEncoder();
      const { req } = chunkedRequest([enc.encode('{"html":'), enc.encode('"<p>hi</p>"}')]);
      const reading = readBodyCapped(req, MAX_REQUEST_BYTES);
      await vi.advanceTimersByTimeAsync(0);
      expect(await reading).toBe('{"html":"<p>hi</p>"}');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Sol, round 3: `void reader.cancel()` let a source whose cancel rejects
  // surface as an unhandled rejection. The read still gives its answer; the
  // failed cancel is nobody's problem.
  it('survives a stream whose cancel rejects, on both the cap and the deadline', async () => {
    const unhandled: unknown[] = [];
    const capture = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', capture);
    vi.useFakeTimers();
    try {
      const failingCancel = (chunk: Uint8Array, stall: boolean) =>
        new Request('https://htmlradar.com/api/v1/shares', {
          method: 'POST',
          body: new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(chunk),
            pull: stall ? () => new Promise<void>(() => {}) : (controller) => controller.close(),
            cancel: () => Promise.reject(new Error('cancel failed')),
          }),
          duplex: 'half',
        } as RequestInit);

      expect(await readBodyCapped(failingCancel(new Uint8Array(6), false), 5)).toBeNull();

      const reading = readBodyCapped(failingCancel(new Uint8Array(6), true), MAX_REQUEST_BYTES, {
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await reading).toBe(BODY_TIMED_OUT);

      await vi.advanceTimersByTimeAsync(0); // let any rejection reach the process
      expect(unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
      process.off('unhandledRejection', capture);
    }
  });

  it('says 408 rather than 413 or 422, because nothing was wrong with the request', () => {
    expect(REQUEST_TIMEOUT).toEqual({ status: 408, body: { error: 'request_timeout' } });
  });
});

// ---------------------------------------------------------------------------
// The limiter when the database is the thing that is broken.
// ---------------------------------------------------------------------------

interface Chain {
  update: () => Chain;
  select: () => Chain;
  eq: () => Chain;
  is: () => Chain;
  maybeSingle: () => Promise<{ data: unknown }>;
}

/** The two calls authenticateApiKey makes, with the limiter RPC handed over. */
function stubSupabase(rpc: (bucket: string) => Promise<{ data: unknown; error: unknown }>) {
  const rows: Record<string, unknown> = {
    api_keys: { id: 'key-1', user_id: 'user-1' },
    profiles: { tier: 'free' },
  };
  const query = (table: string): Chain => {
    const chain: Chain = {
      update: () => chain,
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows[table] ?? null }),
    };
    return chain;
  };
  return {
    from: (table: string) => query(table),
    rpc: (_name: string, args: { p_key: string }) => rpc(args.p_key),
  };
}

const apiRequest = (): Request =>
  new Request('https://htmlradar.com/api/v1/shares', {
    method: 'POST',
    headers: { authorization: `Bearer ${VALID}`, 'cf-connecting-ip': '203.0.113.9' },
  });

const SHARES_LIMIT = { name: 'shares', per: 'account', max: 30, perIpMax: 120 } as const;

describe('the rate limiter when the database is the thing that is broken', () => {
  it('fails open on a thrown error and still checks the address budget', async () => {
    const buckets: string[] = [];
    supabase.current = stubSupabase((bucket) => {
      buckets.push(bucket);
      return Promise.reject(new Error('connection reset'));
    });

    const auth = await authenticateApiKey(apiRequest(), SHARES_LIMIT);

    // Fails open: a Supabase outage is not the caller's doing.
    expect(auth).toEqual({ caller: { userId: 'user-1', tier: 'free', scope: 'full' } });
    // And the second budget is still spent, rather than skipped by the throw.
    expect(buckets).toEqual(['api:shares:user-1', 'api:shares-ip:203.0.113.9']);
    // Silence is the part that is not acceptable: both failures are logged.
    expect(vi.mocked(logServerError)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logServerError).mock.calls[0]?.[0]).toMatchObject({
      source: 'api.rate_limit',
      context: { bucket: 'api:shares:user-1', code: 'exception' },
    });
  });

  it('fails open even when the logger is down too', async () => {
    vi.mocked(logServerError).mockRejectedValue(new Error('log sink unreachable'));
    supabase.current = stubSupabase(() => Promise.reject(new Error('connection reset')));

    await expect(authenticateApiKey(apiRequest(), SHARES_LIMIT)).resolves.toEqual({
      caller: { userId: 'user-1', tier: 'free', scope: 'full' },
    });
  });
});

describe('URL mode', () => {
  it('is a 422 that tells the caller what to do instead', () => {
    expect(URL_MODE_DISABLED).toEqual({
      status: 422,
      body: {
        error: 'validation',
        message: 'URL mode is not yet available through the API; upload the HTML instead.',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// The key's own powers, and the plan's own budget (schema/040, MCP 0.2.0).
// ---------------------------------------------------------------------------

/**
 * A Supabase stub that answers with the key row and plan it is given, and
 * records the ceiling every rate-limit call was made with. `scopeColumn: false`
 * is the database that has not had schema/040 applied: a select naming `scope`
 * comes back as an error, exactly as PostgREST answers for a missing column.
 */
function stubAccount({
  scope,
  tier,
  scopeColumn = true,
}: {
  scope?: string;
  tier?: 'free' | 'pro';
  scopeColumn?: boolean;
}) {
  const maxima: { bucket: string; max: number }[] = [];
  const client = {
    from: (table: string) => {
      let columns = '';
      const chain: Record<string, unknown> = {
        update: () => chain,
        select: (c: string) => {
          columns = c;
          return chain;
        },
        eq: () => chain,
        is: () => chain,
        maybeSingle: () => {
          if (table === 'profiles') return Promise.resolve({ data: { tier: tier ?? 'free' } });
          if (!scopeColumn && columns.includes('scope')) {
            return Promise.resolve({
              data: null,
              error: { message: 'column api_keys.scope does not exist' },
            });
          }
          return Promise.resolve({
            data: { id: 'key-1', user_id: 'user-1', ...(scope ? { scope } : {}) },
          });
        },
      };
      return chain;
    },
    rpc: (_name: string, args: { p_key: string; p_max_count: number }) => {
      maxima.push({ bucket: args.p_key, max: args.p_max_count });
      return Promise.resolve({ data: 0, error: null });
    },
  };
  return { client, maxima };
}

describe('the creation budget follows the plan', () => {
  it('is 75 an hour on Pro and 30 on free', () => {
    expect(creationMax('pro')).toBe(75);
    expect(creationMax('free')).toBe(30);
  });

  it('spends the Pro ceiling for a Pro account and the free one for a free account', async () => {
    for (const [tier, expected] of [
      ['pro', 75],
      ['free', 30],
    ] as const) {
      const { client, maxima } = stubAccount({ tier });
      supabase.current = client;
      const auth = await authenticateApiKey(apiRequest(), {
        name: 'shares',
        per: 'account',
        max: creationMax,
        perIpMax: 120,
        write: true,
      });
      expect(auth).toEqual({ caller: { userId: 'user-1', tier, scope: 'full' } });
      expect(maxima).toEqual([
        { bucket: 'api:shares:user-1', max: expected },
        { bucket: 'api:shares-ip:203.0.113.9', max: 120 },
      ]);
    }
  });
});

describe('a read-only key', () => {
  it('is refused on a route that writes, with a 403 saying what to do', async () => {
    const { client } = stubAccount({ scope: 'read_only' });
    supabase.current = client;
    const auth = await authenticateApiKey(apiRequest(), {
      name: 'shares',
      per: 'account',
      max: creationMax,
      write: true,
    });
    expect(auth).toEqual({ error: READ_ONLY_KEY });
    expect(READ_ONLY_KEY.status).toBe(403);
    expect(String(READ_ONLY_KEY.body['message'])).toMatch(/read-only/);
    expect(String(READ_ONLY_KEY.body['message'])).toMatch(/htmlradar\.com\/settings/);
  });

  it('is allowed on a route that only reads', async () => {
    const { client } = stubAccount({ scope: 'read_only' });
    supabase.current = client;
    await expect(
      authenticateApiKey(apiRequest(), { name: 'activity', per: 'key', max: 300 }),
    ).resolves.toEqual({ caller: { userId: 'user-1', tier: 'free', scope: 'read_only' } });
  });

  // The budgets are spent before the scope is read, so a script looping on a
  // route its key cannot use still runs into a 429 rather than a free retry.
  it('still spends its budget on the call it is refused for', async () => {
    const { client, maxima } = stubAccount({ scope: 'read_only' });
    supabase.current = client;
    await authenticateApiKey(apiRequest(), {
      name: 'shares',
      per: 'account',
      max: creationMax,
      write: true,
    });
    expect(maxima).toEqual([{ bucket: 'api:shares:user-1', max: 30 }]);
  });
});

// ponytail: delete this test with the fallback it covers, once 040 is applied.
describe('a database that has not had schema/040 applied', () => {
  it('authenticates the key as full access rather than failing the request', async () => {
    const { client } = stubAccount({ scopeColumn: false });
    supabase.current = client;
    await expect(
      authenticateApiKey(apiRequest(), {
        name: 'shares',
        per: 'account',
        max: creationMax,
        write: true,
      }),
    ).resolves.toEqual({ caller: { userId: 'user-1', tier: 'free', scope: 'full' } });
  });
});

describe('the listing cursor', () => {
  const listRequest = (query: string) =>
    new Request(`https://htmlradar.com/api/v1/shares${query}`, {
      headers: { authorization: `Bearer ${VALID}` },
    });

  it('is absent when the caller did not ask for a page', () => {
    expect(readBefore(listRequest(''))).toEqual({ before: null });
  });

  it('normalises a timestamp the caller passed back', () => {
    expect(readBefore(listRequest('?before=2026-08-30T10:00:00Z'))).toEqual({
      before: '2026-08-30T10:00:00.000Z',
    });
  });

  // Silently returning page one to a caller that asked for page four is how a
  // paging loop becomes an infinite one.
  it('refuses a cursor that is not a timestamp rather than ignoring it', () => {
    const result = readBefore(listRequest('?before=yesterday'));
    expect(result).toEqual({
      error: {
        status: 422,
        body: {
          error: 'validation',
          message: '"before" must be an ISO 8601 timestamp, as returned in next_before.',
        },
      },
    });
  });
});
