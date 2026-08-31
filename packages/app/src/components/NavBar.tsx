// Server Component header — renders different links for signed-in vs
// signed-out state by reading the session on the server. Shared by the
// public landing pages and the authenticated app shell.
//
// Public pages get the v2 floating pill (.v2-nav in landing-v2.css) — the
// same shape the home page and /pricing have always used. Until 2026-08-31
// this component drew a flat sticky bar instead, so clicking from home to
// any compare or use-case page changed the navigation shape as well as the
// background colour, and the site read as two websites stapled together.
//
// The app shell (`app` prop) keeps the flat bar: the pill hides its link
// list under 760px because the marketing footer is the phone navigation
// there, and the dashboard has no footer to fall back on.

import Link from 'next/link';
import { serverClient } from '@/lib/supabase-server';
import { Logo } from './Logo';

export async function NavBar({ app = false }: { app?: boolean }) {
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (app) {
    return (
      <header className="sticky top-0 z-30 border-b border-line/60 bg-paper/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {/* Single source of truth for the wordmark — used here AND in
              the landing nav so the brand mark is consistent everywhere. */}
          <Logo href={user ? '/docs' : '/'} />
          <nav className="flex items-center gap-7 text-sm">
            <Link href="/docs" className="text-ink-soft hover:text-signal-dark">
              Documents
            </Link>
            <Link href="/tools" className="text-ink-soft hover:text-signal-dark">
              Tools
            </Link>
            {/* Analytics tab removed 2026-05-17 — was a flat list of all
             * shares (view counts, last-seen). Strictly redundant with
             * the per-doc /docs/[id] dashboard which shows the same data
             * with more depth. The /dashboard route still exists in the
             * codebase and a redirect to /docs keeps stale bookmarks
             * working. Resurrect by re-adding this link if a real user
             * asks for cross-doc rollup. */}
            <Link href="/settings" className="text-graphite hover:text-signal-dark">
              {user?.email ?? 'Sign in'}
            </Link>
          </nav>
        </div>
      </header>
    );
  }

  return (
    <nav className="v2-nav">
      <Logo href={user ? '/docs' : '/'} />
      <ul>
        <li>
          <Link href="/why">Why</Link>
        </li>
        <li>
          <Link href="/tools">Tools</Link>
        </li>
        <li>
          <Link href="/pricing">Pricing</Link>
        </li>
      </ul>
      <Link href={user ? '/docs' : '/sign-in'} className="nav-cta">
        {user ? 'Open dashboard' : 'Get started'}
      </Link>
    </nav>
  );
}
