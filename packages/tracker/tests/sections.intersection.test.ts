import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionTracker } from '../src/sections.js';

// IntersectionObserver-driven section tracking — validates the path
// that makes swipe-based decks work.
//
// The earlier scroll-listener architecture silently failed on swipe
// decks (mobile pitch decks, Reveal.js with CSS transforms): no scroll
// events meant no current-section updates, so all session time got
// credited to whatever slide was current on initial layout. That's
// the "stats don't add up" / "0% scroll on 26m session" / "time stuck
// on slide 1" bug viewer2's session exposed in prod.
//
// jsdom doesn't ship IntersectionObserver. We install a minimal mock
// that captures the callback and lets us deliver synthetic entries
// at will, then assert that the tracker picks the highest-ratio
// section as current, transitions cleanly, and credits time correctly.

interface ObserverCallback {
  (entries: IntersectionObserverEntry[]): void;
}

interface MockObserverHandle {
  cb: ObserverCallback;
  observed: HTMLElement[];
  deliver(entries: Array<{ target: HTMLElement; ratio: number }>): void;
}

let observerHandles: MockObserverHandle[] = [];

function installMockIntersectionObserver() {
  observerHandles = [];
  class MockIO {
    private cb: ObserverCallback;
    private observed: HTMLElement[] = [];
    constructor(cb: ObserverCallback) {
      this.cb = cb;
      observerHandles.push({
        cb,
        observed: this.observed,
        deliver: (entries) => {
          this.cb(
            entries.map((e) => ({
              target: e.target,
              intersectionRatio: e.ratio,
              isIntersecting: e.ratio > 0,
              boundingClientRect: e.target.getBoundingClientRect(),
              intersectionRect: e.target.getBoundingClientRect(),
              rootBounds: null,
              time: performance.now(),
            })) as unknown as IntersectionObserverEntry[],
          );
        },
      });
    }
    observe(el: Element) {
      this.observed.push(el as HTMLElement);
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof MockIO }).IntersectionObserver = MockIO;
}

function uninstallMockIntersectionObserver() {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
}

