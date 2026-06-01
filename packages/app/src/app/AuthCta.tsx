'use client';

// Client-side auth-state primitives for the statically-prerendered
// marketing pages (landing, /pricing, /compare/*, …). Those pages are
// served as static assets — NOT edge-SSR'd — which is what removed the
// cold-start "Worker exceeded resource limits" (1102) errors. The only
// auth-dependent thing on them is the CTA: signed-out visitors get the
// pitch ("Get started" → /sign-in), signed-in visitors get the shortcut
// ("Open dashboard" → /docs). That swap now resolves in the browser
// after hydration.
//
// We read getSession() (local storage, no network) rather than
// getUser() (network round-trip): this only decides which label/href a
// visitor sees. The destination (/docs) is itself auth-guarded
// server-side via requireUser(), so a stale client guess here can never
// grant access — worst case a signed-out user briefly sees the wrong
// label. Static HTML ships the signed-out variant, which is correct for
// the overwhelming majority of landing-page traffic (no flash for them).

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase-browser';

function useIsAuthed(): boolean {
  const [isAuthed, setIsAuthed] = useState(false);
  useEffect(() => {
    let active = true;
    browserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setIsAuthed(!!data.session);
      });
    return () => {
      active = false;
    };
  }, []);
  return isAuthed;
}

export function AuthLink({
  guestHref,
  authedHref = '/docs',
  className,
  children,
}: {
  guestHref: string;
  authedHref?: string;
  className?: string;
  children: ReactNode;
}) {
  const isAuthed = useIsAuthed();
  return (
    <Link href={isAuthed ? authedHref : guestHref} className={className}>
      {children}
    </Link>
  );
}

export function AuthText({ guest, authed }: { guest: string; authed: string }) {
  const isAuthed = useIsAuthed();
  return <>{isAuthed ? authed : guest}</>;
}
