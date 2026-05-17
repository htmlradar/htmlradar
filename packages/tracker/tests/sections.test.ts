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

  it('auto-discovers headings without ids and slugifies their text (the company deck case)', () => {
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

  it('rejects page-number patterns and prefers actual title text (the company deck case)', () => {
    // Mimics a real-world deck where each slide has a big title in a
    // styled div (NOT a semantic h1) plus a small "01 / 14" footer.
    // Old naive extractSlideTitle returned the footer; new logic must
    // return the styled title via font-size detection.
    setupDom(`
      <section class="slide">
        <div style="font-size: 64px">The Model</div>
        <span style="font-size: 12px">01 / 14</span>
      </section>
      <section class="slide">
        <div style="font-size: 64px">The Vision</div>
        <span style="font-size: 12px">02 / 14</span>
      </section>
      <section class="slide">
        <span style="font-size: 12px">03 / 14</span>
      </section>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const snap = walkThrough(t, 'section');
    const titles = snap.map((s) => s.title);
    expect(titles).toContain('The Model');
    expect(titles).toContain('The Vision');
    // Third slide has only the page number → falls all the way to "Slide N".
    expect(titles).toContain('Slide 3');
    // None of the titles should be page-number text.
    for (const t of titles) {
      expect(t).not.toMatch(/^\d+\s*\/\s*\d+$/);
    }
  });

  it('rejects various meta-text patterns as section titles', () => {
    setupDom(`
      <section><span style="font-size: 24px">Page 5 of 12</span></section>
      <section><span style="font-size: 24px">1 of 14</span></section>
      <section><span style="font-size: 24px">•</span></section>
      <section><span style="font-size: 24px">42</span></section>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const titles = walkThrough(t, 'section').map((s) => s.title);
    // All four should fall back to "Slide N" because every text node
    // is a meta-pattern.
    for (const t of titles) {
      expect(t).toMatch(/^Slide \d+$/);
    }
  });

  it('de-nests slide-container matches (the company deck: 14 slides + 14 .slide-num + 14 .slide-label)', () => {
    // Reproduces the actual pattern the user hit: every slide is
    // <div class="slide"> with children <div class="slide-num"> and
    // <div class="slide-label">. The substring selector [class*="slide"]
    // matches all 42 (14 × 3). Without de-nesting, the dashboard shows
    // 42 phantom sections instead of 14 real ones.
    setupDom(`
      <div class="deck">
        ${Array.from(
          { length: 4 },
          (_, i) => `
          <div class="slide">
            <div class="slide-num">${String(i + 1).padStart(2, '0')} / 04</div>
            <div class="slide-label">${['Cover', 'The Model', 'The Vision', 'The Ask'][i]}</div>
            <p>Some content for slide ${i + 1}.</p>
          </div>
        `,
        ).join('')}
      </div>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    // After de-nesting, only the 4 outer `.slide` divs should be
    // discovered — not 12 (4 × 3).
    const ids = walkThrough(t, '.slide')
      .map((s) => s.id)
      .sort();
    expect(ids.length).toBe(4);
    // None of the ids should be slug of "01 / 04" or "slide-num"
    // class artifacts — the title extraction picks up "Cover", "The
    // Model", etc. via the .slide-label content.
    for (const id of ids) {
      expect(id).not.toMatch(/^\d/); // not just a page-number slug
    }
  });

  it('skips headings containing only page-number text and falls through to slide containers', () => {
    // Realistic the company-deck pathology: each slide has an h2 with the
    // page indicator AND a big styled div for the actual title. The
    // heading strategy must reject the page-number h2s entirely so
    // slide-container strategy kicks in and font-size detection wins.
    setupDom(`
      <section>
        <h2>01 / 14</h2>
        <div style="font-size: 48px">Actual Title Here</div>
      </section>
      <section>
        <h2>02 / 14</h2>
        <div style="font-size: 48px">Second Real Title</div>
      </section>
    `);
    const t = new SectionTracker({
      selector: 'h1, h2, h3',
      boundaryOffsetPx: 100,
      minDwellMs: 1,
    });
    t.start();
    const titles = walkThrough(t, 'section').map((s) => s.title);
    expect(titles).toContain('Actual Title Here');
    expect(titles).toContain('Second Real Title');
    // None of the titles should be the page-number text.
    for (const t of titles) {
      expect(t).not.toMatch(/^\d+\s*\/\s*\d+$/);
    }
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
