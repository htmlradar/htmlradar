// Which hostname a link created from the dashboard is written with.
//
// `create_share` (schema/052) chooses it and writes it in the statement that
// creates the row, reading the owner's live default itself. So the ordinary
// case passes NO hostname argument at all, and what this file pins is exactly
// that: the absence, the one case that overrides it, and the absence of any
// lookup on the creating path.
//
// Stamping the hostname afterwards — which is what the handle column still
// does, while that gate is off — would leave a moment in which a link meant
// for a customer's own domain was reachable on htmlradar.page, and the address
// on a link is not something to be eventually consistent about.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-4000-8000-000000000001';
const DOC = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  rpcArgs: null as Record<string, unknown> | null,
  domainQueries: 0,
  createError: null as string | null,
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/events', () => ({ captureServerEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn(async () => undefined) }));
vi.mock('@/lib/quota', () => ({ readQuota: async () => ({ atCap: false, used: 0 }) }));
vi.mock('@/lib/preview-token', () => ({
  issueOwnerDocPreviewToken: async () => 'tok',
  issueOwnerPreviewToken: async () => 'tok',
}));
vi.mock('@/lib/r2', () => ({
  r2Key: () => 'key',
  uploadHtml: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteR2Object: vi.fn(),
}));
// Handle links are a separate gate and off; this file is about the domain.
vi.mock('@/lib/handle', () => ({ stampShareHost: async () => null }));

vi.mock('@/lib/supabase-server', () => ({
  requireUser: async () => ({ id: USER }),
  serverClient: () => ({
    // Only the creating call is the subject. The action follows it with
    // set_share_lock_deck, which would otherwise be the last one recorded.
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'create_share') return { data: null, error: null };
      state.rpcArgs = args;
      if (state.createError) return { data: null, error: { message: state.createError } };
      return { data: { id: 'share-1', slug: 'quick-glass' }, error: null };
    },
  }),
}));

// Counts every read of the domain tables. The creating path must make none:
// the database is what looks the default up.
vi.mock('@/lib/api-auth', () => ({
  serviceClient: () => ({
    from: (table: string) => {
      if (table === 'custom_domains' || table === 'profiles') state.domainQueries += 1;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));

import { createShareFormAction } from './actions';

function form(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('document_id', DOC);
  for (const [key, value] of Object.entries(extra)) fd.set(key, value);
  return fd;
}

async function create(extra: Record<string, string> = {}) {
  // A successful create always ends in a redirect, which the mock above turns
  // into a throw exactly as Next does.
  await expect(createShareFormAction(form(extra))).rejects.toThrow('NEXT_REDIRECT');
}

beforeEach(() => {
  process.env['CUSTOM_DOMAINS_ENABLED'] = '1';
  state.rpcArgs = null;
  state.domainQueries = 0;
  state.createError = null;
});

describe('creating a link from the dashboard', () => {
  // Nothing is passed, so `create_share` uses the owner's live default. That
  // is the product behaviour — "from then on every new link is on their
  // domain" — and it costs the creating path no query of its own.
  it('leaves the hostname to the creating call, and asks nothing itself', async () => {
    await create();
    expect(state.rpcArgs).not.toHaveProperty('p_custom_domain_id');
    expect(state.rpcArgs).not.toHaveProperty('p_use_htmlradar_address');
    expect(state.domainQueries).toBe(0);
  });

  // The founder's rule: the domain is the default and there is no toggle to
  // find. The only choice offered is the opposite one, per link, at creation.
  it('names the HTMLRadar address when the form asked for it, for that link only', async () => {
    await create({ use_htmlradar_host: 'on' });
    expect(state.rpcArgs?.['p_use_htmlradar_address']).toBe(true);
    expect(state.rpcArgs).not.toHaveProperty('p_custom_domain_id');
  });

  // The whole of the rollback: an account whose domain went live before the
  // switch was turned off keeps serving those links and stops collecting new
  // ones. That needs the apex named, not merely left to the default.
  it('names the HTMLRadar address for every link while the feature is off', async () => {
    delete process.env['CUSTOM_DOMAINS_ENABLED'];
    await create();
    expect(state.rpcArgs?.['p_use_htmlradar_address']).toBe(true);
  });

  it('turns the database’s refusal of a domain into a sentence, not a Postgres message', async () => {
    state.createError = 'share_custom_domain_not_live (SQLSTATE P0053)';
    const result = await createShareFormAction(form());
    expect(result).toEqual({ error: expect.stringMatching(/not serving right now/) });
  });
});
