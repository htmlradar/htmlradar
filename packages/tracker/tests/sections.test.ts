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

  // Helper: walk through `selector` matches one-by-one, dwelling 2s in
  // each. Returns the snapshot once all have been credited. Encodes the
  // "only-the-current-section-accumulates" rule of the tracker — the
  // boundary walks DOM order, the last crossing wins, so we have to
  // ratchet positions forward in time.
  function walkThrough(t: SectionTracker, selector: string, dwellMs = 2000) {
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const updateFn = (t as unknown as { update(n: number): void }).update.bind(t);
    const setTops = (currentIdx: number) => {
      els.forEach((el, i) => {
        const top = i <= currentIdx ? -200 : 500;
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
      });
    };
    for (let i = 0; i < els.length; i++) {
      setTops(i);
      vi.spyOn(performance, 'now').mockReturnValue(i * dwellMs);
      updateFn(i * dwellMs);
    }
    // Final tick: snapshot picks up the last-current's dwell.
    vi.spyOn(performance, 'now').mockReturnValue(els.length * dwellMs);
    return t.snapshot();
  }

  it('auto-discovers headings without ids and slugifies their text (Example Co deck case)', () => {
    setupDom(`
      <h1>Now it executes</h1>
      <p>...</p>
      <h2>The product today</h2>
      <p>...</p>
      <h2>Live 6 months</h2>
    `);
    const t = new SectionTracker({
      // Default-broad selector — what the runtime config now uses.
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'h1, h2')
      .map((s) => s.id)
      .sort();
    expect(ids).toContain('now-it-executes');
    expect(ids).toContain('the-product-today');
    expect(ids).toContain('live-6-months');
  });

  it('disambiguates duplicate slug ids with -2, -3 suffixes', () => {
    setupDom(`<h2>Findings</h2><p>...</p><h2>Findings</h2><p>...</p><h2>Findings</h2>`);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'h2')
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['findings', 'findings-2', 'findings-3']);
  });

  it('falls back to slide containers when there are no headings', () => {
    setupDom(`
      <section class="slide"><p>Cover slide</p></section>
      <section class="slide"><p>Second slide</p></section>
      <section class="slide"><p>Closing slide</p></section>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'section')
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['slide-1', 'slide-2', 'slide-3']);
  });

  it('prefers headings strategy when both headings AND slide containers exist', () => {
    setupDom(`
      <section class="slide">
        <h2>Real heading one</h2>
        <p>...</p>
      </section>
      <section class="slide">
        <h2>Real heading two</h2>
        <p>...</p>
      </section>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'h2')
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['real-heading-one', 'real-heading-two']);
  });

  it('respects explicit id attributes over auto-slugging', () => {
    setupDom(`
      <h2 id="custom-anchor">Section A</h2>
      <p>...</p>
      <h2 id="another-anchor">Section B</h2>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'h2')
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['another-anchor', 'custom-anchor']);
  });

  it('falls back to prose-paragraph buckets when no headings or slide containers exist', () => {
    setupDom(`
      <article>
        <p>The first paragraph introduces the topic with a real sentence here. It continues with a second sentence.</p>
        <p>Second paragraph dives into details. More details follow.</p>
        <p>Third paragraph wraps everything up neatly. The end.</p>
      </article>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'p').map((s) => s.id);
    // First-sentence slugs as ids; falls back to part-N if slugify yields empty.
    expect(ids.length).toBe(3);
    expect(ids[0]).toMatch(/the-first-paragraph-introduces/);
    expect(ids[1]).toMatch(/second-paragraph-dives-into-details/);
    expect(ids[2]).toMatch(/third-paragraph-wraps-everything-up-neatly/);
  });

  it('buckets a long prose doc into <= 8 sections (one anchor per bucket)', () => {
    // 24 paragraphs → expect 8 buckets (every 3rd paragraph anchors a bucket)
    const html = Array.from(
      { length: 24 },
      (_, i) =>
        `<p>Paragraph number ${i + 1} of the essay has substance. It continues to elaborate.</p>`,
    ).join('');
    setupDom(`<article>${html}</article>`);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    // Walk through exactly the prose anchors (paragraphs at indexes 0,3,6,...).
    const allParagraphs = Array.from(document.querySelectorAll<HTMLElement>('p'));
    const updateFn = (t as unknown as { update(n: number): void }).update.bind(t);
    const setTops = (currentIdx: number) => {
      allParagraphs.forEach((el, i) => {
        const top = i <= currentIdx ? -200 : 500;
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
      });
    };
    for (let i = 0; i < allParagraphs.length; i++) {
      setTops(i);
      vi.spyOn(performance, 'now').mockReturnValue(i * 200);
      updateFn(i * 200);
    }
    vi.spyOn(performance, 'now').mockReturnValue(allParagraphs.length * 200);
    const ids = t.snapshot().map((s) => s.id);
    // Exactly 8 buckets, slugged from each bucket-anchor's first sentence.
    expect(ids.length).toBe(8);
    expect(ids[0]).toMatch(/paragraph-number-1/);
  });

  it('ignores prose paragraphs inside chrome (nav, footer, aside)', () => {
    setupDom(`
      <nav><p>Navigation paragraph that should NOT count as a section anchor.</p></nav>
      <footer><p>Footer paragraph that should also be excluded from sections.</p></footer>
      <article>
        <p>Real body paragraph one with actual content for the reader to consume.</p>
        <p>Real body paragraph two continues the story for them with more substance.</p>
      </article>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const ids = walkThrough(t, 'article p').map((s) => s.id);
    expect(ids.length).toBe(2);
    expect(ids[0]).toMatch(/real-body-paragraph-one/);
    expect(ids[1]).toMatch(/real-body-paragraph-two/);
  });

  it('returns no sections when the doc has no structure AND no real prose', () => {
    setupDom(`<div>x</div>`);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    expect(t.snapshot()).toEqual([]);
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
