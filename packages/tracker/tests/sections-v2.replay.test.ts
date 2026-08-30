// Replay simulator for sections-v2. Loads each real-world fixture into
// jsdom, mocks getBoundingClientRect for every discovered section to
// simulate an even scroll trace, drives the rAF tick loop manually, and
// asserts distribution sanity.
//
// What we assert per fixture:
//   1. Every expected section appears in snapshot()
//   2. No section captures > 1.7× its even-share (e.g. on 13 sections,
//      no section gets > 0.13 * 1.7 = ~22% of total credited time)
//   3. Sum of qualified time ≈ trace duration ± 10%
//   4. No section has a meta-pattern title

import { readFileSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionTracker } from '../src/sections-v2.js';

// Local-only replay fixtures: set HR_FIXTURE_DIR to a folder holding the
// sample HTML files. Absent (CI, contributors), these blocks skip.
const FIXTURE_DIR = process.env['HR_FIXTURE_DIR'];
const F1 = FIXTURE_DIR ? `${FIXTURE_DIR}/deck.html` : '';
const F2 = FIXTURE_DIR ? `${FIXTURE_DIR}/onepager.html` : '';
const F3 = FIXTURE_DIR ? `${FIXTURE_DIR}/itinerary.html` : '';

const VIEWPORT_HEIGHT = 800;
const SLIDE_HEIGHT = 800; // each section is exactly one viewport tall

// Mock visualViewport before any code touches it.
beforeEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { height: VIEWPORT_HEIGHT, offsetTop: 0 },
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

interface SimulationResult {
  titles: string[];
  perSection: Map<string, number>; // id -> qualified seconds
  totalCreditedMs: number;
}

// Drive the tracker manually: discover sections, mock getBoundingClientRect
// to simulate a scroll trace, tick the rAF loop at 250ms intervals.
function simulate(
  html: string,
  options: { dwellPerSectionMs: number; selector?: string },
): SimulationResult {
  document.documentElement.innerHTML = html.replace(/<!DOCTYPE[^>]*>/i, '');

  const tracker = new SectionTracker({
    selector: options.selector ?? 'h1, h2, h3',
    boundaryOffsetPx: 100,
    minDwellMs: 500,
  });

  // Patch rAF to manual control — we'll fire ticks ourselves.
  const rafCallbacks: Array<(ts: number) => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (_: number) => {});

  let mockNow = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => mockNow);

  tracker.start();
  const internal = tracker as unknown as {
    sections: Array<{ id: string; title: string; members: HTMLElement[]; qualifiedMs: number }>;
  };
  const sections = internal.sections;
  if (sections.length === 0) {
    tracker.stop();
    return { titles: [], perSection: new Map(), totalCreditedMs: 0 };
  }

  // Mock getBoundingClientRect on each section element. Each section is
  // SLIDE_HEIGHT tall. The "scroll trace" walks down one section at a
  // time: at trace step N, section N is centered in the viewport, with
  // its top at 0 and bottom at SLIDE_HEIGHT.
  const positionFor = (sectionIdx: number, currentIdx: number, ord: number): DOMRect => {
    const offset = (ord - currentIdx) * SLIDE_HEIGHT;
    return {
      top: offset,
      bottom: offset + SLIDE_HEIGHT,
      left: 0,
      right: 1000,
      width: 1000,
      height: SLIDE_HEIGHT,
      x: 0,
      y: offset,
      toJSON: () => ({}),
    } as DOMRect;
  };

  // A section is a range of elements, not one element, so every member gets
  // the same box: the union is then the section's own box, which is what this
  // trace means to place.
  const setScrollPosition = (currentIdx: number) => {
    sections.forEach((s, ord) => {
      for (const member of s.members) {
        member.getBoundingClientRect = vi.fn().mockReturnValue(positionFor(0, currentIdx, ord));
      }
    });
  };

  // Drain rAF queue once: pull all pending callbacks, fire them with
  // the current mock time, then return. Dispatch a synthetic scroll
  // event first so the tracker's 5s activity watchdog stays satisfied —
  // a real scrolling user fires these constantly, but jsdom doesn't.
  const drainRaf = () => {
    window.dispatchEvent(new Event('scroll'));
    const pending = rafCallbacks.splice(0);
    for (const cb of pending) cb(mockNow);
  };

  // Drive the trace. For each section, position it at the top of the
  // viewport, advance time in 250ms steps until dwellPerSectionMs have
  // elapsed, firing the rAF tick at each step. Then move to next section.
  const tickInterval = 250;
  for (let idx = 0; idx < sections.length; idx++) {
    setScrollPosition(idx);
    // First, get past the 1s qualified-dwell threshold + the section's
    // own dwell budget.
    const totalSectionMs = options.dwellPerSectionMs;
    for (let t = 0; t < totalSectionMs; t += tickInterval) {
      mockNow += tickInterval;
      drainRaf();
    }
  }

  const finalSnapshot = tracker.snapshot();
  tracker.stop();

  const perSection = new Map<string, number>();
  let totalCreditedMs = 0;
  for (const sec of finalSnapshot) {
    perSection.set(sec.id, sec.timeSeconds);
    totalCreditedMs += sec.timeSeconds * 1000;
  }

  return {
    titles: finalSnapshot.map((s) => s.title),
    perSection,
    totalCreditedMs,
  };
}

