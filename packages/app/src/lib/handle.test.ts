// Handle allocation: what is derived, what is claimed, and — first of all —
// that with the gate off none of it happens.
//
// There is no local Postgres here, so the database's answers are mocked the
// way the rest of this package mocks PostgREST: a chainable fake whose
// terminal call returns whatever the test says the database said. The rules
// being tested are ours (which names to offer, in what order, and what to do
// with a refusal); the rules that matter for safety — the format, the reserved
// list, uniqueness, immutability and ownership — belong to the triggers in
// schema/043 and are pinned by schema/tests, not here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./error-log', () => ({ logServerError: vi.fn(async () => undefined) }));

import {
  deriveHandle,
  handleCandidates,
  handleLinksEnabled,
  ensureHandle,
  stampShareHost,
} from './handle';

const USER = '00000000-0000-4000-8000-000000000001';
const SHARE = '11111111-1111-4111-8111-111111111111';

// The format schema/043 enforces, repeated here so a candidate this file
// generates can be checked against the rule the database will apply to it.
const FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;
const wellFormed = (handle: string): boolean => FORMAT.test(handle) && !handle.includes('--');

interface Call {
  table: string;
  op: 'select' | 'update';
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

type Answer = { data?: unknown; error?: { code?: string; message: string } | null };

/**
 * A PostgREST stand-in: every builder method returns the builder, and the
 * answer comes from `reply`, which is handed the call it is answering.
 */
function fakeAdmin(reply: (call: Call, index: number) => Answer): {
  admin: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: {} };
    const answer = () => {
      calls.push(call);
      const given = reply(call, calls.length - 1);
      return { data: given.data ?? null, error: given.error ?? null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (row: Record<string, unknown>) => {
        call.op = 'update';
        call.payload = row;
        return builder;
      },
      eq: (key: string, value: unknown) => {
        call.filters[key] = value;
        return builder;
      },
      is: (key: string, value: unknown) => {
        call.filters[key] = value;
        return builder;
      },
      maybeSingle: async () => answer(),
      // An update with no terminal call is awaited directly.
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(answer()).then(resolve, reject),
    };
    return builder;
  };
  return { admin: { from } as unknown as SupabaseClient, calls };
}

const ORIGINAL = process.env.NEXT_PUBLIC_TRUST_HANDLES;
const gateOn = () => {
  process.env.NEXT_PUBLIC_TRUST_HANDLES = '*';
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TRUST_HANDLES;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_TRUST_HANDLES;
  else process.env.NEXT_PUBLIC_TRUST_HANDLES = ORIGINAL;
});

// ---------------------------------------------------------------------------
// The gate, which is the whole of the rollback
// ---------------------------------------------------------------------------

