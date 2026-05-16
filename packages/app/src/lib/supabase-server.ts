// Server-side Supabase client factories. Reads/writes the session via
// the request cookie store. `requireUser` redirects unauthenticated
// callers to /sign-in. Browser client lives in `./supabase-browser.ts`
// so that Client Components don't accidentally drag `next/headers` into
// their bundle.

// `next/headers` already enforces server-only — importing this module
// from a Client Component will fail loudly at build time, which is the
// guard we want.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Note: queries return loosely-typed data. We deliberately don't pass a
// Database<T> generic here — the hand-rolled type in lib/types.ts is
// good documentation but doesn't satisfy @supabase/ssr's strict shape
// without generated bindings. Run `supabase gen types typescript --linked`
// pre-launch to swap in proper types; until then queries are `any`-shaped
// and we rely on the call-site code being honest about column names.

const PUBLIC_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const PUBLIC_KEY = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;

export function serverClient() {
  const store = cookies();
  return createServerClient(PUBLIC_URL, PUBLIC_KEY, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        try {
          store.set({ name, value, ...options });
        } catch {
          // Server Components cannot set cookies; middleware handles refresh.
        }
      },
      remove: (name: string, options: CookieOptions) => {
        try {
          store.set({ name, value: '', ...options });
        } catch {
          // ignore — see comment above
        }
      },
    },
  });
}

export async function requireUser() {
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  return user;
}
