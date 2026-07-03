// OAuth + magic-link return path. Supabase Auth redirects here with a
// `code` query param after the user completes sign-in. We exchange the
// code for a session cookie, then redirect to the intended destination
// (`?next=`).
//
// `next` is the only externally-controlled redirect target on the site
// and must be validated — accepting `next=//evil.com` makes us a phishing
// gateway. Sanitisation lives in the shared `safeNext` (see lib/safe-next),
// which both this route and /sign-in use so the two can't drift.

import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { safeNext } from '@/lib/safe-next';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  // Redirect to /sign-in with an error, PRESERVING the intended destination
  // so a transient failure doesn't strand the user away from where they were
  // headed (e.g. /upgrade?reason=quota). Only attach `next` when it's a real
  // destination, to avoid noisy `?next=/docs`.
  const signInError = (errorCode: string) => {
    const dest = new URL('/sign-in', req.url);
    dest.searchParams.set('error', errorCode);
    if (next !== '/docs') dest.searchParams.set('next', next);
    return NextResponse.redirect(dest);
  };

  // No `code` → this wasn't a successful auth return. If the provider sent an
  // error (expired/denied magic link, OAuth error), surface it instead of
  // silently redirecting to `next` as though sign-in succeeded — otherwise the
  // user lands on a gated page, bounces back to sign-in, and never sees why.
  if (!code) {
    const providerError =
      url.searchParams.get('error_description') || url.searchParams.get('error');
    if (providerError) {
      return signInError(/expired|otp/i.test(providerError) ? 'expired' : 'callback');
    }
    return NextResponse.redirect(new URL(next, req.url));
  }

  const supabase = serverClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return signInError('callback');
  }

  // Always fire signed_in. If the user row was created in the last 60s
  // (handle_new_user trigger only runs on auth.users insert), this is
  // also the user's first sign-in, so capture signed_up too. Read the
  // anon fingerprint cookie (set client-side in events-client) so we can
  // alias pre-signup browsing to the user post-hoc.
  // Awaited (not void) — this route runs on the edge, where an un-awaited
  // fetch is cancelled the moment the redirect returns. `void` here
  // silently dropped every signed_in/signed_up/$identify event since
  // launch (zero in app_events as of 2026-07-03). captureServerEvent
  // never throws, so awaiting costs one round-trip and cannot block auth.
  const user = data.user;
  if (user) {
    const fingerprint = req.cookies.get('hr:fp')?.value ?? null;
    const createdMs = new Date(user.created_at).getTime();
    const isNew = Date.now() - createdMs < 60_000;
    const provider = user.app_metadata?.['provider'] ?? null;
    const captures = [
      captureServerEvent({
        event: 'user.signed_in',
        distinctId: user.id,
        userId: user.id,
        properties: { provider, fingerprint, email: user.email ?? null },
      }),
    ];
    if (isNew) {
      captures.push(
        captureServerEvent({
          event: 'user.signed_up',
          distinctId: user.id,
          userId: user.id,
          properties: { provider, fingerprint, email: user.email ?? null },
        }),
      );
      // Alias event — same shape as PostHog's $identify. Lets a
      // dashboard query union events with distinct_id=user.id and
      // distinct_id=fingerprint as "same person".
      if (fingerprint) {
        captures.push(
          captureServerEvent({
            event: '$identify',
            distinctId: user.id,
            userId: user.id,
            properties: { alias_fingerprint: fingerprint },
          }),
        );
      }
    }
    await Promise.all(captures);
  }

  return NextResponse.redirect(new URL(next, req.url));
}