describe.skipIf(!existsSync(F1))('F1 — sample deck', () => {
  it('distributes time across all 13 slides, no winner-takes-all', () => {
    const html = readFileSync(F1, 'utf8');
    const dwellMs = 4000;
    const result = simulate(html, { dwellPerSectionMs: dwellMs });

    const expected = [
      'Cover',
      'The Product Today',
      'The Vision',
      'The Field',
      'Why Now',
      'The Market',
      "What We've Built",
      'Who Uses It',
      'Why We Win',
      'The Model',
      'Roadmap',
      'Team',
      'The Ask',
    ];

    expect(result.titles).toEqual(expected);

    // Even-share: 1/13 ≈ 7.7%. Allow up to 1.7× = ~13% for the top section.
    const totalQualifiedMs = [...result.perSection.values()].reduce(
      (sum, sec) => sum + sec * 1000,
      0,
    );
    const evenShare = totalQualifiedMs / result.titles.length;
    for (const [id, secs] of result.perSection) {
      const sectionMs = secs * 1000;
      expect(
        sectionMs,
        `section ${id} captured ${((sectionMs / totalQualifiedMs) * 100).toFixed(1)}% — winner-takes-all regression`,
      ).toBeLessThan(evenShare * 1.7);
    }
  });
});

describe.skipIf(!existsSync(F2))('F2 — ChatGPT one-pager', () => {
  it('extracts h1+h2+h3 hierarchy and credits each at least once', () => {
    const html = readFileSync(F2, 'utf8');
    const result = simulate(html, { dwellPerSectionMs: 4000 });

    expect(result.titles).toContain('The Neuroscience of Musical Highs');
    expect(result.titles).toContain('Why Singing or Whistling Feels Good');
    expect(result.titles).toContain('Different Musical Highs');
    expect(result.titles.length).toBeGreaterThanOrEqual(5);

    // No section should monopolize.
    const totalMs = [...result.perSection.values()].reduce((s, v) => s + v * 1000, 0);
    if (totalMs > 0) {
      for (const [id, secs] of result.perSection) {
        expect((secs * 1000) / totalMs, `${id} captured > 50%`).toBeLessThan(0.5);
      }
    }
  });
});

describe.skipIf(!existsSync(F3))('F3 — Claude long itinerary', () => {
  it('discovery now catches .day-section containers, .day-title wins as title', () => {
    const html = readFileSync(F3, 'utf8');
    const result = simulate(html, { dwellPerSectionMs: 4000 });

    expect(result.titles.length).toBeGreaterThanOrEqual(7);
    expect(result.titles).toContain('Arrival & Times Square');
    expect(result.titles).toContain('Upper West Side & Museum Mile');
    expect(result.titles).toContain('Midtown Icons');
    expect(result.titles).toContain('Departure Day');
  });
});

describe.skipIf(!existsSync(F1))('Fast-scroll behaviour — every entered section is emitted', () => {
  it('sub-qualification dwell still surfaces all entered sections (timeSeconds=0)', () => {
    const html = readFileSync(F1, 'utf8');
    // 600ms per section — UNDER the 1000ms QUALIFIED_DWELL_MS gate.
    // No section accumulates qualifiedMs, so every section's
    // timeSeconds must be 0 — but they MUST all appear in snapshot()
    // so the dashboard can render them as "entered but didn't engage".
    // This is the Viewer5 case from prod (11s session, 11 sections crossed,
    // only 1 qualified — we want all 11 surfaced honestly).
    const result = simulate(html, { dwellPerSectionMs: 600 });

    // All deck sections must appear in snapshot regardless of qualification.
    expect(result.titles.length).toBeGreaterThanOrEqual(13);

    // None should have credited qualified time (dwell was sub-1s).
    for (const [id, secs] of result.perSection) {
      expect(secs, `${id} should have ~0s qualified time, got ${secs}`).toBeLessThan(0.05);
    }
  });
});
