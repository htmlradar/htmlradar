// Section titles must read the way a human wrote them. A slide-number
// element next to the heading text was previously concatenated with no
// separator ("03How it works") because textContent drops the boundary.
import { afterEach, describe, expect, it } from 'vitest';
import { SectionTracker } from '../src/sections-v2.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function discover(html: string): Array<{ id: string; title: string }> {
  document.body.innerHTML = html;
  const tracker = new SectionTracker({ selector: '.nope', boundaryOffsetPx: 0, minDwellMs: 0 });
  tracker.start();
  // snapshot() only lists sections that have been entered; read discovery directly.
  const internal = tracker as unknown as { sections: Array<{ id: string; title: string }> };
  const out = internal.sections.map((s) => ({ id: s.id, title: s.title }));
  tracker.stop();
  return out;
}

describe('sections-v2 title text', () => {
  it('headings strategy: strips the slide-number span, keeps the historical slug', () => {
    const out = discover(`
      <h2><span class="num">03</span>How it works</h2>
      <h2><span class="num">04</span>Market</h2>
      <h2>5 ways to cut churn</h2>
    `);
    // A number in plain text is part of the title; only a numeric child element is stripped.
    expect(out.map((s) => s.title)).toEqual(['How it works', 'Market', '5 ways to cut churn']);
    // Section ids are derived from raw textContent and must not move.
    expect(out.map((s) => s.id)).toEqual(['03how-it-works', '04market', '5-ways-to-cut-churn']);
  });

  it('slides strategy: number in heading, number as sibling, nested inline markup', () => {
    const out = discover(`
      <div class="slide"><h4><span class="num">03</span>How it works</h4></div>
      <div class="slide"><div class="num">04</div><h4>Market</h4></div>
      <div class="slide"><h4>How <em>it</em> <a href="#">works</a> today</h4></div>
      <div class="slide"><div class="slide-title"><span>12</span><span>Contact</span></div></div>
    `);
    expect(out.map((s) => s.title)).toEqual([
      'How it works',
      'Market',
      'How it works today',
      'Contact',
    ]);
    expect(out.map((s) => s.id)).toEqual(['slide-1', 'slide-2', 'slide-3', 'slide-4']);
  });

  it('collapses whitespace and caps at 200 characters', () => {
    const long = 'x'.repeat(250);
    const out = discover(`
      <h2>  Hello
        <span>  world </span>  </h2>
      <h2>${long}</h2>
    `);
    expect(out[0]?.title).toBe('Hello world');
    expect(out[1]?.title.length).toBe(200);
  });
});
