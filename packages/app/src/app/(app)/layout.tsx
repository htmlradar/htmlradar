import type { ReactNode } from 'react';
import { NavBar } from '@/components/NavBar';

export const runtime = 'edge';

// Middleware already redirects unauthenticated requests to /sign-in for any
// path under (app)/. Pages that need the user object call `requireUser()`
// themselves. Keeping this layout free of an auth round-trip removes one
// redundant Supabase call per page render.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </>
  );
}
