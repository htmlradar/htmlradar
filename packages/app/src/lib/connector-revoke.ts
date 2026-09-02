// Step 2 and step 3 of the revocation order (contract §5), and nothing else.
//
// Step 1 — the application setting `revoked_at` on the api_keys row — has
// already happened by the time anything here runs, and step 1 alone closes
// access: every connector tool call carries that key to /api/v1, where
// authenticateApiKey refuses it on the very next call. So everything below is
// tidy-up, it is allowed to fail, and a failure is a row somebody can find
// rather than a silence.

import { logServerError } from '@/lib/error-log';

/** Where the connector Worker lives. The default is the production host. */
export const CONNECTOR_ORIGIN =
  process.env['NEXT_PUBLIC_CONNECTOR_ORIGIN'] ?? 'https://mcp.htmlradar.com';

/** Long enough for one cross-edge call, short enough that Settings still answers. */
const REVOKE_TIMEOUT_MS = 5000;

/** The two tables this touches, as the caller's own Supabase client. */
interface Db {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
    };
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Tell the Worker the key is dead, and record what happened either way.
 *
 * Returns nothing a caller must act on: the revocation already succeeded
 * before this was called. `ok` is there for the tests and for the log.
 */
export async function reconcileConnectorRevocation(
  db: Db,
  userId: string,
  apiKeyId: string,
): Promise<{ reconciled: boolean; connector: boolean }> {
  const existing = await db.from('connector_grants').select('id').eq('api_key_id', apiKeyId);
  const { data: grant } = await existing.maybeSingle();
  // An ordinary API key, not a connection. Nothing to reconcile.
  if (!grant) return { reconciled: false, connector: false };

  let status = 0;
  let failure = 'no response';
  // An AbortController rather than AbortSignal.timeout, so the timer is
  // cancelled the moment the call returns. A signal timer that outlives its
  // request keeps a Node event loop alive, which is how this showed up: the
  // unit tests hung after passing.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), REVOKE_TIMEOUT_MS);
  try {
    const response = await fetch(`${CONNECTOR_ORIGIN}/connect/revoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env['CONNECT_EXCHANGE_SECRET'] ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, api_key_id: apiKeyId }),
      signal: stop.signal,
    });
    status = response.status;
    failure = `HTTP ${response.status}`;
  } catch (error) {
    failure = error instanceof Error ? error.name : 'unknown';
  } finally {
    clearTimeout(timer);
  }

  if (status === 204) {
    await db
      .from('connector_grants')
      .update({ oauth_revoked_at: new Date().toISOString() })
      .eq('api_key_id', apiKeyId);
    await db
      .from('connector_events')
      .insert({ user_id: userId, api_key_id: apiKeyId, kind: 'grant_revoked', detail: {} });
    return { reconciled: true, connector: true };
  }

  // The monitor's sentinel reads connector_reconcile_backlog(), which is this
  // same state expressed as a query: a revoked key whose grant was never
  // confirmed gone. The event says why, in words with no credential in them.
  await db.from('connector_events').insert({
    user_id: userId,
    api_key_id: apiKeyId,
    kind: 'reconcile_failed',
    detail: { reason: failure },
  });
  await logServerError({
    source: 'connect.revoke_reconcile',
    level: 'warn',
    message: `Connector grant clean-up failed (${failure}); the key is already revoked`,
    userId,
    route: '/settings',
  });
  return { reconciled: false, connector: true };
}
