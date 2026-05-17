'use client';

// Client-side effects for the v2 landing.
//
//   1. .v2-reveal IntersectionObserver — toggles `.in` class when an
//      element enters the viewport. CSS handles the actual transition.
//      Also covers .v2-pitch-card (which has its own .in styles for the
//      bar+section animations) and .v2-cta (highlight bar reveal).
//   2. Hero live tick counter — the "Active read · NNs" chip ticks
//      every 1.1s so the hero feels alive rather than frozen.
//   3. Controls auto-demo — cycles through the 5 per-share controls
//      every 2.4s so the user sees each one highlighted. Stops the
//      ambiguity of "what does this section do."
//
// What was removed: swiper horizontal scroll handler. The workflow
// section replaced the swiper, and uses pure CSS animations (packet
// flow on dotted connectors) — no scroll-driven transforms, no
// requestAnimationFrame, no chance of the sticky-pin glitching.

import { useEffect } from 'react';

export function LandingEffects() {
  useEffect(() => {
    // Reveal observer. threshold:0 + no rootMargin means the moment ANY
    // part of an element enters the viewport, it animates. The previous
    // 18%-visible-with-bottom-rootMargin gate left tall sections
    // permanently invisible because the user could see the top but the
    // gate hadn't fired yet.
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            revealObserver.unobserve(e.target);
          }
        }
      },
      { threshold: 0 },
    );
    const revealTargets = document.querySelectorAll('.v2-reveal, .v2-pitch-card, .v2-cta');
    revealTargets.forEach((el) => revealObserver.observe(el));

    // Safety net: if for any reason an element doesn't get observed
    // (e.g. it's already fully in view at page load, IO doesn't fire,
    // browser quirk), force `.in` on everything after 2.5s. The animation
    // is one-shot and visually consistent — no harm if it re-fires.
    const safetyTimer = setTimeout(() => {
      revealTargets.forEach((el) => el.classList.add('in'));
    }, 2500);

    // Hero live tick
    const heroTick = document.getElementById('v2-heroTick');
    let heroSec = 14;
    const heroInterval = setInterval(() => {
      heroSec = ((heroSec - 14 + 1) % 50) + 14;
      if (heroTick) heroTick.textContent = heroSec + 's';
    }, 1100);

    // Controls auto-demo
    const controlItems = document.querySelectorAll<HTMLElement>('.v2-ctrl-item');
    let demoIdx = 0;
    let demoInterval: ReturnType<typeof setInterval> | null = null;
    let demoStarted = false;
    const startDemo = () => {
      if (demoStarted || controlItems.length === 0) return;
      demoStarted = true;
      const step = () => {
        controlItems.forEach((it) => it.classList.remove('active'));
        const cur = controlItems[demoIdx % controlItems.length];
        if (cur) cur.classList.add('active');
        demoIdx += 1;
      };
      step();
      demoInterval = setInterval(step, 2400);
    };
    const demoObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) startDemo();
      },
      { threshold: 0.25 },
    );
    const demoTarget = document.querySelector('.v2-ctrl-grid');
    if (demoTarget) demoObserver.observe(demoTarget);

    return () => {
      revealObserver.disconnect();
      demoObserver.disconnect();
      clearTimeout(safetyTimer);
      clearInterval(heroInterval);
      if (demoInterval) clearInterval(demoInterval);
    };
  }, []);

  return null;
}
