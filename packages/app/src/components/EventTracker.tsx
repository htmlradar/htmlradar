'use client';

// Root client instrumentation:
//   - page.viewed on every route change
//   - cta.clicked when any element with [data-cta] is clicked (delegated
//     listener so we don't pay per-element wiring cost)
//   - window error → /api/errors → error_log table
// Failure to capture is always silent — never break the user's flow.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { captureClientEvent } from '@/lib/events-client';

export function EventTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    void captureClientEvent('page.viewed', { path: pathname });
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const errorHandler = (e: ErrorEvent) => {
      void fetch('/api/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: e.message,
          stack: e.error?.stack,
          url: location.href,
        }),
        keepalive: true,
      });
    };

    // Delegated click listener: every element with `data-cta="..."` fires
    // a cta.clicked event with the cta name. Lets us instrument CTAs by
    // adding a single attribute, no per-element JS.
    const clickHandler = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>('[data-cta]');
      if (!el) return;
      const cta = el.getAttribute('data-cta') ?? 'unknown';
      void captureClientEvent('cta.clicked', { cta, path: location.pathname });
    };

    window.addEventListener('error', errorHandler);
    document.addEventListener('click', clickHandler, { capture: true });
    return () => {
      window.removeEventListener('error', errorHandler);
      document.removeEventListener('click', clickHandler, { capture: true });
    };
  }, []);

  return null;
}
