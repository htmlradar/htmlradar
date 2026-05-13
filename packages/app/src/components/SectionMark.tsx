// SectionMark — the brand-specific kicker mark that replaces the §
// (silcrow) used everywhere in v4. The silcrow read as "AI essay" and
// got overused; this is a custom oxblood wedge that visually echoes the
// hero radar's sweep beam. Same typographic role as the old
// `.section-mark` class (mono caps, oxblood, tracked) — just with a
// brand silhouette in front of the text.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SectionMarkProps {
  children: ReactNode;
  className?: string;
}

export function SectionMark({ children, className }: SectionMarkProps) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-signal-dark',
        className,
      )}
    >
      <span aria-hidden className="inline-flex translate-y-[1px]">
        <WedgeMark />
      </span>
      {children}
    </p>
  );
}

function WedgeMark() {
  return (
    <svg viewBox="0 0 14 14" width={11} height={11} className="shrink-0" role="presentation">
      {/* Asymmetric kite-wedge — point on the left (the radar origin),
          widest at the right (where the sweep "lands"). Reads as a
          stylised scan beam at 11 px without looking like a generic
          play button. */}
      <path d="M 1 7 L 12 3 L 13 7 L 12 11 Z" fill="currentColor" />
    </svg>
  );
}
