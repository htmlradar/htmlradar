'use client';

// Live-polling wrapper for the doc-detail dashboard.
//
// What it does: every 30s, calls router.refresh() — Next.js re-runs the
// page's Server Component, re-queries Supabase, and patches the rendered
// tree without unmounting client components. So the AT A GLANCE counts,
// ViewerInsights rows, and "last opened" timestamps update live, while
// the share-rail selection and any open forms keep their in-memory state.
//
// What it doesn't do: WebSockets / Supabase realtime. Polling once per
// 30s is plenty for this product — the tracker heartbeats every 15s,
// so worst-case staleness is ~45s. Realtime would add a connection
// per dashboard tab, which is overkill at our scale.
//
// Pauses while the tab is hidden (no point polling when nobody's
// looking) and resumes on `visibilitychange` → visible. The small "Live"
// pill near the heading reflects this state: pulsing dot when polling
// is active, dim when paused.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 30_000;

export function LiveRefresh() {
  const router = useRouter();
  const [active, setActive] = useState(typeof document === 'undefined' ? true : !document.hidden);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        router.refresh();
      }, POLL_MS);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      const visible = !document.hidden;
      setActive(visible);
      if (visible) start();
      else stop();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router]);

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite"
      title={
        active
          ? 'Auto-refreshes every 30s while this tab is in focus.'
          : 'Paused — tab is in the background.'
      }
    >
      <span className="relative flex size-1.5">
        {active && <span className="absolute inset-0 animate-ping rounded-full bg-signal/60" />}
        <span
          className={
            'relative inline-flex size-1.5 rounded-full ' +
            (active ? 'bg-signal' : 'bg-graphite/40')
          }
        />
      </span>
      Live · 30s
    </span>
  );
}
