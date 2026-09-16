// POST /api/v1/shares — which hostname the link is created on.
//
// Three states, deliberately not two: an absent `domain_id` is "my own
// domain", an explicit null is "the HTMLRadar address", and an id is that one
// domain. The distinction only exists because a caller who has connected a
// domain should not have to name it on every call, and a caller who wants one
// link off it should not have to disconnect.
//
// The hostname is chosen inside `create_share_as` (schema/052), which reads
// the account's default itself, so "use my own domain" is the ABSENCE of an
// argument. Whether a named domain is the caller's and live is the database's
// answer too: it raises, and mapCreateShareError turns that into this
// endpoint's 422. What this file pins is that the arguments are right and that
// the URL in the response is the URL the recipient will open — read back off
// the row, because an implied choice falls back to the HTMLRadar address when
// the account's default has stopped serving.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const SHARE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '33333333-3333-4333-8333-333333333333';

interface TableCall {
  table: string;
  op: 'select' | 'update' | 'delete';
  filters: Record<string, unknown>;
}

const db = vi.hoisted(() => ({
  rpcArgs: null as Record<string, unknown> | null,
  calls: [] as TableCall[],
  // The domain the database says it put the link on, and what that domain's
  // hostname is when the route reads it back.
  createdDomainId: null as string | null,
  hostname: 'decks.acme.com',
  hostnameLookupFails: false,
  createError: null as string | null,
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn() }));
vi.mock('@/lib/r2', () => ({ deleteR2Object: vi.fn(), r2Key: () => 'key' }));
vi.mock('@/lib/create-document', () => ({ createDocumentForUser: async () => 'doc-1' }));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 0 }) }));
vi.mock('@/lib/handle', () => ({ stampShareHost: async () => null }));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro' } }),
  serviceClient: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      db.rpcArgs = args;
      if (db.createError) return { data: null, error: { message: db.createError } };
      return {
        data: { id: SHARE_ID, slug: 'quick-glass', custom_domain_id: db.createdDomainId },
        error: null,
      };
    },
    from: (table: string) => {
      const call: TableCall = { table, op: 'select', filters: {} };
      const settle = () => {
        db.calls.push(call);
        if (table === 'custom_domains') {
          if (db.hostnameLookupFails) return { data: null, error: { message: 'connection reset' } };
          return { data: { hostname: db.hostname }, error: null };
        }
        return { data: null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => {
          call.op = 'update';
          return chain;
        },
        delete: () => {
          call.op = 'delete';
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters[column] = value;
          return chain;
        },
        is: (column: string, value: unknown) => {
          call.filters[column] = value;
          return chain;
        },
        maybeSingle: async () => settle(),
        then: (resolve: (value: unknown) => void) => resolve(settle()),
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  process.env['CUSTOM_DOMAINS_ENABLED'] = '1';
  db.rpcArgs = null;
  db.calls = [];
  db.createdDomainId = null;
  db.hostnameLookupFails = false;
  db.createError = null;
});

async function post(body: Record<string, unknown>) {
  const req = new Request('https://htmlradar.com/api/v1/shares', {
    method: 'POST',
    headers: {
      authorization: `Bearer hr_live_${'a'.repeat(40)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const HTML = { html: '<h1>Deck</h1>' };

describe('POST /api/v1/shares — domain_id', () => {
  // The absence of an argument is the instruction: the database reads the
  // account's default inside the creating call.
  it('leaves the hostname to the creating call when the field is absent', async () => {
    db.createdDomainId = DOMAIN_ID;
    const res = await post(HTML);
    expect(res.status).toBe(201);
    expect(db.rpcArgs).not.toHaveProperty('p_custom_domain_id');
    expect(db.rpcArgs).not.toHaveProperty('p_use_htmlradar_address');
    // The address comes off the row the database wrote, not off the request.
    expect(res.body['url']).toBe('https://decks.acme.com/r/quick-glass');
  });

  it('names the HTMLRadar address when the field is explicitly null', async () => {
    const res = await post({ ...HTML, domain_id: null });
    expect(res.status).toBe(201);
    expect(db.rpcArgs?.['p_use_htmlradar_address']).toBe(true);
    expect(res.body['url']).toBe('https://htmlradar.page/r/quick-glass');
    // No domain on the row means no read for a hostname either.
    expect(db.calls.filter((c) => c.table === 'custom_domains')).toEqual([]);
  });

  it('passes an explicit id straight to the creating call', async () => {
    db.createdDomainId = DOMAIN_ID;
    const res = await post({ ...HTML, domain_id: DOMAIN_ID });
    expect(res.status).toBe(201);
    expect(db.rpcArgs?.['p_custom_domain_id']).toBe(DOMAIN_ID);
    expect(db.rpcArgs).not.toHaveProperty('p_use_htmlradar_address');
  });

  // Ownership and liveness are the database's answer, not a second opinion
  // here that could disagree with it.
  it('turns the database’s refusal of a named domain into a 422', async () => {
    db.createError = 'share_custom_domain_not_live (SQLSTATE P0053)';
    const res = await post({ ...HTML, domain_id: DOMAIN_ID });
    expect(res.status).toBe(422);
    expect(res.body['message']).toMatch(/not serving/);
  });

  it('turns a domain that is not this account’s into a 422', async () => {
    db.createError = 'share_custom_domain_not_owned (SQLSTATE P0052)';
    const res = await post({ ...HTML, domain_id: DOMAIN_ID });
    expect(res.status).toBe(422);
    expect(res.body['message']).toMatch(/not connected to this account/);
  });

  it('refuses a domain_id that is not an id', async () => {
    for (const domain_id of ['decks.acme.com', 42, true, { id: DOMAIN_ID }]) {
      const res = await post({ ...HTML, domain_id });
      expect(res.status, JSON.stringify(domain_id)).toBe(422);
      expect(res.body['message']).toMatch(/must be a domain id, or null/);
      expect(db.rpcArgs).toBeNull();
    }
  });

  it('refuses an explicit domain while the feature is off', async () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    const res = await post({ ...HTML, domain_id: DOMAIN_ID });
    expect(res.status).toBe(422);
    expect(db.rpcArgs).toBeNull();
  });

  // The shipped state, and the rollback: the apex is named rather than left
  // to the default, so no new link can land on a customer domain.
  it('names the HTMLRadar address for every link while the feature is off', async () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    const res = await post(HTML);
    expect(res.status).toBe(201);
    expect(db.rpcArgs?.['p_use_htmlradar_address']).toBe(true);
    expect(res.body['url']).toBe('https://htmlradar.page/r/quick-glass');
  });

  it('prints the HTMLRadar address when the database put the link there', async () => {
    const res = await post(HTML);
    expect(res.status).toBe(201);
    expect(res.body['url']).toBe('https://htmlradar.page/r/quick-glass');
  });

  // The one answer that must never be substituted. An htmlradar.page URL for a
  // link that lives on a customer's domain looks right, copies cleanly and
  // opens nothing — worse than saying we could not read it.
  it('refuses to answer with an HTMLRadar address when the hostname could not be read', async () => {
    db.createdDomainId = DOMAIN_ID;
    db.hostnameLookupFails = true;
    const res = await post(HTML);
    expect(res.status).toBe(500);
    expect(res.body['message']).toMatch(/could not read the address/);
    // And it says the link exists, because it does.
    expect(res.body['message']).toMatch(/link was created/);
  });
});
