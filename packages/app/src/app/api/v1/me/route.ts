// GET /api/v1/me — the cheap "is this key good, and what can it do?" call.
// The MCP server hits it once at startup so a bad key fails at setup rather
// than at the moment somebody is trying to send a deck.

import type { NextRequest } from 'next/server';
import {
  authenticateApiKey,
  errorResponse,
  INVALID_KEY,
  jsonResponse,
  serviceClient,
} from '@/lib/api-auth';
import { readQuota } from '@/lib/quota';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const caller = await authenticateApiKey(req);
  if (!caller) return errorResponse(INVALID_KEY);

  const quota = await readQuota(serviceClient(), caller.userId);
  return jsonResponse(200, {
    user_id: caller.userId,
    tier: quota.tier,
    free_links_used: quota.used,
    free_links_cap: quota.cap,
  });
}
