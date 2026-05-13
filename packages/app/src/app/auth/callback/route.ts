// OAuth + magic-link return path. Supabase Auth redirects here with a
// `code` query param after the user completes sign-in. We exchange the
// code for a session cookie, then redirect to the intended destination
// (`?next=`).
//
// `next` is the only externally-controlled redirect target on the site
// and must be validated — accepting `next=//evil.com` makes us a phishing
// gateway. `safeNext` strips anything that isn't a clean
// in-app path.

import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (code) {
    const supabase = serverClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL('/sign-in?error=callback', req.url));
    }
  }

  return NextResponse.redirect(new URL(safeNext(url.searchParams.get('next')), req.url));
}

// Reject anything that isn't an in-app path. `//evil.com`, `/\evil.com`,
// and absolute URLs all get rewritten to /docs.
function safeNext(raw: string | null): string {
  if (!raw) return '/docs';
  if (!raw.startsWith('/')) return '/docs';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/docs';
  return raw;
}
