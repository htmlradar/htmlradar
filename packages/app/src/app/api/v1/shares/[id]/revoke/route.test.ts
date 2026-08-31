// POST /api/v1/shares/{id}/revoke — the undo.
//
// Three things matter here. The write is scoped by id AND owner, because it
// runs with the service role and nothing else would stop an id belonging to
// another account. Somebody else's link is a 404 rather than a refusal, so a
// key cannot be used to find out which ids exist. And it is two-way, like the
// dashboard's own toggle: `{"revoked": false}` puts a link back.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const OWN_ID = '11111111-2222-4333-8444-555555555555';
const THEIRS_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

const db = vi.hoisted(() => ({
  shares: [] as Record<string, unknown>[],
  lookupFilters: {} as Record<string, unknown>,
  update: null as { values: Record<string, unknown>; filters: Record<string, unknown> } | null,
  events: [] as { event: string; properties: Record<string, unknown> }[],
}));

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn() }));
vi.mock('@/lib/events', () => ({
  captureServerEvent: async (e: { event: string; properties: Record<string, unknown> }) => {
    db.events.push(e);
  },
}));

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  authenticateApiKey: async () => ({ caller: { userId: 'user-1', tier: 'pro', scope: 'full' } }),
  serviceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain,
        update: (v: Record<string, unknown>) => {
          values = v;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          db.lookupFilters = { ...filters };
          const row = db.shares.find((share) =>
            Object.entries(filters).every(([column, value]) => share[column] === value),
          );
          return { data: table === 'document_shares' ? (row ?? null) : null };
        },
        then: (resolve: (value: { error: null }) => void) => {
          if (values) db.update = { values, filters: { ...filters } };
          resolve({ error: null });
        },
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  db.shares = [
    { id: OWN_ID, slug: 'acme-deck', owner_id: 'user-1' },
    { id: THEIRS_ID, slug: 'their-deck', owner_id: 'user-2' },
  ];
  db.lookupFilters = {};
  db.update = null;
  db.events = [];
});

async function revoke(id: string, body?: Record<string, unknown>) {
  const req = new Request(`https://htmlradar.com/api/v1/shares/${id}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer hr_live_${'a'.repeat(40)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
  const res = await POST(req, { params: { id } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/v1/shares/{id}/revoke', () => {
  it('switches the link off, and says so in a way an agent can relay', async () => {
    const res = await revoke(OWN_ID);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      share_id: OWN_ID,
      url: 'https://htmlradar.page/r/acme-deck',
      revoked: true,
    });
    expect(typeof res.body['revoked_at']).toBe('string');
  });

  // Both filters, always. The id alone is somebody else's link with a typo.
  it('writes with the id and the owner together', async () => {
    await revoke(OWN_ID);
    expect(db.update?.filters).toEqual({ id: OWN_ID, owner_id: 'user-1' });
    expect(Object.keys(db.update?.values ?? {})).toEqual(['revoked_at']);
  });

  it('puts a link back when asked, clearing the timestamp', async () => {
    const res = await revoke(OWN_ID, { revoked: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revoked: false, revoked_at: null });
    expect(db.update?.values).toEqual({ revoked_at: null });
  });

  it('takes the slug and the whole link as well as the id', async () => {
    expect((await revoke('acme-deck')).status).toBe(200);
    expect(db.lookupFilters).toEqual({ owner_id: 'user-1', slug: 'acme-deck' });

    expect((await revoke('https://htmlradar.page/r/acme-deck')).status).toBe(200);
    expect(db.lookupFilters).toEqual({ owner_id: 'user-1', slug: 'acme-deck' });
  });

  it("is a 404 for somebody else's link, and writes nothing", async () => {
    const res = await revoke(THEIRS_ID);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(db.update).toBeNull();
  });

  it('is a 404 for a value that is neither an id nor a slug', async () => {
    expect((await revoke('https://example.com/r/acme-deck')).status).toBe(404);
    expect(db.update).toBeNull();
  });

  it('refuses a "revoked" that is not a boolean', async () => {
    const res = await revoke(OWN_ID, { revoked: 'yes' });
    expect(res.status).toBe(422);
    expect(db.update).toBeNull();
  });

  // The same two names the dashboard's toggle emits, so a revoke from an
  // assistant and a revoke from the website are one number.
  it('records the same events the website records', async () => {
    await revoke(OWN_ID);
    await revoke(OWN_ID, { revoked: false });
    expect(db.events.map((e) => e.event)).toEqual(['share.revoked', 'share.reactivated']);
    expect(db.events[0]?.properties).toMatchObject({ share_id: OWN_ID, via: 'api' });
  });
});
