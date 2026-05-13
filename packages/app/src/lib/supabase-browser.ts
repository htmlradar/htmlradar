// Browser-only Supabase client factory. Lives in its own module so that
// importing it from a Client Component doesn't pull `next/headers` (a
// server-only module) into the client bundle. The server-side factories
// live in `./supabase-server.ts`.

import { createBrowserClient } from '@supabase/ssr';

const PUBLIC_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const PUBLIC_KEY = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;

export function browserClient() {
  return createBrowserClient(PUBLIC_URL, PUBLIC_KEY);
}
