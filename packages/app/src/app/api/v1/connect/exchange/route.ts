import type { NextRequest } from 'next/server';
import { readBodyCapped, serviceClient } from '@/lib/api-auth';
import { constantTimeEqual, sha256Hex } from '@/lib/connect';

export const runtime = 'edge';

const USED_OR_EXPIRED = { error: 'used_or_expired' };

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env['CONNECT_EXCHANGE_SECRET'] ?? '';
  const match = /^Bearer[ \t]+(\S+)$/.exec(req.headers.get('authorization')?.trim() ?? '');
  if (!expected || !match?.[1] || !(await constantTimeEqual(match[1], expected))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const raw = await readBodyCapped(req, 1024);
  let body: unknown;
  try {
    body = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const tx =
    body && typeof body === 'object' && typeof (body as { tx?: unknown }).tx === 'string'
      ? (body as { tx: string }).tx
      : '';
  const code =
    body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : '';
  if (!/^[0-9a-f]{32}$/.test(tx) || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    return json(USED_OR_EXPIRED, 400);
  }

  const { data, error } = await serviceClient()
    .from('connect_handles')
    .delete()
    .eq('tx', tx)
    .eq('code_hash', await sha256Hex(code))
    .gt('expires_at', new Date().toISOString())
    .select('user_id, api_key, api_key_id, scope')
    .maybeSingle();

  if (error) return json({ error: 'internal' }, 500);
  if (!data) return json(USED_OR_EXPIRED, 400);
  return json(
    {
      user_id: data.user_id,
      api_key: data.api_key,
      api_key_id: data.api_key_id,
      scope: data.scope,
    },
    200,
  );
}
