// A customer's own subdomain: what we refuse, what we ask Cloudflare, what we
// accept as proof, and what each state transition is allowed to write.
//
// There is no Postgres and no Cloudflare here. The database's answers are
// mocked the way the rest of this package mocks PostgREST — a chainable fake
// whose terminal call returns whatever the test says — and `fetch` is a stub
// that records what it was asked for. The rules that matter for safety (one
// domain per owner, ownership, eligibility, immutability) belong to the
// triggers in schema/052 and are pinned there, not here. What is pinned HERE
// is the shape of the four Cloudflare requests, the exactness of the probe,
// and the property that no write ever lands on a row in a state we did not
// expect.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./error-log', () => ({ logServerError: vi.fn(async () => undefined) }));

import {
  checkDomain,
  connectDomain,
  createHostname,
  customDomainsEnabled,
  customDomainsPublished,
  customHostnameMissing,
  customHostnameOf,
  defaultDomainForNewShare,
  deleteHostname,
  describeHostnameProblem,
  describeShareDomainError,
  disconnectDomain,
  dnsRecord,
  getHostname,
  hostnameOfDomain,
  normalizeHostname,
  findHostname,
  probe,
  restartValidation,
  shareHostArgs,
  type CustomDomainRow,
} from './custom-domains';

const USER = '00000000-0000-4000-8000-000000000001';
const DOMAIN = '22222222-2222-4222-8222-222222222222';
const ZONE = 'zone-1';

beforeEach(() => {
  process.env['CUSTOM_DOMAINS_ENABLED'] = '1';
  process.env['CLOUDFLARE_API_TOKEN'] = 'cf-token';
  process.env['CLOUDFLARE_ZONE_ID_PAGE'] = ZONE;
});

