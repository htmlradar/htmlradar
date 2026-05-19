'use client';

// Captures the browser's IANA timezone once per signed-in session and
// posts it via a server action to update `profiles.timezone`. The
// `notify_on_first_open` trigger uses that column to render
// first-open email timestamps in the sender's local time instead of
// UTC.
//
// Runs once on mount per page load. The server action is a no-op
// when the stored timezone already matches the browser's value, so
// re-running is cheap.

import { useEffect } from 'react';
import { syncTimezoneAction } from '@/app/(app)/actions';

export function TimezoneSync() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      // Fire and forget — failure is silent (the column has a sane
      // default of 'UTC' and the email still sends).
      void syncTimezoneAction(tz);
    } catch {
      // Older browsers without Intl.DateTimeFormat — leave default.
    }
  }, []);
  return null;
}
