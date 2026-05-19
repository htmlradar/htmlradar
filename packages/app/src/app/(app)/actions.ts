'use server';

// (app) layout-level server actions. Currently:
//   - syncTimezoneAction: write the user's IANA timezone to
//     profiles.timezone so the notify_on_first_open trigger can
//     render email timestamps in their local time.

import { requireUser, serverClient } from '@/lib/supabase-server';

// IANA timezone names are well-formed (Area/City, sometimes nested).
// We accept anything that matches the loose shape + isn't suspiciously
// long. Invalid values fall through to the column default of 'UTC'.
const IANA_TZ_REGEX = /^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+){0,2}$/;

export async function syncTimezoneAction(timezone: string): Promise<void> {
  if (typeof timezone !== 'string') return;
  const tz = timezone.trim();
  if (!tz || tz.length > 64 || !IANA_TZ_REGEX.test(tz)) return;

  const user = await requireUser();
  const supabase = serverClient();
  // Cheap idempotent update: skip the write if the column already
  // matches. Avoids hammering the profile row from every navigation.
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single();
  if (profile?.timezone === tz) return;

  await supabase.from('profiles').update({ timezone: tz }).eq('id', user.id);
}
