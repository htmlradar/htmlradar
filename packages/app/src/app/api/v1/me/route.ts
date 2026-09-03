// GET /api/v1/me — the cheap "is this key good, and what can it do?" call.
// The MCP server hits it once at startup so a bad key fails at setup rather
// than at the moment somebody is trying to send a deck.

import type { NextRequest } from 'next/server';
import { authenticateApiKey, errorResponse, jsonResponse, serviceClient } from '@/lib/api-auth';
import { readQuota } from '@/lib/quota';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  // 60 an hour per key. The MCP server calls this once at startup, so a
  // budget this size is only ever reached by something in a loop.
  const auth = await authenticateApiKey(req, { name: 'me', per: 'key', max: 60 });
  if ('error' in auth) return errorResponse(auth.error);
  const { caller } = auth;

  // Pro has no free-link cap to report — null means unlimited (see
  // MeResponse in packages/mcp/src/api.ts). A free account's used count is
  // capped at its own allowance before it leaves this endpoint: a legacy or
  // comped account can have more shares than the free cap allows, and "12 of
  // 2 used" is not a sentence anything downstream can parse.
  const quota = await readQuota(serviceClient(), caller.userId);
  const isPro = quota.tier === 'pro';
  return jsonResponse(200, {
    user_id: caller.userId,
    tier: quota.tier,
    free_links_used: isPro ? quota.used : Math.min(quota.used, quota.cap),
    free_links_cap: isPro ? null : quota.cap,
  });
}
