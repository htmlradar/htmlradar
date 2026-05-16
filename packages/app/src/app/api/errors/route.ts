// POST /api/errors — client-side JS error sink. Accepts JSON, inserts
// into error_log via anon key (RLS allows anon inserts only).
// Fire-and-forget; we never return anything actionable to the client.

import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'edge';

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const ANON = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;

interface ErrorBody {
  message?: string;
  stack?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ErrorBody;
    if (!body.message) return NextResponse.json({ ok: false }, { status: 400 });

    // Cap field sizes defensively.
    const payload = {
      source: 'client',
      message: String(body.message).slice(0, 1000),
      stack: body.stack ? String(body.stack).slice(0, 4000) : null,
      url: body.url ? String(body.url).slice(0, 500) : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      metadata: body.metadata ?? {},
    };

    await fetch(`${SUPABASE_URL}/rest/v1/error_log`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Don't leak details; we never want client error reporting to break.
    return NextResponse.json({ ok: false });
  }
}
