// Reveal wrapper — pure CSS animation on page load with staggered delays.
//
// Why not scroll-triggered with IntersectionObserver: headless screenshot
// tools (Playwright, Puppeteer fullPage) capture page strips faster than
// IO callbacks fire. The result is content stuck at opacity 0 in
// screenshots, e2e test snapshots, search engine prerender, and so on.
// A pure CSS load animation works everywhere — including for users with
// JavaScript disabled — and the "essay fades in" feel is exactly the
// editorial register we want.
//
// For sections far below the fold the user has already scrolled past the
// animation by the time they arrive, so they see the content unanimated.
// Acceptable; the alternative (jank in screenshots, brittleness in
// crawlers) is worse.

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  delay?: number;
  /** When false, no animation — for legacy compatibility. */
  reveal?: boolean;
}

export function Reveal({
  children,
  delay = 0,
  reveal = true,
  className,
  style,
  ...rest
}: RevealProps) {
  if (!reveal) {
    return (
      <div className={cn(className)} style={style} {...rest}>
        {children}
      </div>
    );
  }

  const inline: CSSProperties = {
    animationDelay: `${delay}s`,
    ...style,
  };

  return (
    <div className={cn('animate-reveal-up', className)} style={inline} {...rest}>
      {children}
    </div>
  );
}
