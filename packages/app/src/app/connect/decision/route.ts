import type { NextRequest } from 'next/server';
import {
  addressRetryAfter,
  apiKeyPrefix,
  errorResponse,
  generateApiKey,
  hashApiKey,
  rateLimited,
  type ApiKeyScope,
} from '@/lib/api-auth';
import {
  CONNECT_CALLBACK_URL,
  CONNECTOR_LABEL_PREFIX,
  FULL_SCOPE,
  WRITE_SCOPE,
  grantedScopeFor,
  hmacSign,
  randomBase64url,
  sha256Hex,
  validConnectRequest,
  verifyConsentNonce,
  type ConnectRequest,
} from '@/lib/connect';
import { safeNext } from '@/lib/safe-next';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { logServerError } from '@/lib/error-log';

export const runtime = 'edge';

function requestFrom(form: FormData): ConnectRequest {
  const value = (name: string) => {
    const field = form.get(name);
    return typeof field === 'string' ? field : '';
  };
  return {
    tx: value('tx'),
    clientId: value('client_id'),
    clientHost: value('client_host'),
    scope: value('scope'),
    exp: value('exp'),
    sig: value('sig'),
  };
}

function redirectTo(req: NextRequest, target: string): Response {
  return Response.redirect(new URL(target, req.url), 302);
}

function callback(query: Record<string, string>): Response {
  const url = new URL(CONNECT_CALLBACK_URL);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return Response.redirect(url, 302);
}

function connectPath(request: ConnectRequest, problem: string): string {
  const query = new URLSearchParams({
    tx: request.tx,
    client_id: request.clientId,
    client_host: request.clientHost,
    scope: request.scope,
    exp: request.exp,
    sig: request.sig,
    problem,
  });
  return safeNext(`/connect?${query}`);
}

// The expensive half of consent: this route mints a key. The ten-live-key
// trigger already caps how many can exist, but the trigger fires per account
// and this budget is per address, which is the case the trigger cannot see.
const DECISIONS_PER_HOUR = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const wait = await addressRetryAfter(req, 'connect-decision', DECISIONS_PER_HOUR);
  if (wait > 0) return errorResponse(rateLimited(wait));

  const form = await req.formData();
  const request = requestFrom(form);
  const secret = process.env['CONNECT_SIGNING_SECRET'] ?? '';
  if (!(await validConnectRequest(request, secret))) return redirectTo(req, '/connect');

  const user = await requireUser();
  const nonce = form.get('nonce');
  if (
    typeof nonce !== 'string' ||
    !(await verifyConsentNonce(nonce, request.tx, user.id, request.exp, secret))
  ) {
    return redirectTo(req, '/connect');
  }

  const decision = form.get('decision');
  if (decision !== 'allow' && decision !== 'cancel') return redirectTo(req, '/connect');

  const issueExp = String(Math.floor(Date.now() / 1000) + 120);
  if (decision === 'cancel') {
    const sig = await hmacSign(`${request.tx}\naccess_denied\n${issueExp}`, secret);
    return callback({ tx: request.tx, error: 'access_denied', exp: issueExp, sig });
  }

  // Always a subset of what was asked for. A client that asked only to publish
  // gets exactly `shares:write` — granting it the read scope it never asked for
  // would be refused by the Worker, and would be wrong even if it were not.
  const grantedScope = grantedScopeFor(request.scope, form.get('granted_scope') === FULL_SCOPE);
  // The key has to be able to do what the grant allows. A grant that includes
  // the write scope needs a full key; the OAuth scope, checked at every call in
  // the Worker, is what keeps a write-only grant from reading.
  const keyScope: ApiKeyScope = grantedScope.includes(WRITE_SCOPE) ? 'full' : 'read_only';
  const apiKey = generateApiKey();
  const label = `${CONNECTOR_LABEL_PREFIX}${request.clientHost}`.slice(0, 60);
  const supabase = serverClient();
  const { data: keyRow, error: keyError } = await supabase
    .from('api_keys')
    .insert({
      user_id: user.id,
      key_hash: await hashApiKey(apiKey),
      key_prefix: apiKeyPrefix(apiKey),
      label,
      scope: keyScope,
    })
    .select('id')
    .single();

  if (keyError || !keyRow) {
    // The ten-live-keys cap is a trigger on api_keys (schema/034); see the
    // same handling in settings/page.tsx's createApiKeyAction.
    if (keyError?.message.includes('api_key_limit')) {
      return redirectTo(req, connectPath(request, 'key_limit'));
    }
    await logServerError({
      source: 'connect.api_key_create',
      message: 'Connector API key insert failed',
      userId: user.id,
      route: '/connect',
    });
    return redirectTo(req, connectPath(request, 'create_failed'));
  }

  const code = randomBase64url(32);
  const { error: handleError } = await supabase.from('connect_handles').insert({
    tx: request.tx,
    code_hash: await sha256Hex(code),
    user_id: user.id,
    api_key_id: keyRow.id,
    api_key: apiKey,
    scope: grantedScope,
    expires_at: new Date(Number(issueExp) * 1000).toISOString(),
  });

  if (handleError) {
    await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyRow.id)
      .is('revoked_at', null);
    await logServerError({
      source: 'connect.handle_create',
      message: 'Connector handle insert failed; the new API key was revoked',
      userId: user.id,
      route: '/connect',
    });
    return redirectTo(req, connectPath(request, 'create_failed'));
  }

  // Contract §3b: the connection and the event that created it. Neither is the
  // off switch — the key is — so a failure here is logged and the connection
  // still completes. A customer left unable to connect because a bookkeeping
  // row would not write is the worse outcome of the two.
  const { error: grantError } = await supabase.from('connector_grants').insert({
    user_id: user.id,
    api_key_id: keyRow.id,
    client_id: request.clientId,
    client_host: request.clientHost,
    scope: grantedScope,
  });
  if (grantError) {
    await logServerError({
      source: 'connect.grant_record',
      level: 'warn',
      message: 'Connector grant row insert failed; the connection went ahead',
      userId: user.id,
      route: '/connect',
    });
  } else {
    await supabase.from('connector_events').insert({
      user_id: user.id,
      api_key_id: keyRow.id,
      kind: 'grant_created',
      detail: { client_host: request.clientHost, scope: grantedScope },
    });
  }

  const sig = await hmacSign(`${request.tx}\n${code}\n${grantedScope}\n${issueExp}`, secret);
  return callback({ tx: request.tx, code, scope: grantedScope, exp: issueExp, sig });
}