describe('with the gate off — the shipped state', () => {
  it('is off when unset, empty, or anything that is not a star', () => {
    expect(handleLinksEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TRUST_HANDLES = '';
    expect(handleLinksEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TRUST_HANDLES = 'qa-smoke-deck';
    expect(handleLinksEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TRUST_HANDLES = 'true';
    expect(handleLinksEnabled()).toBe(false);
  });

  it('is on for a star, with or without stray whitespace', () => {
    process.env.NEXT_PUBLIC_TRUST_HANDLES = '*';
    expect(handleLinksEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_TRUST_HANDLES = ' * ';
    expect(handleLinksEnabled()).toBe(true);
  });

  // The property the whole lane rests on: today nothing allocates, so no
  // profile gains a handle, no share gains a hostname, and every link stays
  // the apex link it has always been.
  it('allocates nothing and asks the database nothing', async () => {
    const { admin, calls } = fakeAdmin(() => {
      throw new Error('the database must not be touched while the gate is off');
    });
    expect(await ensureHandle(admin, USER)).toBeNull();
    expect(await stampShareHost(admin, USER, SHARE)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deriving the name
// ---------------------------------------------------------------------------

describe('deriving a handle from the email local part', () => {
  it('lowercases and folds every run of non-alphanumerics to one hyphen', () => {
    expect(deriveHandle('Marc.Lefevre@example.com')).toBe('marc-lefevre');
    expect(deriveHandle('a_b+c@x.io')).toBe('a-b-c');
    expect(deriveHandle('MARC..LEFEVRE@example.com')).toBe('marc-lefevre');
  });

  it('leaves no hyphen on either end, whatever the address looked like', () => {
    expect(deriveHandle('.marc.@example.com')).toBe('marc');
    expect(deriveHandle('---@example.com')).toBe('');
  });

  it('trims to the twenty-four characters the format allows', () => {
    const derived = deriveHandle('a'.repeat(40) + '@example.com');
    expect(derived).toHaveLength(24);
    expect(wellFormed(derived)).toBe(true);
  });

  it('never leaves a trailing hyphen where the trim happened to land', () => {
    // 'aaaaaaaaaaaaaaaaaaaaaaaa-b' cuts at 24 characters, on the hyphen.
    const derived = deriveHandle(`${'a'.repeat(24)}.b@example.com`);
    expect(derived).toBe('a'.repeat(24));
    expect(wellFormed(derived)).toBe(true);
  });
});

describe('the names offered to the database, in order', () => {
  it('offers the derived name first', () => {
    expect(handleCandidates('lumenforge@example.com')[0]).toBe('lumenforge');
  });

  it('shortens the base before adding a suffix, so no candidate is too long', () => {
    const candidates = handleCandidates('a'.repeat(40) + '@example.com');
    expect(candidates[0]).toHaveLength(24);
    for (const candidate of candidates) {
      expect(candidate.length, candidate).toBeLessThanOrEqual(24);
      expect(wellFormed(candidate), candidate).toBe(true);
    }
    // The suffixed ones keep the account in the name rather than starting over.
    expect(candidates[1]).toMatch(/^a{19}-[a-z0-9]{4}$/);
  });

  it('falls back to a generated name rather than a two-character host', () => {
    for (const email of ['a@example.com', 'ab@example.com', '---@example.com']) {
      const candidates = handleCandidates(email);
      expect(candidates, email).toHaveLength(1);
      expect(candidates[0], email).toMatch(/^[a-z0-9]{12}$/);
      expect(wellFormed(candidates[0]!), email).toBe(true);
    }
  });

  it('ends with a generated name every time, so the loop always has a last resort', () => {
    const candidates = handleCandidates('lumenforge@example.com');
    expect(candidates[candidates.length - 1]).toMatch(/^[a-z0-9]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// Claiming it
// ---------------------------------------------------------------------------

const profile = (handle: string | null, email = 'lumenforge@example.com') => ({
  data: { handle, email },
});

describe('claiming a handle on the first share after the gate opens', () => {
  beforeEach(gateOn);

  it('takes the derived name when it is free, and asks only for a null handle', async () => {
    const { admin, calls } = fakeAdmin((call) =>
      call.op === 'select' ? profile(null) : { data: { handle: 'lumenforge' } },
    );
    expect(await ensureHandle(admin, USER)).toBe('lumenforge');
    expect(calls[1]?.payload).toEqual({ handle: 'lumenforge' });
    expect(calls[1]?.filters).toEqual({ id: USER, handle: null });
  });

  it('returns the handle it already has without trying to write another', async () => {
    const { admin, calls } = fakeAdmin(() => profile('lumenforge'));
    expect(await ensureHandle(admin, USER)).toBe('lumenforge');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.op).toBe('select');
  });

  // P0041 is what the claim trigger in schema/043 raises for a name that is
  // taken, retired or reserved. All three look the same from here, and all
  // three mean "offer the next one".
  it('moves to a shortened, suffixed name when the database says unavailable', async () => {
    const unavailable = { error: { code: 'P0041', message: 'handle_unavailable' } };
    const { admin, calls } = fakeAdmin((call, index) => {
      if (call.op === 'select') return profile(null);
      return index === 1 ? unavailable : { data: { handle: call.payload!['handle'] } };
    });
    const allocated = await ensureHandle(admin, USER);
    expect(allocated).toMatch(/^lumenforge-[a-z0-9]{4}$/);
    expect(wellFormed(allocated!)).toBe(true);
    expect(calls[1]?.payload).toEqual({ handle: 'lumenforge' });
  });

  it('refuses a reserved name the same way and never lands on it', async () => {
    // 'support' is reserved in schema/043 — the trigger refuses it, and the
    // account whose address is support@ gets a suffixed name instead.
    const { admin } = fakeAdmin((call, index) => {
      if (call.op === 'select') return profile(null, 'support@acme.example');
      if (index === 1) return { error: { code: 'P0041', message: 'handle_unavailable' } };
      return { data: { handle: call.payload!['handle'] } };
    });
    const allocated = await ensureHandle(admin, USER);
    expect(allocated).not.toBe('support');
    expect(allocated).toMatch(/^support-[a-z0-9]{4}$/);
  });

  it('treats the unique index the same as the trigger', async () => {
    const { admin } = fakeAdmin((call, index) => {
      if (call.op === 'select') return profile(null);
      return index === 1
        ? { error: { code: '23505', message: 'duplicate key value violates profiles_handle_key' } }
        : { data: { handle: call.payload!['handle'] } };
    });
    expect(await ensureHandle(admin, USER)).toMatch(/^lumenforge-[a-z0-9]{4}$/);
  });

  // Two first shares arriving together: the loser's update matches no row and
  // comes back empty rather than failing. It must take the winner's name, not
  // claim a second one.
  it('produces one handle when two allocations race', async () => {
    const { admin, calls } = fakeAdmin((call, index) => {
      if (index === 0) return profile(null);
      if (call.op === 'update') return { data: null };
      return { data: { handle: 'lumenforge' } };
    });
    expect(await ensureHandle(admin, USER)).toBe('lumenforge');
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
  });

  it('gives up on an apex link rather than an error when every name is refused', async () => {
    const { admin } = fakeAdmin((call) =>
      call.op === 'select'
        ? profile(null)
        : { error: { code: 'P0041', message: 'handle_unavailable' } },
    );
    expect(await ensureHandle(admin, USER)).toBeNull();
  });

  it('allocates nothing for an account with no address to derive from', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: { handle: null, email: null } }));
    expect(await ensureHandle(admin, USER)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('allocates nothing when the profile cannot be read', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'upstream unavailable' } }));
    expect(await ensureHandle(admin, USER)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stamping it on the share
// ---------------------------------------------------------------------------

describe('stamping a new share with its hostname', () => {
  beforeEach(gateOn);

  it('writes the owner’s handle on the share and hands it back for the link', async () => {
    const { admin, calls } = fakeAdmin((call) =>
      call.table === 'profiles' ? profile('lumenforge') : { data: null },
    );
    expect(await stampShareHost(admin, USER, SHARE)).toBe('lumenforge');
    const write = calls.find((c) => c.table === 'document_shares');
    expect(write?.payload).toEqual({ host_handle: 'lumenforge' });
    // Scoped to the owner as well as the share: this client is the service
    // role and carries no session to scope the write for it.
    expect(write?.filters).toEqual({ id: SHARE, owner_id: USER });
  });

  it('leaves the share on the apex when no handle could be allocated', async () => {
    const { admin, calls } = fakeAdmin((call) =>
      call.op === 'select'
        ? profile(null)
        : { error: { code: 'P0041', message: 'handle_unavailable' } },
    );
    expect(await stampShareHost(admin, USER, SHARE)).toBeNull();
    expect(calls.some((c) => c.table === 'document_shares')).toBe(false);
  });

  // The share row already exists by the time this runs, inside the caller's
  // own try block. A throw here would turn a share that WAS created into
  // "Failed to create the share" — so it cannot throw, whatever the network
  // does.
  it('never throws, so a created share is never reported as a failure', async () => {
    const admin = {
      from: () => {
        throw new Error('fetch failed');
      },
    } as unknown as SupabaseClient;
    await expect(stampShareHost(admin, USER, SHARE)).resolves.toBeNull();
  });

  // A hostname that could not be written is not a failed share: the link
  // opens on the apex, forever. So the caller is told to print the apex
  // address, which is the one that will actually be served.
  it('reports the apex when the stamp itself fails', async () => {
    const { admin } = fakeAdmin((call) =>
      call.table === 'profiles'
        ? profile('lumenforge')
        : { error: { message: 'host_handle_not_owned' } },
    );
    expect(await stampShareHost(admin, USER, SHARE)).toBeNull();
  });
});
