import type { ReactNode } from 'react';
import { NavBar } from '@/components/NavBar';
import { TimezoneSync } from '@/components/TimezoneSync';

export const runtime = 'edge';

// Middleware already redirects unauthenticated requests to /sign-in for any
// path under (app)/. Pages that need the user object call `requireUser()`
// themselves. Keeping this layout free of an auth round-trip removes one
// redundant Supabase call per page render.
//
// TimezoneSync runs once on mount and writes the browser's IANA timezone
// to profiles.timezone if it's still the default 'UTC'. The
// notify_on_first_open trigger reads that column to render email
// timestamps in the sender's local time. Server action no-ops when the
// value already matches.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavBar app />
      <TimezoneSync />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
