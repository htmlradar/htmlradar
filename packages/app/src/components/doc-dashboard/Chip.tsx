// Compact pill-shaped label used in the /docs/[id] hero meta-row and
// elsewhere in the dashboard. Three variants:
//
//   default — paper-2 bg, line border, graphite mono text. The plain
//             tag for non-status info (doc type, version, etc).
//   live    — pistachio bg with an animated good-dot. Used for the
//             "Live" indicator when a viewer has heart-beated within
//             the last 60s.
//   muted   — transparent bg, lighter text. For low-emphasis hints
//             that shouldn't pull the eye.
//
// Designed to wrap any content — text, leading icon (`icon` prop), or
// both. Mono uppercase typography matches our existing JetBrains Mono
// kicker treatment so it doesn't introduce a new typographic register.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { PulsingDot } from './PulsingDot';

interface ChipProps {
  variant?: 'default' | 'live' | 'muted';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Chip({ variant = 'default', icon, children, className }: ChipProps) {
  const base =
    'inline-flex items-center gap-1.5 rounded-full font-mono text-[10.5px] uppercase tracking-[0.14em] whitespace-nowrap';
  const variants: Record<NonNullable<ChipProps['variant']>, string> = {
    default: 'border border-line bg-paper-2/60 px-3 py-1 text-graphite',
    live: 'bg-pop px-3 py-1 font-semibold text-pop-ink',
    muted: 'px-2 py-1 text-graphite',
  };

  return (
    <span className={cn(base, variants[variant], className)}>
      {variant === 'live' && <PulsingDot tone="good" />}
      {icon && variant !== 'live' && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}
