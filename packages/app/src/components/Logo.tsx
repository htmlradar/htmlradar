// HTMLRadar wordmark — single source of truth across NavBar and the
// landing nav. Previously each surface inlined its own markup (NavBar
// used `HTML<span text-signal>Radar</span>` in caps; landing used
// `HTML<i>radar</i>` lowercase) — visually different brand mark on
// the same product. This component renders the italic-lowercase form
// (the more distinctive, editorial treatment) everywhere.
//
// `HTML` is Geist 700 in ink; `radar` is the brand serif italic in
// oxblood (signal). Sizes match the landing's existing nav exactly
// so swapping in the component on the landing is pixel-equivalent.

import Link from 'next/link';
import { cn } from '@/lib/cn';

interface LogoProps {
  // When provided, wraps the wordmark in a Link. Default href on
  // signed-in surfaces is "/docs"; signed-out is "/". Caller decides.
  href?: string;
  className?: string;
  // `default` matches the landing nav (14/16px). `sm` is for compact
  // chrome — e.g. a dashboard footer credit or auth pages.
  size?: 'default' | 'sm';
}

export function Logo({ href, className, size = 'default' }: LogoProps) {
  const sizing =
    size === 'sm'
      ? { html: 'text-[13px] md:text-[14px]', ital: 'text-[14px] md:text-[15px]' }
      : { html: 'text-[14px] md:text-[16px]', ital: 'text-[15px] md:text-[17px]' };

  const content = (
    <span
      className={cn(
        'inline-flex items-baseline gap-[2px] font-bold leading-none tracking-[-0.01em] text-ink',
        sizing.html,
        className,
      )}
    >
      HTML
      <span
        className={cn(
          'font-serif font-semibold italic tracking-[-0.02em] text-signal',
          sizing.ital,
        )}
      >
        radar
      </span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-block transition-opacity hover:opacity-90"
        aria-label="HTMLradar — home"
      >
        {content}
      </Link>
    );
  }
  return content;
}
