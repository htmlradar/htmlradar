// Route-level auth gate. Only paths starting with one of the protected
// prefixes below require a Supabase session — everything else falls
// through to Next's normal routing, including 404 / not-found. The
// middleware also refreshes the session cookie on every request via
// `getUser()` so tokens don't expire mid-browsing.
//
// We don't double-check auth inside (app)/layout.tsx — that was the
// previous pattern and added one redundant Supabase round-trip per
// render. The middleware is the single source of truth.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Anything under one of these prefixes requires a session. Everything
// else (landing, /why, /pricing, /privacy, /sign-in, /typo404) is open
// and Next handles the route resolution (real page or not-found.tsx).
const PROTECTED_PREFIXES = ['/docs', '/dashboard', '/new', '/settings', '/upgrade'];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;
  const requiresAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Public path — skip the Supabase round-trip entirely. Saves ~100ms
  // on cold edge requests for the landing page.
  if (!requiresAuth) {
    return res;
  }

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          res.cookies.set({ name, value, ...options });
        },
        remove: (name: string, options: CookieOptions) => {
          res.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signInUrl = new URL('/sign-in', req.url);
    // Preserve the original querystring on the `next` so post-sign-in
    // redirects land back on /upgrade?reason=quota (etc.) with the
    // contextual headline intact. Without `req.nextUrl.search` the
    // post-auth landing dropped to the generic Pro headline.
    signInUrl.searchParams.set('next', pathname + (req.nextUrl.search ?? ''));
    return NextResponse.redirect(signInUrl);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
};
