'use client';

// Subtle warm glow that follows the cursor with a lag. On a warm-cream
// page, this looks like sunlight through a window rather than the
// over-decorative "neon mouse trail" pattern. Disabled on touch devices
// (no cursor) and respects reduced-motion.
//
// Only renders inside containers wearing the `.cursor-glow-zone` class,
// so we can scope it to the hero rather than haunting the whole page.

import { useEffect, useRef } from 'react';

export function CursorGlow() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 3;
    let tx = x;
    let ty = y;
    let rafId = 0;

    const move = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };
    window.addEventListener('mousemove', move);

    const tick = () => {
      // Ease toward the cursor target — gives the glow a satisfying lag.
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      if (ref.current) {
        ref.current.style.transform = `translate3d(${x - 240}px, ${y - 240}px, 0)`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', move);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-0 hidden h-[480px] w-[480px] rounded-full md:block"
      style={{
        background:
          'radial-gradient(circle at center, rgba(122,31,46,0.08) 0%, rgba(217,181,176,0.05) 35%, transparent 65%)',
        filter: 'blur(20px)',
        willChange: 'transform',
      }}
    />
  );
}
