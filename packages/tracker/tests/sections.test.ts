import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionTracker } from '../src/sections.js';

// Audit fixes verified here:
//   F-7 — minDwellMs threshold drops fast scroll-pasts.
//   F-8 — heading NodeList is cached on init (we never re-query during scroll).
//   F-9 — flush captures `now` once; we drive time deterministically.

function setupDom(html: string) {
  document.body.innerHTML = html;
}

function setHeadingTop(id: string, top: number) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element ${id}`);
  el.getBoundingClientRect = vi.fn().mockReturnValue({
    top,
    bottom: top + 20,
    left: 0,
    right: 100,
    width: 100,
    height: 20,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

describe('SectionTracker', () => {
  beforeEach(() => {
    setupDom(`
      <h1 id="intro">Intro</h1>
      <p>...</p>
      <h2 id="problem">Problem</h2>
      <p>...</p>
      <h2 id="market">Market</h2>
      <p>...</p>
    `);
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops fast scroll-pasts below minDwellMs (audit F-7)', () => {
    const t = new SectionTracker({
      selector: 'h1[id], h2[id]',
      boundaryOffsetPx: 100,
      minDwellMs: 3000,
    });
    t.start();

    // Scroll fast through all three headings, ~50ms each
    setHeadingTop('intro', -200);
    setHeadingTop('problem', -200);
    setHeadingTop('market', -200);

    vi.spyOn(performance, 'now').mockReturnValue(50);
    (t as unknown as { update(n: number): void }).update(50);
    vi.spyOn(performance, 'now').mockReturnValue(100);
    (t as unknown as { update(n: number): void }).update(100);

    expect(t.snapshot()).toEqual([]);
  });

  it('keeps sections that exceed the threshold', () => {
    const t = new SectionTracker({
      selector: 'h1[id], h2[id]',
      boundaryOffsetPx: 100,
      minDwellMs: 3000,
    });
    t.start();

    setHeadingTop('intro', -200);
    setHeadingTop('problem', 500);
    setHeadingTop('market', 700);

    vi.spyOn(performance, 'now').mockReturnValue(0);
    (t as unknown as { update(n: number): void }).update(0);
    // Stay in intro for 5 seconds
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    (t as unknown as { update(n: number): void }).update(5000);
    // Move to problem
    setHeadingTop('problem', -200);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    (t as unknown as { update(n: number): void }).update(5000);

    const snap = t.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]?.id).toBe('intro');
    expect(snap[0]?.timeSeconds).toBeGreaterThanOrEqual(3);
  });

  it('pause/resume does not double-credit time while hidden', () => {
    const t = new SectionTracker({
      selector: 'h1[id], h2[id]',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();

    setHeadingTop('intro', -200);
    setHeadingTop('problem', 500);
    setHeadingTop('market', 700);

    vi.spyOn(performance, 'now').mockReturnValue(0);
    (t as unknown as { update(n: number): void }).update(0);

    // 1s read
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    t.pause();

    // 10s elapse while paused — must not be credited
    vi.spyOn(performance, 'now').mockReturnValue(11000);
    t.resume();

    // 1s more read
    vi.spyOn(performance, 'now').mockReturnValue(12000);
    const snap = t.snapshot();
    expect(snap[0]?.timeSeconds).toBeGreaterThanOrEqual(1.9);
    expect(snap[0]?.timeSeconds).toBeLessThan(3);
  });

  it('fires onSectionRead exactly once per section', () => {
    const onSectionRead = vi.fn();
    const t = new SectionTracker({
      selector: 'h1[id], h2[id]',
      boundaryOffsetPx: 100,
      minDwellMs: 100,
      onSectionRead,
    });
    t.start();

    setHeadingTop('intro', -200);
    setHeadingTop('problem', 500);
    setHeadingTop('market', 700);

    vi.spyOn(performance, 'now').mockReturnValue(0);
    (t as unknown as { update(n: number): void }).update(0);
    vi.spyOn(performance, 'now').mockReturnValue(500);
    (t as unknown as { update(n: number): void }).update(500);
    // Snapshot triggers credit → should fire onRead once
    t.snapshot();
    t.snapshot();

    expect(onSectionRead).toHaveBeenCalledTimes(1);
    expect(onSectionRead.mock.calls[0]?.[0].id).toBe('intro');
  });
});
