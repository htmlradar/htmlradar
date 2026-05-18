// Small status-indicator dot used inside `<Chip variant="live">` and
// the per-viewer status cell on /docs/[id]. The pulsing halo is paused
// when the user's OS has `prefers-reduced-motion: reduce` set — handled
// by Tailwind's `motion-safe` variant.

import { cn } from '@/lib/cn';

interface PulsingDotProps {
  tone?: 'good' | 'signal';
  size?: 'sm' | 'md';
  className?: string;
}

export function PulsingDot({ tone = 'good', size = 'sm', className }: PulsingDotProps) {
  const dim = size === 'sm' ? 'size-1.5' : 'size-2';
  const color = tone === 'good' ? 'bg-good' : 'bg-signal';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-full motion-safe:animate-live-pulse',
        dim,
        color,
        className,
      )}
    />
  );
}
