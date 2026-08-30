// Section time on an ordinary scrolling document.
//
// The defect these cover (2026-08-30 flight check, defect 2): a section's
// element was its heading, about forty pixels tall, so a section stopped
// earning time the instant its heading scrolled off the top — while the
// reader was still reading it. Three reads of the same report by the same
// reader scored 4.0/0.25/3.8 s, 0.5/0.8/0 s and 4.1/14.2/9.1 s depending only
// on whether the headings happened to stay on screen.
//
// A section is now the RANGE from its heading to the element before the next
// heading of the same or higher level, and coverage is measured against the
// window once the range is taller than the window.
//
// jsdom lays nothing out, so every box here is mocked. `place` fixes an
// element in DOCUMENT coordinates and the harness subtracts the current
// scroll offset, so `scrollTo` moves every box at once the way a browser
// does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionTracker } from '../src/sections-v2.js';

const VIEWPORT = 800;
const HEADING_HEIGHT = 40;
const TICK_MS = 250;

let clock = 0;
let scrollY = 0;
const frames: Array<(ts: number) => void> = [];

function place(el: HTMLElement, top: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      top: top - scrollY,
      bottom: top + height - scrollY,
      height,
      width: 1000,
      left: 0,
      right: 1000,
      x: 0,
      y: top - scrollY,
      toJSON: () => ({}),
    }) as DOMRect;
}

function scrollTo(y: number): void {
  scrollY = y;
}

// Advance the mock clock in sample-sized steps, firing the pending
// requestAnimationFrame callback at each one. The synthetic scroll event
// keeps the tracker's five-second idle watchdog satisfied, as a real reader's
// scrolling would.
function advance(ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    clock += TICK_MS;
    window.dispatchEvent(new Event('scroll'));
    for (const frame of frames.splice(0)) frame(clock);
  }
}

function tracker(): SectionTracker {
  const t = new SectionTracker({ selector: 'h1, h2, h3', boundaryOffsetPx: 100, minDwellMs: 500 });
  t.start();
  return t;
}

function timeById(t: SectionTracker): Record<string, number> {
  const out: Record<string, number> = {};
  for (const section of t.snapshot()) out[section.id] = section.timeSeconds;
  return out;
}

/**
 * Three `<h2>` sections, each a heading plus one body paragraph, stacked in
 * document order. Returns the document-coordinate top of each heading.
 */
function threeSections(bodyHeight: number): number[] {
  document.body.innerHTML = `
    <h2 id="one">Section one</h2><p id="one-body">First.</p>
    <h2 id="two">Section two</h2><p id="two-body">Second.</p>
    <h2 id="three">Section three</h2><p id="three-body">Third.</p>`;
  const tops: number[] = [];
  let top = 0;
  for (const name of ['one', 'two', 'three']) {
    tops.push(top);
    place(document.getElementById(name)!, top, HEADING_HEIGHT);
    top += HEADING_HEIGHT;
    place(document.getElementById(`${name}-body`)!, top, bodyHeight);
    top += bodyHeight;
  }
  return tops;
}

