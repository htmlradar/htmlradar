import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/error-log', () => ({ logServerError: vi.fn(async () => {}) }));

import { reconcileConnectorRevocation } from './connector-revoke';

interface Write {
  table: string;
  op: 'update' | 'insert';
  values: Record<string, unknown>;
}

function db(grant: { id: string } | null) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          return {
            async eq() {
              writes.push({ table, op: 'update', values });
              return { error: null };
            },
          };
        },
        async insert(values: Record<string, unknown>) {
          writes.push({ table, op: 'insert', values });
          return { error: null };
        },
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: grant, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, writes };
}

beforeEach(() => {
  process.env['CONNECT_EXCHANGE_SECRET'] = 'exchange-test-secret';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconcileConnectorRevocation', () => {
  it('does nothing for a key that is not a connection', async () => {
    const { client, writes } = db(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await reconcileConnectorRevocation(client as never, 'user-1', 'key-1');
    expect(result).toEqual({ reconciled: false, connector: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('names the key, not a grant, and records the clean-up on 204', async () => {
    const { client, writes } = db({ id: 'grant-1' });
    const calls: { url: string; body: unknown; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)),
        authorization: new Headers(init.headers).get('authorization'),
      });
      return new Response(null, { status: 204 });
    });

    const result = await reconcileConnectorRevocation(client as never, 'user-1', 'key-1');
    expect(result).toEqual({ reconciled: true, connector: true });
    expect(calls[0]?.url).toBe('https://mcp.htmlradar.com/connect/revoke');
    expect(calls[0]?.body).toEqual({ user_id: 'user-1', api_key_id: 'key-1' });
    expect(calls[0]?.authorization).toBe('Bearer exchange-test-secret');

    expect(writes).toEqual([
      {
        table: 'connector_grants',
        op: 'update',
        values: { oauth_revoked_at: expect.any(String) },
      },
      {
        table: 'connector_events',
        op: 'insert',
        values: { user_id: 'user-1', api_key_id: 'key-1', kind: 'grant_revoked', detail: {} },
      },
    ]);
  });

  it('writes reconcile_failed when the Worker refuses, and leaves the backlog visible', async () => {
    const { client, writes } = db({ id: 'grant-1' });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));

    const result = await reconcileConnectorRevocation(client as never, 'user-1', 'key-1');
    expect(result).toEqual({ reconciled: false, connector: true });
    // oauth_revoked_at is deliberately NOT set, which is what keeps the row in
    // connector_reconcile_backlog() for the monitor to find.
    expect(writes).toEqual([
      {
        table: 'connector_events',
        op: 'insert',
        values: {
          user_id: 'user-1',
          api_key_id: 'key-1',
          kind: 'reconcile_failed',
          detail: { reason: 'HTTP 500' },
        },
      },
    ]);
  });

  it('writes reconcile_failed when the Worker cannot be reached at all', async () => {
    const { client, writes } = db({ id: 'grant-1' });
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });

    const result = await reconcileConnectorRevocation(client as never, 'user-1', 'key-1');
    expect(result).toEqual({ reconciled: false, connector: true });
    expect(writes[0]?.values).toMatchObject({
      kind: 'reconcile_failed',
      detail: { reason: 'TimeoutError' },
    });
  });
});
