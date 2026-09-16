// OAuth + magic-link return path.
//
// Two ways in. OAuth (Google) returns with a `code` (PKCE), exchanged for a
// session cookie. E-mail links carry `token_hash` + `type=email` instead: the
// Supabase e-mail templates build the link as
// `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`, and this route
// verifies the hash server-side, which sets the cookie. That is the only form
// that works when the link is requested by our server route
// (/api/auth/magic-link, since 4 Sep 2026) rather than by the browser: with no
// PKCE state in the browser, Supabase's default `{{ .ConfirmationURL }}` link
// fell back to the implicit flow and put the tokens in the URL fragment, which
// no server can read, so every e-mail sign-in from 4 to 16 Sep 2026 landed the
// person on the page signed OUT (three of three fell back to Google on 14 Sep).
// The hash form also works when the link is opened in a different browser
// from the one that asked for it, which a phone opening a desktop's e-mail is.
// Then we redirect to the intended destination (`?next=`).
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
  const tokenHash = url.searchParams.get('token_hash');
  const next = safeNext(url.searchParams.get('next'));

  // Redirect to /sign-in with an error, PRESERVING the intended destination
  // so a transient failure doesn't strand the user away from where they were
  // headed (e.g. /upgrade?reason=quota). Only attach `next` when it's a real
  // destination, to avoid noisy `?next=/docs`.
  const signInError = async (errorCode: string, providerError?: string | null) => {
    // Awaited — edge runtime cancels un-awaited fetches on return.
    // distinct_id falls back to the anon fingerprint so failed attempts
    // still stitch to the person if they eventually sign up.
    await captureServerEvent({
      event: 'auth.callback_failed',
      distinctId: req.cookies.get('hr:fp')?.value ?? 'anon',
      properties: { code: errorCode, provider_error: providerError ?? null },
    });
    const dest = new URL('/sign-in', req.url);
    dest.searchParams.set('error', errorCode);
    if (next !== '/docs') dest.searchParams.set('next', next);
    return NextResponse.redirect(dest);
  };

  // No `code` → this wasn't a successful auth return. If the provider sent an
  // error (expired/denied magic link, OAuth error), surface it instead of
  // silently redirecting to `next` as though sign-in succeeded — otherwise the
  // user lands on a gated page, bounces back to sign-in, and never sees why.
  if (!code && !tokenHash) {
    const providerError =
      url.searchParams.get('error_description') || url.searchParams.get('error');
    if (providerError) {
      return signInError(
        /expired|otp/i.test(providerError) ? 'expired' : 'callback',
        providerError,
      );
    }
    return NextResponse.redirect(new URL(next, req.url));
  }

  const supabase = serverClient();
  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
    : await supabase.auth.exchangeCodeForSession(code as string);
  if (error) {
    // An e-mail link is single-use and expires in an hour; say so rather than
    // a generic failure, the same way an expired provider error is surfaced.
    return signInError(
      tokenHash && /expired|invalid|otp/i.test(error.message) ? 'expired' : 'callback',
      error.message,
    );
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
    // First-touch source, written by events-client on the visitor's very first
    // page view and mirrored to a cookie so this server-side event can read it.
    // Without this, a signup records nothing about where the person came from —
    // which is why neither paying customer's source was ever in the dashboard.
    let firstTouch: Record<string, unknown> = {};
    try {
      const raw = req.cookies.get('hr:src')?.value;
      if (raw) firstTouch = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    } catch {
      // A malformed cookie must never block sign-in.
    }
    const createdMs = new Date(user.created_at).getTime();
    const isNew = Date.now() - createdMs < 60_000;
    const provider = user.app_metadata?.['provider'] ?? null;
    const captures = [
      captureServerEvent({
        event: 'user.signed_in',
        distinctId: user.id,
        userId: user.id,
        properties: { ...firstTouch, provider, fingerprint, email: user.email ?? null },
      }),
    ];
    if (isNew) {
      captures.push(
        captureServerEvent({
          event: 'user.signed_up',
          distinctId: user.id,
          userId: user.id,
          properties: { ...firstTouch, provider, fingerprint, email: user.email ?? null },
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
