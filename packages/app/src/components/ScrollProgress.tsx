'use client';

// A thin progress bar pinned to the right edge of the viewport, showing
// where the reader is in the document. Editorial / NYT-feel: long-form
// reading deserves a quiet position indicator. Uses Framer Motion's
// `useScroll` so we don't poll scroll events ourselves.

import { motion, useScroll, useSpring, useTransform } from 'framer-motion';

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();

  // Spring smooths the value so the bar doesn't jitter on fast scrolls.
  const smoothed = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  // Transform 0 → 1 into a CSS scaleY value, anchored top.
  const scaleY = useTransform(smoothed, [0, 1], [0, 1]);

  return (
    <motion.div
      aria-hidden
      style={{ scaleY, originY: 0 }}
      className="pointer-events-none fixed right-4 top-1/4 z-40 hidden h-1/2 w-px bg-signal lg:block"
    />
  );
}
