// "Who's reading." / "Shares." / "At a glance." section headers on the
// document dashboard. Big serif title on the left, optional mono hint
// (small caps, graphite) on the right. Used between major regions of
// /docs/[id] to give the page a deliberate editorial rhythm.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SectionHeadProps {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  // `as` lets the caller render this as h2 or h3 depending on
  // hierarchy. Default h2 matches the most common case (a section
  // header below the document h1).
  as?: 'h2' | 'h3';
}

export function SectionHead({ title, hint, className, as: As = 'h2' }: SectionHeadProps) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <As className="text-letterpress font-serif text-[32px] font-normal leading-[1] tracking-tightest text-ink md:text-[36px]">
        {title}
      </As>
      {hint && (
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          {hint}
        </span>
      )}
    </div>
  );
}