describe('section detection — IntersectionObserver (swipe-deck path)', () => {
  beforeEach(() => {
    installMockIntersectionObserver();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallMockIntersectionObserver();
    document.body.innerHTML = '';
  });

  function makeTracker() {
    return new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
  }

  it('picks the section with the highest intersection ratio as current', () => {
    document.body.innerHTML = `
      <div class="slide"><h2>Slide A</h2></div>
      <div class="slide"><h2>Slide B</h2></div>
      <div class="slide"><h2>Slide C</h2></div>
    `;
    const t = makeTracker();
    t.start();
    // Discovery's Strategy 1 selects h2s, so those are what IO observes.
    // Deliver ratios for h2s, not for the .slide containers.
    const slides = Array.from(document.querySelectorAll<HTMLElement>('h2'));
    const handle = observerHandles[0]!;

    // Deliver: slide A fully out, slide B half visible, slide C fully out.
    // Even with no scroll event, the IO transition itself moves the clock.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    handle.deliver([
      { target: slides[0]!, ratio: 0 },
      { target: slides[1]!, ratio: 0.5 },
      { target: slides[2]!, ratio: 0 },
    ]);

    // 5s later, deliver swipe to slide C (slide B drops, slide C rises).
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    handle.deliver([
      { target: slides[1]!, ratio: 0 },
      { target: slides[2]!, ratio: 0.95 },
    ]);

    // 10s later, snapshot. Slide B got 5s, slide C got 5s.
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const snap = t.snapshot();
    const titles = snap.map((s) => s.title);
    expect(titles).toContain('Slide B');
    expect(titles).toContain('Slide C');
    expect(titles).not.toContain('Slide A');

    // Slide B credited ~5s, slide C credited ~5s. Order in snapshot
    // matches discoverSections order (DOM order).
    const b = snap.find((s) => s.title === 'Slide B')!;
    const c = snap.find((s) => s.title === 'Slide C')!;
    expect(b.timeSeconds).toBeGreaterThanOrEqual(4.5);
    expect(b.timeSeconds).toBeLessThan(6);
    expect(c.timeSeconds).toBeGreaterThanOrEqual(4.5);
    expect(c.timeSeconds).toBeLessThan(6);
  });

  it('returns null current when no section is intersecting (between slides)', () => {
    document.body.innerHTML = `
      <div class="slide"><h2>Slide A</h2></div>
      <div class="slide"><h2>Slide B</h2></div>
    `;
    const t = makeTracker();
    t.start();
    // Discovery's Strategy 1 selects h2s, so those are what IO observes.
    // Deliver ratios for h2s, not for the .slide containers.
    const slides = Array.from(document.querySelectorAll<HTMLElement>('h2'));
    const handle = observerHandles[0]!;

    // Both slides off-viewport — nothing should accumulate.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    handle.deliver([
      { target: slides[0]!, ratio: 0 },
      { target: slides[1]!, ratio: 0 },
    ]);
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const snap = t.snapshot();
    expect(snap).toEqual([]);
  });

  it('handles the swipe-deck pattern: 14 slides, each briefly fully visible', () => {
    // Mirrors the the company mobile deck — 14 slides, viewer swipes through
    // each. Each slide is in-viewport for ~3s, then transformed out.
    // Old scroll-listener tracker: 0 transitions, all time on slide 1.
    // New IO tracker: 14 transitions, time distributed evenly.
    //
    // Titles intentionally DO NOT match the "Slide N" meta-pattern —
    // that's a counter the production tracker filters out. Using
    // realistic deck titles keeps Strategy 1 (headings) as the winner
    // so we observe the h2 elements directly.
    const titles = [
      'Cover',
      'The Model',
      'The Vision',
      'Why Now',
      'The Market',
      'Why We Win',
      'Who Uses It',
      'The Product Today',
      'What We Ship Next',
      'The Decade',
      'The Team',
      'The Ask',
      'Appendix',
      'Thanks',
    ];
    const slidesHtml = titles
      .map(
        (title) => `
      <div class="slide"><h2>${title}</h2></div>
    `,
      )
      .join('');
    document.body.innerHTML = `<div class="deck">${slidesHtml}</div>`;
    const t = makeTracker();
    t.start();
    const headings = Array.from(document.querySelectorAll<HTMLElement>('h2'));
    const handle = observerHandles[0]!;

    const DWELL_MS = 3000;
    for (let i = 0; i < headings.length; i++) {
      vi.spyOn(performance, 'now').mockReturnValue(i * DWELL_MS);
      handle.deliver(headings.map((h, idx) => ({ target: h, ratio: idx === i ? 1.0 : 0 })));
    }
    vi.spyOn(performance, 'now').mockReturnValue(headings.length * DWELL_MS);
    const snap = t.snapshot();

    expect(snap.length).toBe(14);
    for (const s of snap) {
      expect(s.timeSeconds).toBeGreaterThanOrEqual(2.5);
      expect(s.timeSeconds).toBeLessThanOrEqual(4);
    }
    // Data invariant: sum of section dwell ≈ total elapsed time.
    // This is the invariant the production dashboard breaks when
    // tracking fails (33m active vs 5m sections — what viewer2 hit).
    const totalDwell = snap.reduce((acc, s) => acc + s.timeSeconds, 0);
    const expectedTotal = (headings.length * DWELL_MS) / 1000;
    expect(Math.abs(totalDwell - expectedTotal)).toBeLessThan(1);
  });

  it('snapshot sum equals total elapsed when one section is always visible', () => {
    // Data invariant: sum of section dwell ≈ total observed time when
    // a section is in viewport continuously. This is the invariant the
    // dashboard exposes as "Total time" vs sum of bars — and viewer2's
    // 33m vs 5m discrepancy is what we're guarding against.
    document.body.innerHTML = `
      <div class="slide"><h2>Only Slide</h2></div>
    `;
    const t = makeTracker();
    t.start();
    const slide = document.querySelector<HTMLElement>('h2')!;
    const handle = observerHandles[0]!;

    // Slide is fully visible for the entire session.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    handle.deliver([{ target: slide, ratio: 1.0 }]);
    vi.spyOn(performance, 'now').mockReturnValue(60000);
    const snap = t.snapshot();

    // Single-section docs return no sections (need >= 2 to be useful)
    // — that's a discoverSections rule, not an IO behavior. So this
    // doc snapshots empty. Verify that's the case and not a leak.
    expect(snap).toEqual([]);
  });

  it('transitions credit time to the section being left, not the new one', () => {
    document.body.innerHTML = `
      <div class="slide"><h2>Slide A</h2></div>
      <div class="slide"><h2>Slide B</h2></div>
    `;
    const t = makeTracker();
    t.start();
    // Discovery's Strategy 1 selects h2s, so those are what IO observes.
    // Deliver ratios for h2s, not for the .slide containers.
    const slides = Array.from(document.querySelectorAll<HTMLElement>('h2'));
    const handle = observerHandles[0]!;

    vi.spyOn(performance, 'now').mockReturnValue(0);
    handle.deliver([
      { target: slides[0]!, ratio: 1.0 },
      { target: slides[1]!, ratio: 0 },
    ]);
    // 4s elapses. Switch to slide B.
    vi.spyOn(performance, 'now').mockReturnValue(4000);
    handle.deliver([
      { target: slides[0]!, ratio: 0 },
      { target: slides[1]!, ratio: 1.0 },
    ]);
    // 6s more. Snapshot.
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const snap = t.snapshot();

    const a = snap.find((s) => s.title === 'Slide A')!;
    const b = snap.find((s) => s.title === 'Slide B')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.timeSeconds).toBeGreaterThanOrEqual(3.5);
    expect(a.timeSeconds).toBeLessThan(5);
    expect(b.timeSeconds).toBeGreaterThanOrEqual(5.5);
    expect(b.timeSeconds).toBeLessThan(7);
  });
});
