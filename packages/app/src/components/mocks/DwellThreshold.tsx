'use client';

// DwellThreshold — mock for §04 claim 03 (read, not "opened").
// A horizontal 0s→5s timeline. When the mock enters the viewport, a scrub
// head animates from 0 to ~3.2s. The status pip flips from "scanned" to
// "read" once it crosses 3s — the actual dwell threshold the tracker uses.

import { useEffect, useRef, useState } from 'react';

const THRESHOLD = 3; // seconds — matches packages/tracker minDwellMs default
const END = 3.2; // seconds — where the scrub head settles
const DURATION_MS = 2200;

export function DwellThreshold() {
  const [scrub, setScrub] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setScrub(END);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || playedRef.current || !entry.isIntersecting) return;
        playedRef.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          setScrub(eased * END);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const pct = (scrub / 5) * 100;
  const isRead = scrub >= THRESHOLD;

  return (
    <div
      ref={ref}
      className="relative flex h-[210px] w-full flex-col justify-between rounded-xl border border-line bg-paper px-6 py-7 md:h-[230px]"
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Time on §02 "The team"
        </span>
        <span className="font-serif text-[26px] tabular-nums text-ink">{scrub.toFixed(1)}s</span>
      </div>

      <div>
        <div className="relative h-1.5 w-full rounded-full bg-paper-3">
          <div
            className="absolute left-0 top-0 h-1.5 rounded-full bg-signal/40"
            style={{
              width: `${(THRESHOLD / 5) * 100}%`,
              opacity: scrub >= THRESHOLD ? 0.55 : 0.3,
              transition: 'opacity 200ms ease-out',
            }}
            aria-hidden
          />
          <div
            className="absolute left-0 top-0 h-1.5 rounded-full bg-signal"
            style={{ width: `${pct}%`, transition: 'width 60ms linear' }}
            aria-hidden
          />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-signal bg-paper shadow-[0_1px_4px_rgba(31,17,8,0.2)]"
            style={{ left: `${pct}%`, transition: 'left 60ms linear' }}
            aria-hidden
          />
          <div
            className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-signal-dark"
            style={{ left: `${(THRESHOLD / 5) * 100}%` }}
            aria-hidden
            title="3s dwell threshold"
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-graphite">
          <span>0s</span>
          <span>1</span>
          <span>2</span>
          <span className="text-signal-dark">3s threshold</span>
          <span>4</span>
          <span>5s</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`size-1.5 rounded-full transition-colors duration-300 ${
            isRead ? 'bg-signal' : 'bg-paper-3'
          }`}
          aria-hidden
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          {isRead ? (
            <span className="text-signal-dark">Read</span>
          ) : (
            <span>Scanned · doesn't count</span>
          )}
        </span>
      </div>
    </div>
  );
}