beforeEach(() => {
  clock = 1000;
  scrollY = 0;
  frames.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { height: VIEWPORT, offsetTop: 0 },
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a section is its range, not its heading', () => {
  it('credits each of three viewport-taller sections the time spent in it', () => {
    // Each section is 2040 px: two and a half windows. Under the old rule no
    // section could ever put half of ITSELF on screen, and the heading left
    // the window after one screen of reading, so the middle of a section
    // earned nothing at all.
    const tops = threeSections(2000);
    const t = tracker();

    // Park in the body of each section in turn, well past its heading.
    for (const top of tops) {
      scrollTo(top + 1000);
      advance(10_000);
    }
    const time = timeById(t);
    t.stop();

    // One second of each ten goes to qualifying, so nine are creditable.
    for (const id of ['one', 'two', 'three']) {
      expect(time[id], `section ${id}`).toBeGreaterThan(8.5);
      expect(time[id], `section ${id}`).toBeLessThanOrEqual(9.25);
    }
    // No double counting: the total credited can never exceed the time that
    // actually passed.
    const total = Object.values(time).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(30);
  });

  it('keeps counting while the heading is off screen and only the body shows', () => {
    // The exact shape of the defect: the reader is 1500 px into a section, so
    // its heading is far above the top of the window.
    const tops = threeSections(2000);
    const t = tracker();
    scrollTo(tops[1]! + 1500);
    advance(10_000);
    const time = timeById(t);
    t.stop();

    expect(document.getElementById('two')!.getBoundingClientRect().bottom).toBeLessThan(0);
    expect(time['two']).toBeGreaterThan(8.5);
    expect(time['one'] ?? 0).toBe(0);
    expect(time['three'] ?? 0).toBe(0);
  });

  it('qualifies a section shorter than the window that is wholly on screen', () => {
    // 340 px of section inside an 800 px window: 100% of itself is visible,
    // but only 42% of the window. Coverage is measured against the smaller of
    // the two, so it qualifies.
    threeSections(300);
    const t = tracker();
    scrollTo(340);
    advance(5000);
    const time = timeById(t);
    t.stop();

    expect(time['two']).toBeGreaterThan(3.5);
  });

  it('never credits two sections for the same second', () => {
    // Two short sections share the window. Only the one covering more of it
    // is credited, so the sum stays inside the elapsed time.
    threeSections(300);
    const t = tracker();
    scrollTo(0);
    advance(20_000);
    const time = timeById(t);
    t.stop();

    const total = Object.values(time).reduce((sum, value) => sum + value, 0);
    expect(total).toBeLessThanOrEqual(20);
    expect(total).toBeGreaterThan(15);
  });

  it('gives an h1 no credit while an h2 inside its range is being read', () => {
    // An <h1>'s range runs to the next <h1>, so it usually spans the whole
    // document and would tie at a full window with every <h2> under it.
    document.body.innerHTML = `
      <h1 id="report">Quarterly report</h1><p id="intro">Intro.</p>
      <h2 id="alpha">Alpha</h2><p id="alpha-body">Alpha body.</p>
      <h2 id="beta">Beta</h2><p id="beta-body">Beta body.</p>`;
    place(document.getElementById('report')!, 0, HEADING_HEIGHT);
    place(document.getElementById('intro')!, 40, 400);
    place(document.getElementById('alpha')!, 440, HEADING_HEIGHT);
    place(document.getElementById('alpha-body')!, 480, 2000);
    place(document.getElementById('beta')!, 2480, HEADING_HEIGHT);
    place(document.getElementById('beta-body')!, 2520, 2000);

    const t = tracker();
    scrollTo(1200); // deep inside Alpha's body
    advance(10_000);
    const time = timeById(t);
    t.stop();

    expect(time['alpha']).toBeGreaterThan(8.5);
    expect(time['report'] ?? 0).toBe(0);
    expect(time['beta'] ?? 0).toBe(0);
  });

  // Sol's review: a skipped enclosing section must not keep its streak. If it
  // did, it would arrive at the next boundary with a full second already
  // banked and take the sample the instant the subsection dropped out,
  // without ever having held the window on its own.
  it('makes a skipped enclosing section earn its own continuous second', () => {
    document.body.innerHTML = `
      <h1 id="report">Quarterly report</h1><p id="intro">Intro.</p>
      <h2 id="alpha">Alpha</h2><p id="alpha-body">Alpha body.</p>
      <h2 id="beta">Beta</h2><p id="beta-body">Beta body.</p>`;
    place(document.getElementById('report')!, 0, HEADING_HEIGHT);
    place(document.getElementById('intro')!, 40, 400);
    place(document.getElementById('alpha')!, 440, HEADING_HEIGHT);
    place(document.getElementById('alpha-body')!, 480, 2000);
    place(document.getElementById('beta')!, 2480, HEADING_HEIGHT);
    place(document.getElementById('beta-body')!, 2520, 2000);

    const t = tracker();
    scrollTo(1200); // deep in Alpha: the report section is skipped throughout
    advance(10_000);
    scrollTo(0); // only the report's own opening qualifies now
    advance(TICK_MS);
    expect(timeById(t)['report'] ?? 0).toBe(0);

    // It does earn, once it has held the window for a second of its own.
    advance(3000);
    expect(timeById(t)['report']).toBeGreaterThan(1.5);
    t.stop();
  });

  // Sol's review, 2026-08-31, blocker one. The range used to anchor on an
  // ancestor when the heading had no sibling to grow into, which pulled that
  // ancestor's own content — everything ABOVE the heading included — into the
  // section. Here the reader is a long way inside section one's body, and the
  // old walk had section two starting above it.
  it('never starts a range above its own heading', () => {
    document.body.innerHTML = `
      <h2 id="one">Section one</h2><p id="one-body">First.</p>
      <div id="wrap"><p id="one-tail">Still first.</p><h2 id="two">Section two</h2></div>
      <p id="two-body">Second.</p>`;
    place(document.getElementById('one')!, 0, HEADING_HEIGHT);
    place(document.getElementById('one-body')!, 40, 960);
    place(document.getElementById('wrap')!, 1000, 1040);
    place(document.getElementById('one-tail')!, 1000, 1000);
    place(document.getElementById('two')!, 2000, HEADING_HEIGHT);
    place(document.getElementById('two-body')!, 2040, 2000);

    const t = tracker();
    scrollTo(1200); // the window holds nothing but section one's tail
    advance(10_000);
    const time = timeById(t);
    t.stop();

    expect(time['one']).toBeGreaterThan(8.5);
    expect(time['two'] ?? 0).toBe(0);
  });

  // Sol's review, blocker two. The walk used to step over any wrapper holding
  // the closing heading, so body content sitting inside that wrapper before
  // the heading fell out of the section entirely — leaving the section as its
  // own 40 pixels again.
  it('keeps body content that shares a wrapper with the closing heading', () => {
    document.body.innerHTML = `
      <h2 id="one">Section one</h2>
      <div id="wrap">
        <p id="one-body">First.</p>
        <h2 id="two">Section two</h2>
        <p id="two-body">Second.</p>
      </div>`;
    place(document.getElementById('one')!, 0, HEADING_HEIGHT);
    place(document.getElementById('wrap')!, 40, 4040);
    place(document.getElementById('one-body')!, 40, 2000);
    place(document.getElementById('two')!, 2040, HEADING_HEIGHT);
    place(document.getElementById('two-body')!, 2080, 2000);

    const t = tracker();
    scrollTo(1000);
    advance(10_000);
    const time = timeById(t);
    t.stop();

    expect(time['one']).toBeGreaterThan(8.5);
    expect(time['two'] ?? 0).toBe(0);
  });

  it('measures a heading whose body sits outside its wrapper', () => {
    // <section><h2>…</h2></section> followed by the body: the heading has no
    // sibling to grow into, so the range starts at the wrapper instead.
    document.body.innerHTML = `
      <section id="wrap-one"><h2 id="one">Section one</h2></section>
      <p id="one-body">First.</p>
      <section id="wrap-two"><h2 id="two">Section two</h2></section>
      <p id="two-body">Second.</p>`;
    place(document.getElementById('wrap-one')!, 0, HEADING_HEIGHT);
    place(document.getElementById('one')!, 0, HEADING_HEIGHT);
    place(document.getElementById('one-body')!, 40, 2000);
    place(document.getElementById('wrap-two')!, 2040, HEADING_HEIGHT);
    place(document.getElementById('two')!, 2040, HEADING_HEIGHT);
    place(document.getElementById('two-body')!, 2080, 2000);

    const t = tracker();
    scrollTo(1000); // heading one is off screen, its body fills the window
    advance(10_000);
    const time = timeById(t);
    t.stop();

    expect(time['one']).toBeGreaterThan(8.5);
    expect(time['two'] ?? 0).toBe(0);
  });
});

describe('slide decks are unaffected', () => {
  it('credits the slide container that fills the window', () => {
    // No headings: discovery falls through to the slide strategy, where the
    // element already is the whole section and the range reduces to it.
    document.body.innerHTML = `
      <section id="slide-a"><p>Alpha alpha alpha.</p></section>
      <section id="slide-b"><p>Beta beta beta.</p></section>
      <section id="slide-c"><p>Gamma gamma gamma.</p></section>`;
    ['slide-a', 'slide-b', 'slide-c'].forEach((id, i) => {
      place(document.getElementById(id)!, i * VIEWPORT, VIEWPORT);
    });

    const t = tracker();
    for (let i = 0; i < 3; i++) {
      scrollTo(i * VIEWPORT);
      advance(5000);
    }
    const time = timeById(t);
    t.stop();

    for (const id of ['slide-a', 'slide-b', 'slide-c']) {
      expect(time[id], `slide ${id}`).toBeGreaterThan(3.5);
      expect(time[id], `slide ${id}`).toBeLessThanOrEqual(4.25);
    }
  });
});
