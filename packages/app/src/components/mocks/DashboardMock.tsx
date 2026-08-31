'use client';

// DashboardMock — the centerpiece visual in §03. Shows what a sender sees
// after Marc opens the tracked deck: opens count, active read, per-section
// dwell bars, last-7-days sparkline.
// v4: number tickers animate from 0 to target on first viewport entry.
// Once played, never re-fires on scroll-back. Respects reduced-motion.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface SectionRow {
  label: string;
  time: string;
  pct: number;
  tone: 'signal' | 'soft';
}

const SECTIONS: SectionRow[] = [
  { label: 'The Ask', time: '2m 41s', pct: 100, tone: 'signal' },
  { label: 'Team', time: '1m 58s', pct: 73, tone: 'signal' },
  { label: 'Traction', time: '1m 35s', pct: 58, tone: 'signal' },
  { label: 'Problem', time: '12s', pct: 8, tone: 'soft' },
  { label: 'Market sizing', time: '—', pct: 0, tone: 'soft' },
];

const SPARK = [0, 0, 1, 0, 2, 0, 3];
const TICKER_MS = 1100;

// Three optional overrides so a proposal page can show proposal sections
// instead of a seed deck's. Everything else — the layout, the tickers, the
// sparkline — is the same drawing.
interface DashboardMockProps {
  title?: string;
  recipient?: string;
  sections?: SectionRow[];
}

export function DashboardMock({
  title = 'Seed Deck. Q2.',
  recipient = 'Marc · Halbrook Capital',
  sections = SECTIONS,
}: DashboardMockProps = {}) {
  const [progress, setProgress] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setProgress(1);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || playedRef.current || !entry.isIntersecting) return;
        playedRef.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / TICKER_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          setProgress(eased);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const opens = Math.round(3 * progress);
  const totalSeconds = Math.round(374 * progress); // 6m 14s = 374s
  const readMin = Math.floor(totalSeconds / 60);
  const readSec = (totalSeconds % 60).toString().padStart(2, '0');
  const maxSpark = Math.max(...SPARK, 1);

  return (
    <div
      ref={ref}
      className="rounded-2xl border border-line bg-paper p-5 shadow-[0_30px_60px_-30px_rgba(31,17,8,0.25)] md:p-7"
    >
      <div className="flex items-start justify-between gap-6 border-b border-line pb-5">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            htmlradar.com / r / swift-falcon-a3f2
          </div>
          <div className="mt-2 font-serif text-2xl text-ink">{title}</div>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          <span className="size-1.5 rounded-full bg-signal" />
          Last open · 4h ago
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-paper-3 font-mono text-[12px] font-medium text-ink-soft">
            {recipient.charAt(0)}
          </span>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Recipient
            </div>
            <div className="mt-0.5 text-[14px] font-medium text-ink">{recipient}</div>
          </div>
        </div>
        <div className="flex items-baseline gap-6">
          <div className="text-right">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Opens
            </div>
            <div className="mt-1 font-serif text-2xl tabular-nums text-ink">{opens}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Active read
            </div>
            <div className="mt-1 font-serif text-2xl tabular-nums text-ink">
              {readMin}m {readSec}s
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-1 border-t border-line pt-5">
        <div className="space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            Opens · last 7 days
          </div>
          <div className="font-mono text-[11px] text-graphite">
            Mon &nbsp;·&nbsp; Tue &nbsp;·&nbsp; Wed &nbsp;·&nbsp; Thu &nbsp;·&nbsp; Fri
            &nbsp;·&nbsp; Sat &nbsp;·&nbsp; Sun
          </div>
        </div>
        <div className="flex h-8 items-end gap-1.5">
          {SPARK.map((v, i) => {
            const target = (v / maxSpark) * 100 || 6;
            const height = target * progress;
            return (
              <span
                key={i}
                aria-hidden
                className="block w-2 rounded-sm bg-signal"
                style={{
                  height: `${Math.max(height, 2)}%`,
                  opacity: v === 0 ? 0.18 : 0.9,
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Time spent per section
        </div>
        <ul className="mt-3 space-y-2.5">
          {sections.map((s) => {
            const width = Math.max(s.pct * progress, 1);
            return (
              <li key={s.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-28 truncate text-[14px] text-ink">{s.label}</span>
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-paper-3">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded-full',
                        s.tone === 'signal' ? 'bg-signal' : 'bg-signal-soft',
                      )}
                      style={{
                        width: `${width}%`,
                        opacity: s.pct === 0 ? 0.35 : 1,
                      }}
                    />
                  </span>
                </div>
                <span className="font-mono text-[12px] tabular-nums text-graphite">{s.time}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
