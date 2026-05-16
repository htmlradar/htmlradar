// Sign-in page. Server-component shell that short-circuits to /docs when
// the user is already signed in — without this, clicking "Start free"
// from the landing while already authed sends Supabase through a fresh
// OAuth round-trip whose PKCE verifier doesn't match the existing
// session, producing the "We couldn't complete the sign-in" callback
// error.
//
// The form itself (Google + magic-link) is a client component imported
// from ./SignInForm.

import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase-server';
import { SignInForm } from './SignInForm';

export const runtime = 'edge';

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string };
}) {
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Honour ?next= when it's a safe in-app path (matches /auth/callback's
    // safeNext). Otherwise go to the dashboard.
    const next = searchParams?.next;
    const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/docs';
    redirect(safe);
  }

  return <SignInForm errorCode={searchParams?.error ?? null} next={searchParams?.next ?? null} />;
}
