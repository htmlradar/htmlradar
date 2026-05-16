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
import { captureServerEvent } from '@/lib/events';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (code) {
    const supabase = serverClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL('/sign-in?error=callback', req.url));
    }

    // Always fire signed_in. If the user row was created in the last 60s
    // (handle_new_user trigger only runs on auth.users insert), this is
    // also the user's first sign-in, so capture signed_up too. Read the
    // anon fingerprint cookie (set client-side in events-client) so we can
    // alias pre-signup browsing to the user post-hoc.
    // Fire-and-forget: never let analytics latency block the auth redirect.
    const user = data.user;
    if (user) {
      const fingerprint = req.cookies.get('hr:fp')?.value ?? null;
      const createdMs = new Date(user.created_at).getTime();
      const isNew = Date.now() - createdMs < 60_000;
      const provider = user.app_metadata?.['provider'] ?? null;
      void captureServerEvent({
        event: 'user.signed_in',
        distinctId: user.id,
        userId: user.id,
        properties: { provider, fingerprint },
      });
      if (isNew) {
        void captureServerEvent({
          event: 'user.signed_up',
          distinctId: user.id,
          userId: user.id,
          properties: { provider, fingerprint },
        });
        // Alias event — same shape as PostHog's $identify. Lets a
        // dashboard query union events with distinct_id=user.id and
        // distinct_id=fingerprint as "same person".
        if (fingerprint) {
          void captureServerEvent({
            event: '$identify',
            distinctId: user.id,
            userId: user.id,
            properties: { alias_fingerprint: fingerprint },
          });
        }
      }
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