afterEach(() => {
  delete process.env['CUSTOM_DOMAINS_ENABLED'];
  delete process.env['CUSTOM_DOMAINS_PUBLISHED'];
  delete process.env['CUSTOM_DOMAINS_PILOT_OWNERS'];
  delete process.env['CLOUDFLARE_API_TOKEN'];
  delete process.env['CLOUDFLARE_ZONE_ID_PAGE'];
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

describe('the feature switch', () => {
  it('is off unless it is explicitly on', () => {
    for (const value of ['', ' ', 'no', 'off', '0', 'yes']) {
      process.env['CUSTOM_DOMAINS_ENABLED'] = value;
      expect(customDomainsEnabled(), value).toBe(false);
    }
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    expect(customDomainsEnabled()).toBe(false);
  });

  it('is on for the two spellings the deploy uses', () => {
    for (const value of ['1', 'true', 'TRUE ']) {
      process.env['CUSTOM_DOMAINS_ENABLED'] = value;
      expect(customDomainsEnabled(), value).toBe(true);
    }
  });

  // Two switches because the pilot needs the feature working on production
  // for one account before the pricing page tells the world it exists.
  it('advertises the feature only on its own separate switch', () => {
    process.env['CUSTOM_DOMAINS_ENABLED'] = '1';
    expect(customDomainsPublished()).toBe(false);
    process.env['CUSTOM_DOMAINS_PUBLISHED'] = '1';
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    expect(customDomainsPublished()).toBe(true);
    expect(customDomainsEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What a customer may connect
// ---------------------------------------------------------------------------

// Either sentence is a refusal: a name of ours trips the "htmlradar" rule and
// the own-domains rule, and which one answers first is not the point.
const REFUSED = /one of our own domains|mistaken for one of ours/;

describe('the name a customer types', () => {
  it('survives being pasted out of a browser address bar', () => {
    expect(normalizeHostname('  HTTPS://Decks.Acme.com/r/x?a=1  ')).toBe('decks.acme.com');
    expect(normalizeHostname('decks.acme.com.')).toBe('decks.acme.com');
  });

  it('is accepted when it is a subdomain of a domain they own', () => {
    for (const hostname of [
      'decks.acme.com',
      'docs.acme.com',
      'links.sub.acme.co.uk',
      'a1-b.acme.io',
    ]) {
      expect(describeHostnameProblem(hostname), hostname).toBeNull();
    }
  });

  it('refuses a bare domain and says what to type instead', () => {
    expect(describeHostnameProblem('acme.com')).toMatch(/decks\.acme\.com rather than acme\.com/);
  });

  // Three labels is not the rule: `acme.co.uk` has three and is still the
  // customer's whole domain.
  it('knows a multi-part suffix is still a bare domain', () => {
    expect(describeHostnameProblem('acme.co.uk')).toMatch(/rather than the bare domain/);
    expect(describeHostnameProblem('decks.acme.co.uk')).toBeNull();
  });

  it('refuses our own domains before it counts labels', () => {
    for (const hostname of ['htmlradar.page', 'decks.htmlradar.page', 'gethtmlradar.com']) {
      expect(describeHostnameProblem(hostname), hostname).toMatch(
        /one of our own domains|htmlradar/,
      );
    }
  });

  it('refuses a lookalike on somebody else’s domain', () => {
    expect(describeHostnameProblem('htmlradar-login.acme.com')).toMatch(/mistaken for one of ours/);
  });

  it('refuses Punycode', () => {
    expect(describeHostnameProblem('xn--80ak6aa92e.acme.com')).toMatch(/Punycode/);
  });

  it('refuses a name that is not a hostname at all', () => {
    for (const hostname of ['decks..acme.com', '-decks.acme.com', 'decks_x.acme.com']) {
      expect(describeHostnameProblem(hostname), hostname).toMatch(/letters, digits and hyphens/);
    }
  });

  it('asks for something when nothing was typed', () => {
    expect(describeHostnameProblem('   ')).toMatch(/Type the subdomain/);
  });

  // The pilot's own test names are ours, so every rule above refuses them.
  // They are admitted for the listed accounts and nobody else.
  it('refuses the pilot test names when no pilot is running', () => {
    for (const hostname of ['decks.gethtmlradar.com', 'links.gethtmlradar.com']) {
      expect(describeHostnameProblem(hostname), hostname).toMatch(REFUSED);
      expect(describeHostnameProblem(hostname, USER), hostname).toMatch(REFUSED);
    }
  });

  it('admits the pilot test names for a listed account, and refuses them for anyone else', () => {
    process.env['CUSTOM_DOMAINS_PILOT_OWNERS'] = ` ${USER} , other-account `;
    for (const hostname of ['decks.gethtmlradar.com', 'links.gethtmlradar.com']) {
      expect(describeHostnameProblem(hostname, USER), hostname).toBeNull();
      expect(describeHostnameProblem(hostname, 'someone-else'), hostname).toMatch(REFUSED);
      expect(describeHostnameProblem(hostname), hostname).toMatch(REFUSED);
    }
    // Only those two exact names, not the rest of the zone.
    expect(describeHostnameProblem('other.gethtmlradar.com', USER)).toMatch(REFUSED);
  });
});

describe('the one record we show', () => {
  it('gives both forms of the name, because providers disagree about which they want', () => {
    expect(dnsRecord('decks.acme.com')).toEqual({
      shortName: 'decks',
      fullName: 'decks.acme.com',
      target: 'customers.htmlradar.page',
    });
    expect(dnsRecord('links.sub.acme.co.uk').shortName).toBe('links.sub');
  });
});

// ---------------------------------------------------------------------------
// Cloudflare: the four requests, byte for byte
// ---------------------------------------------------------------------------

interface Recorded {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
  init: RequestInit;
}

function stubFetch(
  answer: (request: Recorded) => {
    status?: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
  },
): Recorded[] {
  const seen: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const request: Recorded = {
        url,
        method: init.method ?? 'GET',
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
        headers: (init.headers ?? {}) as Record<string, string>,
        init,
      };
      seen.push(request);
      const given = answer(request);
      const headers = new Headers(given.headers ?? {});
      return {
        ok: (given.status ?? 200) < 400,
        status: given.status ?? 200,
        headers,
        json: async () => given.json ?? { success: true, result: {} },
        text: async () => given.text ?? '',
      };
    }),
  );
  return seen;
}

const OK = {
  success: true,
  result: { id: 'cf-1', status: 'pending', ssl: { status: 'pending_validation' } },
};

describe('the Cloudflare client', () => {
  it('creates a hostname with HTTP validation and TLS 1.2, and nothing else', async () => {
    const seen = stubFetch(() => ({ json: OK }));
    const state = await createHostname('decks.acme.com');

    expect(seen[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`,
    );
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toEqual({
      hostname: 'decks.acme.com',
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });
    expect(seen[0]?.headers['Authorization']).toBe('Bearer cf-token');
    expect(state).toEqual({ id: 'cf-1', status: 'pending', sslStatus: 'pending_validation' });
  });

  it('reads one hostname with no body', async () => {
    const seen = stubFetch(() => ({ json: OK }));
    await getHostname('cf-1');
    expect(seen[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames/cf-1`,
    );
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.init.body).toBeUndefined();
  });

  // The SSL block is repeated on PATCH on purpose: re-sending the
  // configuration is how Cloudflare is asked to validate again.
  it('restarts validation by re-sending the SSL configuration', async () => {
    const seen = stubFetch(() => ({ json: OK }));
    await restartValidation('cf-1');
    expect(seen[0]?.method).toBe('PATCH');
    expect(seen[0]?.body).toEqual({
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    });
  });

  it('deletes with no body', async () => {
    const seen = stubFetch(() => ({ json: { success: true, result: {} } }));
    await deleteHostname('cf-1');
    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.init.body).toBeUndefined();
  });

  it('finds a hostname Cloudflare already holds for a name', async () => {
    const seen = stubFetch(() => ({ json: { success: true, result: [OK.result] } }));
    const found = await findHostname('decks.acme.com');
    expect(seen[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames?hostname=decks.acme.com`,
    );
    expect(found?.id).toBe('cf-1');
  });

  it('says so when Cloudflare holds nothing for that name', async () => {
    stubFetch(() => ({ json: { success: true, result: [] } }));
    expect(await findHostname('decks.acme.com')).toBeNull();
  });

  // Otherwise the retry inside disconnect, and the monitor's sweep behind it,
  // loop forever on a hostname somebody has already removed by hand.
  it('treats a 404 on delete as done', async () => {
    stubFetch(() => ({
      status: 404,
      json: { success: false, errors: [{ message: 'not found' }] },
    }));
    await expect(deleteHostname('cf-1')).resolves.toBeUndefined();
  });

  it('turns a Cloudflare refusal into an error carrying its message', async () => {
    stubFetch(() => ({
      status: 400,
      json: { success: false, errors: [{ code: 1406, message: 'hostname already exists' }] },
    }));
    await expect(createHostname('decks.acme.com')).rejects.toThrow(/hostname already exists/);
  });

  it('refuses to call Cloudflare at all without credentials', async () => {
    delete process.env['CLOUDFLARE_API_TOKEN'];
    stubFetch(() => ({ json: OK }));
    await expect(getHostname('cf-1')).rejects.toThrow(/credentials/);
  });
});

// ---------------------------------------------------------------------------
// Our own proof
// ---------------------------------------------------------------------------

const PASSING = {
  status: 200,
  headers: { 'x-htmlradar-domain': DOMAIN },
  text: `htmlradar-domain:${DOMAIN}\n`,
};

describe('the probe', () => {
  it('asks for the content-free path, follows no redirect, and gives up after five seconds', async () => {
    const seen = stubFetch(() => PASSING);
    expect(await probe('decks.acme.com', DOMAIN)).toBe(true);
    expect(seen[0]?.url).toBe('https://decks.acme.com/.well-known/htmlradar-domain-check');
    expect(seen[0]?.init.redirect).toBe('manual');
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  // Every one of these is somebody else's server answering, or ours answering
  // for a different claim. None of them is proof.
  it('fails on anything short of the exact answer for this domain', async () => {
    const cases: { name: string; answer: Parameters<typeof stubFetch>[0] }[] = [
      { name: 'a redirect', answer: () => ({ status: 301, headers: PASSING.headers }) },
      { name: 'a 404', answer: () => ({ status: 404 }) },
      {
        name: 'another domain’s id in the header',
        answer: () => ({ ...PASSING, headers: { 'x-htmlradar-domain': 'other' } }),
      },
      {
        name: 'another domain’s id in the body',
        answer: () => ({ ...PASSING, text: 'htmlradar-domain:other' }),
      },
      {
        name: 'a body that merely contains it',
        answer: () => ({ ...PASSING, text: `x htmlradar-domain:${DOMAIN}` }),
      },
      { name: 'a missing header', answer: () => ({ status: 200, text: PASSING.text }) },
    ];
    for (const { name, answer } of cases) {
      stubFetch(answer);
      expect(await probe('decks.acme.com', DOMAIN), name).toBe(false);
    }
  });

  it('fails rather than throws when the hostname does not resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    );
    expect(await probe('decks.acme.com', DOMAIN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A PostgREST stand-in
// ---------------------------------------------------------------------------

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

type Answer = { data?: unknown; error?: { message: string } | null };

function fakeDb(reply: (call: Call, index: number) => Answer): {
  admin: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: {} };
    const settle = () => {
      calls.push(call);
      const given = reply(call, calls.length - 1);
      return { data: given.data ?? null, error: given.error ?? null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (row: Record<string, unknown>) => {
        call.op = 'insert';
        call.payload = row;
        return builder;
      },
      update: (row: Record<string, unknown>) => {
        call.op = 'update';
        call.payload = row;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value;
        return builder;
      },
      is: (column: string, value: unknown) => {
        call.filters[column] = value;
        return builder;
      },
      maybeSingle: async () => settle(),
      single: async () => settle(),
      then: (resolve: (value: Answer) => void) => resolve(settle()),
    };
    return builder;
  };
  return { admin: { from } as unknown as SupabaseClient, calls };
}

const pending: CustomDomainRow = {
  id: DOMAIN,
  hostname: 'decks.acme.com',
  state: 'pending',
  cloudflare_id: 'cf-1',
  cloudflare_status: 'pending',
  ssl_status: 'pending_validation',
  verified_at: null,
  last_checked_at: null,
  last_error: null,
  consecutive_failures: 0,
  cloudflare_deleted_at: null,
  previous_owner_review: false,
};

const ACTIVE = {
  success: true,
  result: { id: 'cf-1', status: 'active', ssl: { status: 'active' } },
};

/** Cloudflare says active; the probe answers for this domain. */
function cloudflareLiveAndReachable() {
  return stubFetch((request) =>
    request.url.includes('api.cloudflare.com') ? { json: ACTIVE } : PASSING,
  );
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

describe('connecting a domain', () => {
  it('refuses a bare domain before it writes anything or calls anybody', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    const seen = stubFetch(() => ({ json: OK }));
    const result = await connectDomain(admin, USER, 'acme.com');
    expect(result).toEqual({ error: expect.stringMatching(/rather than the bare domain/) });
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  // The row first, the certificate second: the unique index is what stops two
  // accounts claiming one hostname, and it cannot do that from inside a
  // Cloudflare response.
  it('claims the row before it asks Cloudflare, then stores the hostname id', async () => {
    const { admin, calls } = fakeDb(() => ({ data: { id: DOMAIN } }));
    const seen = stubFetch(() => ({ json: OK }));

    const result = await connectDomain(admin, USER, 'https://Decks.Acme.com/');
    expect(result).toEqual({ ok: true, state: 'pending', message: expect.stringMatching(/CNAME/) });

    expect(calls[0]).toMatchObject({
      table: 'custom_domains',
      op: 'insert',
      payload: { owner_id: USER, hostname: 'decks.acme.com', state: 'pending' },
    });
    expect(seen[0]?.method).toBe('POST');
    expect(calls[1]).toMatchObject({
      table: 'custom_domains',
      op: 'update',
      payload: { cloudflare_id: 'cf-1' },
      filters: { id: DOMAIN, state: 'pending' },
    });
  });

  it('says who has it when the hostname is already claimed', async () => {
    const { admin } = fakeDb(() => ({ error: { message: 'duplicate key value violates 23505' } }));
    stubFetch(() => ({ json: OK }));
    expect(await connectDomain(admin, USER, 'decks.acme.com')).toEqual({
      error: expect.stringMatching(/already connected/),
    });
  });

  // Every rule the trigger in schema/052 enforces comes back as an exception
  // name; each one has to leave the customer with something to do.
  it('turns each of the database’s refusals into a sentence', async () => {
    const cases: [string, RegExp][] = [
      ['custom_domain_unavailable', /already connected/],
      ['custom_domain_needs_review', /connected to another account before/],
      ['custom_domain_limit', /Disconnect it before adding another/],
      ['custom_domain_requires_pro', /part of Pro/],
      ['custom_domain_bare', /rather than the bare domain/],
      ['custom_domain_reserved', /one of ours, a lookalike/],
      ['custom_domain_invalid_format', /letters, digits and hyphens/],
    ];
    for (const [name, expected] of cases) {
      const { admin } = fakeDb(() => ({ error: { message: `${name} (SQLSTATE P0000)` } }));
      stubFetch(() => ({ json: OK }));
      expect(await connectDomain(admin, USER, 'decks.acme.com'), name).toEqual({
        error: expect.stringMatching(expected),
      });
    }
  });

  it('keeps the claim when Cloudflare fails, so Check again can finish the job', async () => {
    const { admin, calls } = fakeDb(() => ({ data: { id: DOMAIN } }));
    stubFetch(() => ({ status: 500, json: { success: false, errors: [{ message: 'boom' }] } }));

    const result = await connectDomain(admin, USER, 'decks.acme.com');
    expect(result).toMatchObject({ ok: true, state: 'pending' });
    expect(calls[1]).toMatchObject({
      op: 'update',
      payload: { last_error: expect.stringMatching(/boom/) },
      filters: { id: DOMAIN, state: 'pending' },
    });
  });

  it('does nothing at all while the feature is off', async () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    const { admin, calls } = fakeDb(() => ({}));
    expect(await connectDomain(admin, USER, 'decks.acme.com')).toEqual({
      error: expect.stringMatching(/not available/),
    });
    expect(calls).toEqual([]);
  });

  // Turning the runtime switch on in production must not be the same act as
  // opening enrolment to everybody, so the list is enforced here and not only
  // in the interface.
  it('lets only the pilot accounts enrol while a pilot is running', async () => {
    process.env['CUSTOM_DOMAINS_PILOT_OWNERS'] = 'somebody-else';
    const { admin, calls } = fakeDb(() => ({}));
    const seen = stubFetch(() => ({ json: OK }));
    expect(await connectDomain(admin, USER, 'decks.acme.com')).toEqual({
      error: expect.stringMatching(/not open to every account yet/),
    });
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('lets a listed pilot account enrol', async () => {
    process.env['CUSTOM_DOMAINS_PILOT_OWNERS'] = `other,${USER}`;
    const { admin } = fakeDb((call) =>
      call.op === 'insert' ? { data: { id: DOMAIN } } : { data: { id: DOMAIN } },
    );
    stubFetch(() => ({ json: OK }));
    expect(await connectDomain(admin, USER, 'decks.gethtmlradar.com')).toMatchObject({ ok: true });
  });

  // A claim disconnected during the seconds a create takes would otherwise
  // leave a live certificate in our zone with no row naming it: invisible to
  // the monitor's sweep, invisible in Settings, still answering for a hostname
  // the customer believes they took back.
  it('gives the certificate back when the row that would hold its id is gone', async () => {
    const { admin } = fakeDb((call) =>
      call.op === 'insert' ? { data: { id: DOMAIN } } : { data: null },
    );
    const seen = stubFetch(() => ({ json: OK }));

    const result = await connectDomain(admin, USER, 'decks.acme.com');
    expect(result).toEqual({ error: expect.stringMatching(/disconnected while we were setting/) });
    expect(seen.map((r) => r.method)).toEqual(['POST', 'DELETE']);
    expect(seen[1]?.url).toMatch(/custom_hostnames\/cf-1$/);
  });

  // A failed POST is ambiguous: "Cloudflare refused it" and "Cloudflare did it
  // and the answer never arrived" look identical from here, and posting again
  // would leave a second certificate nothing of ours can name.
  it('adopts a hostname an uncertain first attempt already created, rather than creating a second', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.op === 'insert' ? { data: { id: DOMAIN } } : { data: { id: DOMAIN } },
    );
    let posts = 0;
    const seen = stubFetch((request) => {
      if (request.method === 'POST') {
        posts += 1;
        return { status: 500, json: { success: false, errors: [{ message: 'timeout' }] } };
      }
      return { json: { success: true, result: [OK.result] } };
    });

    const result = await connectDomain(admin, USER, 'decks.acme.com');
    expect(result).toMatchObject({ ok: true, state: 'pending' });
    expect(posts).toBe(1);
    expect(seen[1]?.url).toContain('?hostname=decks.acme.com');
    expect(calls[1]).toMatchObject({ op: 'update', payload: { cloudflare_id: 'cf-1' } });
  });

  it('creates once more only when Cloudflare holds nothing for the name', async () => {
    const { admin } = fakeDb((call) =>
      call.op === 'insert' ? { data: { id: DOMAIN } } : { data: { id: DOMAIN } },
    );
    let posts = 0;
    stubFetch((request) => {
      if (request.method === 'POST') {
        posts += 1;
        return posts === 1
          ? { status: 500, json: { success: false, errors: [{ message: 'timeout' }] } }
          : { json: OK };
      }
      return { json: { success: true, result: [] } };
    });

    expect(await connectDomain(admin, USER, 'decks.acme.com')).toMatchObject({ ok: true });
    expect(posts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Check again
// ---------------------------------------------------------------------------

describe('checking a domain', () => {
  it('goes live only when Cloudflare is active AND the domain reaches us, and makes it the default', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'custom_domains' && call.op === 'update' ? { data: { id: DOMAIN } } : {},
    );
    cloudflareLiveAndReachable();

    const result = await checkDomain(admin, USER, pending);
    expect(result).toMatchObject({ ok: true, state: 'live' });

    expect(calls[0]).toMatchObject({
      table: 'custom_domains',
      op: 'update',
      payload: { state: 'live', consecutive_failures: 0 },
      filters: { id: DOMAIN, state: 'pending' },
    });
    // The founder's rule: a live domain IS the default, with no toggle to find.
    expect(calls[1]).toMatchObject({
      table: 'profiles',
      op: 'update',
      payload: { default_custom_domain_id: DOMAIN },
      filters: { id: USER },
    });
  });

  // A certificate is not proof that the name points at us.
  it('stays pending when Cloudflare is active but the domain answers somebody else', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    stubFetch((request) =>
      request.url.includes('api.cloudflare.com')
        ? { json: ACTIVE }
        : { status: 200, text: 'hello' },
    );

    const result = await checkDomain(admin, USER, pending);
    expect(result).toMatchObject({ ok: true, state: 'pending' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      op: 'update',
      payload: { consecutive_failures: 1 },
      filters: { id: DOMAIN, state: 'pending' },
    });
    expect(calls[0]?.payload).not.toHaveProperty('state');
  });

  // The database refuses to let such a row reach 'live', so checking it would
  // spend a Cloudflare call to end in an exception.
  it('never checks a row that is waiting on a human', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    const seen = stubFetch(() => ({ json: ACTIVE }));
    const result = await checkDomain(admin, USER, { ...pending, previous_owner_review: true });
    expect(result).toEqual({ error: expect.stringMatching(/another account before/) });
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('never touches a retired row', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    const seen = stubFetch(() => ({ json: ACTIVE }));
    const result = await checkDomain(admin, USER, { ...pending, state: 'retired' });
    expect(result).toEqual({ error: expect.stringMatching(/disconnected/) });
    expect(calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  // The whole reason every write names the state it expects: a check that
  // started before a disconnect must not finish after it and put the domain
  // back on the internet.
  it('does not make a domain the default when the promotion matched no row', async () => {
    const { admin, calls } = fakeDb(() => ({ data: null }));
    cloudflareLiveAndReachable();

    const result = await checkDomain(admin, USER, pending);
    expect(result).toEqual({ error: expect.stringMatching(/disconnected while we were checking/) });
    expect(calls.filter((call) => call.table === 'profiles')).toEqual([]);
  });

  it('creates the Cloudflare hostname a stranded claim never got', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.op === 'update' && call.table === 'custom_domains' ? { data: { id: DOMAIN } } : {},
    );
    const seen = cloudflareLiveAndReachable();

    await checkDomain(admin, USER, { ...pending, cloudflare_id: null });
    expect(seen[0]?.method).toBe('POST');
    expect(calls[0]).toMatchObject({
      op: 'update',
      payload: { cloudflare_id: 'cf-1' },
      filters: { id: DOMAIN, state: 'pending' },
    });
  });

  it('asks Cloudflare to start over when validation timed out', async () => {
    const { admin } = fakeDb(() => ({}));
    const seen = stubFetch((request) =>
      request.method === 'GET'
        ? {
            json: {
              success: true,
              result: { id: 'cf-1', status: 'pending', ssl: { status: 'validation_timed_out' } },
            },
          }
        : { json: OK },
    );
    await checkDomain(admin, USER, pending);
    expect(seen.map((r) => r.method)).toEqual(['GET', 'PATCH']);
  });

  // "New links use this domain" is the one sentence a customer acts on, so it
  // is only said when the write that backs it landed.
  it('does not promise the domain is the default when that write matched no row', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'custom_domains' ? { data: { id: DOMAIN } } : { data: null },
    );
    cloudflareLiveAndReachable();

    const result = await checkDomain(admin, USER, pending);
    expect(result).toEqual({
      ok: true,
      state: 'live',
      message: expect.stringMatching(/Setting it as your default failed; press Check again/),
    });
    expect(calls[1]?.table).toBe('profiles');
  });

  // The retry is the same button: a live row re-checked runs the whole branch
  // again, including the default write.
  it('re-sets the default when Check again is pressed on a domain that is already live', async () => {
    const { admin, calls } = fakeDb(() => ({ data: { id: DOMAIN } }));
    cloudflareLiveAndReachable();

    const result = await checkDomain(admin, USER, { ...pending, state: 'live' });
    expect(result).toMatchObject({ ok: true, state: 'live' });
    expect(calls[0]?.filters).toMatchObject({ id: DOMAIN, state: 'live' });
    expect(calls[1]).toMatchObject({
      table: 'profiles',
      payload: { default_custom_domain_id: DOMAIN },
    });
  });

  it('gives back a hostname it created for a row that vanished mid-check', async () => {
    const { admin } = fakeDb(() => ({ data: null }));
    const seen = cloudflareLiveAndReachable();
    const result = await checkDomain(admin, USER, { ...pending, cloudflare_id: null });
    expect(result).toEqual({ error: expect.stringMatching(/disconnected while we were checking/) });
    expect(seen.map((r) => r.method)).toEqual(['POST', 'DELETE']);
  });

  it('records why when Cloudflare cannot be reached, and changes no state', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await checkDomain(admin, USER, pending);
    expect(result).toEqual({ error: expect.stringMatching(/could not reach Cloudflare/) });
    expect(calls[0]).toMatchObject({
      op: 'update',
      payload: { last_error: 'network down' },
      filters: { id: DOMAIN, state: 'pending' },
    });
    expect(calls[0]?.payload).not.toHaveProperty('state');
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

describe('disconnecting a domain', () => {
  it('clears the default first, then retires the row, then gives the certificate back', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'custom_domains' ? { data: { cloudflare_id: 'cf-1' } } : {},
    );
    const seen = stubFetch(() => ({ json: { success: true, result: {} } }));

    expect(await disconnectDomain(admin, USER, DOMAIN)).toMatchObject({
      ok: true,
      state: 'retired',
    });

    expect(calls[0]).toMatchObject({
      table: 'profiles',
      op: 'update',
      payload: { default_custom_domain_id: null },
      filters: { id: USER, default_custom_domain_id: DOMAIN },
    });
    expect(calls[1]).toMatchObject({
      table: 'custom_domains',
      op: 'update',
      payload: { state: 'retired' },
      filters: { id: DOMAIN, owner_id: USER, retired_at: null },
    });
    expect(seen[0]?.method).toBe('DELETE');
    // Only a confirmed delete stamps the row. That stamp is what takes it out
    // of the monitor's retry sweep.
    expect(calls[2]).toMatchObject({
      table: 'custom_domains',
      op: 'update',
      payload: { cloudflare_deleted_at: expect.any(String) },
      filters: { id: DOMAIN, owner_id: USER },
    });
  });

  // The links have stopped either way, which is what the customer asked for.
  // The certificate is our housekeeping, so they are told it is in hand.
  it('still retires the row when Cloudflare refuses the delete, and leaves it to be retried', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'custom_domains' ? { data: { cloudflare_id: 'cf-1' } } : {},
    );
    stubFetch(() => ({ status: 500, json: { success: false, errors: [{ message: 'nope' }] } }));

    expect(await disconnectDomain(admin, USER, DOMAIN)).toEqual({
      ok: true,
      state: 'retired',
      message: expect.stringMatching(/Cleanup .* pending; we retry it automatically/),
    });
    // No stamp, and the id is never cleared: the row keeps the only handle a
    // retry has, and stays in the sweep until the delete is confirmed.
    expect(calls.some((call) => 'cloudflare_deleted_at' in (call.payload ?? {}))).toBe(false);
    expect(calls.some((call) => 'cloudflare_id' in (call.payload ?? {}))).toBe(false);
  });

  it('counts a 404 as confirmation, because the hostname is gone either way', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'custom_domains' ? { data: { cloudflare_id: 'cf-1' } } : {},
    );
    stubFetch(() => ({ status: 404, json: { success: false } }));

    expect(await disconnectDomain(admin, USER, DOMAIN)).toEqual({
      ok: true,
      state: 'retired',
      message: 'Disconnected.',
    });
    expect(calls[2]?.payload).toMatchObject({ cloudflare_deleted_at: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Which domain a new link goes on
// ---------------------------------------------------------------------------

describe('the domain a new link goes on', () => {
  it('is nothing at all while the feature is off — not even a query', async () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    const { admin, calls } = fakeDb(() => ({}));
    expect(await defaultDomainForNewShare(admin, USER)).toBeNull();
    expect(calls).toEqual([]);
  });

  // Read through the profile rather than off the domain row, because that
  // column is what the database's tier trigger clears on a downgrade.
  it('is the profile’s default, confirmed live and the caller’s own', async () => {
    const { admin, calls } = fakeDb((call) =>
      call.table === 'profiles'
        ? { data: { default_custom_domain_id: DOMAIN } }
        : { data: { id: DOMAIN, hostname: 'decks.acme.com' } },
    );
    expect(await defaultDomainForNewShare(admin, USER)).toEqual({
      id: DOMAIN,
      hostname: 'decks.acme.com',
    });
    expect(calls[1]?.filters).toEqual({ id: DOMAIN, owner_id: USER, state: 'live' });
  });

  it('is nothing when the profile has no default — a downgraded account included', async () => {
    const { admin, calls } = fakeDb(() => ({ data: { default_custom_domain_id: null } }));
    expect(await defaultDomainForNewShare(admin, USER)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('the arguments create_share is given', () => {
  // The ordinary case passes NOTHING: the database reads the owner's live
  // default inside the insert that creates the row, so the hostname and the
  // row are written in one statement.
  it('says nothing at all when the customer did not choose', () => {
    expect(shareHostArgs({ kind: 'default' })).toEqual({});
  });

  it('names the HTMLRadar address explicitly when this link opts out', () => {
    expect(shareHostArgs({ kind: 'htmlradar' })).toEqual({ p_use_htmlradar_address: true });
  });

  it('names a domain when the API caller named one', () => {
    expect(shareHostArgs({ kind: 'domain', id: DOMAIN })).toEqual({
      p_custom_domain_id: DOMAIN,
    });
  });

  // The whole of the rollback. An account whose domain went live before the
  // switch was turned off keeps serving those links and stops collecting new
  // ones, because the apex is named rather than left to the default.
  it('names the HTMLRadar address for every link while the feature is off', () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    for (const choice of [
      { kind: 'default' } as const,
      { kind: 'htmlradar' } as const,
      { kind: 'domain', id: DOMAIN } as const,
    ]) {
      expect(shareHostArgs(choice), choice.kind).toEqual({ p_use_htmlradar_address: true });
    }
  });
});

describe('the address printed for a link the database just created', () => {
  // Read back, never assumed: an implied choice falls back to the HTMLRadar
  // address when the account's default has stopped serving.
  it('is the hostname of the domain on the returned row', async () => {
    const { admin, calls } = fakeDb(() => ({ data: { hostname: 'decks.acme.com' } }));
    expect(await hostnameOfDomain(admin, DOMAIN)).toEqual({
      ok: true,
      hostname: 'decks.acme.com',
    });
    expect(calls[0]?.filters).toEqual({ id: DOMAIN });
  });

  it('is nothing, with no query, when the row carries no domain', async () => {
    const { admin, calls } = fakeDb(() => ({}));
    expect(await hostnameOfDomain(admin, null)).toEqual({ ok: true, hostname: null });
    expect(calls).toEqual([]);
  });

  // The failure that matters. If it collapsed into "no domain", the caller
  // would be handed htmlradar.page/r/<slug> for a link that is not there: an
  // address that looks right, copies cleanly and opens nothing.
  it('is a failure, and never an HTMLRadar address, when the lookup did not answer', async () => {
    for (const answer of [{ error: { message: 'connection reset' } }, { data: null }]) {
      const { admin } = fakeDb(() => answer);
      expect(await hostnameOfDomain(admin, DOMAIN)).toEqual({ ok: false });
    }
  });
});

describe('a link that named a domain it may not have', () => {
  it('is explained rather than passed through as a Postgres message', () => {
    expect(describeShareDomainError('share_custom_domain_not_live')).toMatch(/not serving/);
    expect(describeShareDomainError('share_custom_domain_not_owned')).toMatch(/not connected/);
    expect(describeShareDomainError('share_host_conflict')).toMatch(/not both/);
    expect(describeShareDomainError('custom_domain_requires_pro')).toMatch(/part of Pro/);
    expect(describeShareDomainError('some other trouble')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reading the hostname off a share row
// ---------------------------------------------------------------------------

describe('the hostname on a share row', () => {
  it('is the joined domain’s, and null for every link on an HTMLRadar address', () => {
    expect(customHostnameOf({ custom_domains: { hostname: 'decks.acme.com' } })).toBe(
      'decks.acme.com',
    );
    expect(customHostnameOf({ custom_domains: null })).toBeNull();
    expect(customHostnameOf({})).toBeNull();
    expect(customHostnameOf(null)).toBeNull();
  });

  // The id says whether there is supposed to be a hostname; the join says what
  // it is. When the first is there and the second is not, nothing may print an
  // address.
  it('is reported missing when the row names a domain the join did not bring back', () => {
    expect(customHostnameMissing({ custom_domain_id: DOMAIN, custom_domains: null })).toBe(true);
    expect(customHostnameMissing({ custom_domain_id: DOMAIN, custom_domains: {} })).toBe(true);
    expect(
      customHostnameMissing({
        custom_domain_id: DOMAIN,
        custom_domains: { hostname: 'd.acme.com' },
      }),
    ).toBe(false);
    // A link on the HTMLRadar address names no domain, so nothing is missing.
    expect(customHostnameMissing({ custom_domain_id: null, custom_domains: null })).toBe(false);
    expect(customHostnameMissing(null)).toBe(false);
  });
});
