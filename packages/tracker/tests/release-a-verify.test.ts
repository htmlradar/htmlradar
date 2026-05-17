// Release A title-chain verification against the 3 real-world fixtures
// from docs/active/section-tracking-fixtures.md.
//
// Ground truth for each fixture is hand-curated from the source HTML.
// This test asserts that Release A's 6-layer chain (data-attr → class-
// hint → semantic-heading → largest-font → first-meaningful → "Slide N")
// produces the expected titles BEFORE the new viewport-coverage
// algorithm (Release B) is layered on top.

import { readFileSync, existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionTracker } from '../src/sections-legacy.js';

const F1 =
  'fixture.html';
const F2 = 'fixture.html';
const F3 = 'fixture.html';

function discoveredTitles(html: string): string[] {
  document.documentElement.innerHTML = html.replace(/<!DOCTYPE[^>]*>/i, '');
  const t = new SectionTracker({
    selector: 'h1, h2, h3',
    boundaryOffsetPx: 100,
    minDwellMs: 0,
  });
  t.start();
  // Force credit so snapshot returns every discovered section.
  const internal = t as unknown as { sections: { accumulatedMs: number }[] };
  for (const s of internal.sections) s.accumulatedMs = 1000;
  const titles = t.snapshot().map((s) => s.title);
  t.stop();
  return titles;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe.skipIf(!existsSync(F1))('F1 — the company pitch deck (.slide-label convention)', () => {
  it('extracts the 13 slide-label titles', () => {
    const html = readFileSync(F1, 'utf8');
    const titles = discoveredTitles(html);

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

    // Strict: every expected title appears in order.
    expect(titles).toEqual(expected);
  });
});

describe.skipIf(!existsSync(F2))('F2 — ChatGPT one-pager (clean h1/h2/h3)', () => {
  it('extracts the h-tag hierarchy with emoji preserved', () => {
    const html = readFileSync(F2, 'utf8');
    const titles = discoveredTitles(html);

    // h3s are emoji-prefixed; meta-pattern filter must not strip them
    // (length > 2 saves them from the bare-glyph guard).
    expect(titles).toContain('The Neuroscience of Musical Highs');
    expect(titles).toContain('Why Singing or Whistling Feels Good');
    expect(titles).toContain('Why Melody Hits So Hard');
    expect(titles).toContain('Different Musical Highs');
    expect(titles).toContain('Why Controlling a Crowd Feels Addictive');
    // h3s with emoji prefix
    expect(titles.some((t) => t.includes('Vocalist'))).toBe(true);
    expect(titles.some((t) => t.includes('Violinist'))).toBe(true);
    expect(titles.some((t) => t.includes('Drummer'))).toBe(true);
    expect(titles.some((t) => t.includes('EDM Artist'))).toBe(true);
  });
});

describe.skipIf(!existsSync(F3))(
  'F3 — Claude long itinerary (class-based, discovery-deferred)',
  () => {
    it('discovery returns nothing — documents the gap that Release B closes', () => {
      // F3 has zero <p>, <li>, <h1-6>, <section>, <article>. All content
      // is in <div class="day-section">. Current pickCandidates has no
      // selector that catches `.day-section`, and the prose fallback
      // requires <p>/<li>/<blockquote>. So discovery returns 0 sections.
      //
      // Release A does NOT widen discovery (post-mortem §3 — discovery
      // widening is part of Release B alongside the v2 algorithm). The
      // assertion below pins down the current behaviour so it doesn't
      // change silently. Flip this to expect.toBeGreaterThan(0) when
      // discovery widening lands.
      const html = readFileSync(F3, 'utf8');
      const titles = discoveredTitles(html);
      expect(titles.length).toBe(0);
    });
  },
);
