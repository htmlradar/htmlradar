// Server Component header — renders different links for signed-in vs
// signed-out state by reading the session on the server. Shared by the
// public landing pages and the authenticated app shell.
//
// Sticky with a translucent warm backdrop — the page underneath gently
// blurs through. Same trick as Anthropic/Linear/Stripe — keeps the page
// feeling editorial while the nav stays accessible during long scrolls.

import Link from 'next/link';
import { serverClient } from '@/lib/supabase-server';

export async function NavBar() {
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-paper/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href={user ? '/docs' : '/'} className="font-mono text-sm tracking-wide text-ink">
          HTML<span className="text-signal">Radar</span>
        </Link>
        {user ? (
          <nav className="flex items-center gap-7 text-sm">
            <Link href="/docs" className="text-ink-soft hover:text-signal-dark">
              Documents
            </Link>
            {/* Analytics tab removed 2026-05-17 — was a flat list of all
             * shares (view counts, last-seen). Strictly redundant with
             * the per-doc /docs/[id] dashboard which shows the same data
             * with more depth. The /dashboard route still exists in the
             * codebase and a redirect to /docs keeps stale bookmarks
             * working. Resurrect by re-adding this link if a real user
             * asks for cross-doc rollup. */}
            <Link href="/settings" className="text-graphite hover:text-signal-dark">
              {user.email}
            </Link>
          </nav>
        ) : (
          <nav className="flex items-center gap-7 text-sm">
            <a
              href="https://github.com/htmlradar/htmlradar"
              className="hidden text-ink-soft hover:text-signal-dark sm:inline"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </a>
            <Link href="/pricing" className="text-ink-soft hover:text-signal-dark">
              Pricing
            </Link>
            <Link
              href="/sign-in"
              className="rounded-full border border-ink/15 bg-paper px-4 py-1.5 text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark"
            >
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
