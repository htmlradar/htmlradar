import type { SectionInfo } from './types.js';

interface Section {
  id: string;
  title: string;
  depth: number;
  ordinal: number;
  element: HTMLElement;
  accumulatedMs: number;
  hasReadFired: boolean;
}

interface Options {
  selector: string;
  boundaryOffsetPx: number;
  minDwellMs: number;
  onSectionEnter?: (info: SectionInfo) => void;
  onSectionRead?: (info: SectionInfo) => void;
}

// Heading-based section-dwell tracker.
//
// Per-section dwell accumulates only when the section is the *current* one
// (most-recently-scrolled-past heading) and the tab is visible. On any
// transition we credit elapsed time to the section we just left. Sections
// below the configured `minDwellMs` threshold are dropped at flush time —
// this is the fix for audit F-7 (fast-scroll crediting every section ~16ms).
export class SectionTracker {
  private readonly opts: Options;
  private readonly sections: Section[] = [];
  private currentId: string | null = null;
  private currentStartMs: number | null = null;
  private rafScheduled = false;
  private active = false;
  // Live intersection ratios — updated by IntersectionObserver callbacks.
  // The element with the highest ratio at any moment is the "current"
  // section. This is independent of scroll events, so it works on
  // swipe-based decks (mobile pitch decks, Reveal.js with transforms),
  // transform-driven slide changes, and traditional vertical scroll
  // alike. The old scroll-listener-with-bounding-rect approach silently
  // failed on swipe decks: no scroll events meant no current-section
  // updates, leaving all session time credited to whatever was current
  // when the page first loaded (often slide 1) — that's the "stats
  // don't add up" / "0% scroll on 26m session" bug from launch QA.
  private readonly intersectionByElement = new WeakMap<HTMLElement, number>();
  private intersectionObserver: IntersectionObserver | null = null;

  constructor(opts: Options) {
    this.opts = opts;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.discoverSections();
    this.installObserver();
    // Scroll listener is still useful as a fallback signal — some
    // intersection callbacks don't fire on initial layout, and a
    // synthetic scroll tick after start ensures we credit the
    // first-visible section immediately.
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.update(performance.now());
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.creditCurrent(performance.now());
    window.removeEventListener('scroll', this.onScroll);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
  }

  pause(): void {
    this.creditCurrent(performance.now());
    this.currentStartMs = null;
  }

  resume(): void {
    if (this.currentId !== null) {
      this.currentStartMs = performance.now();
    }
  }

  // Returns all sections meeting the dwell threshold. Used by session.flush().
  snapshot(): SectionInfo[] {
    this.creditCurrent(performance.now());
    if (this.currentId !== null) {
      // Restart the clock so we don't double-credit on next snapshot.
      this.currentStartMs = performance.now();
    }
    return this.sections
      .filter((s) => s.accumulatedMs >= this.opts.minDwellMs)
      .map((s) => ({
        id: s.id,
        title: s.title,
        depth: s.depth,
        ordinal: s.ordinal,
        timeSeconds: s.accumulatedMs / 1000,
      }));
  }

  // Four-tier auto-detection. We try strategies in priority order and
  // stop at the first one that finds >= 2 candidates. Designed so the
  // tracker produces meaningful "Sections read" data on any doc shape
  // — semantic headings, slide decks, OR pure prose — without forcing
  // the sender to author `id` attributes anywhere.
  //
  // Strategy 1: configured selector (default `h1, h2, h3`).
  // Strategy 2: bare `h1, h2, h3` — kicks in when the host passed a
  //             stricter selector that found < 2.
  // Strategy 3: slide / page containers — `section`, `article`,
  //             `[class*="slide"]`, `[class*="page"]`, `[data-slide]`,
  //             `[data-page]`. Catches Reveal.js / Slidev / PDF exports.
  // Strategy 4: prose paragraphs — when nothing structural is found,
  //             we group paragraph blocks into <= 8 sections, using
  //             the FIRST SENTENCE of each chunk's anchor paragraph
  //             as the section title. Stops a plain-text doc from
  //             showing "no section data" — the sender still gets
  //             "they read 32s in the middle third" insight.
  //
  // Sticky / fixed positioned candidates are filtered out: they never
  // leave the viewport so they'd be perpetually "current".
  private discoverSections(): void {
    const candidates = pickCandidates(this.opts.selector);
    const seenIds = new Map<string, number>();

    candidates.elements.forEach((el, i) => {
      let id = el.id;
      if (!id) {
        if (candidates.strategy === 'slides') {
          id = `slide-${i + 1}`;
        } else if (candidates.strategy === 'prose') {
          // Prose buckets — title is the first sentence; id is its slug.
          const title = firstSentence((el.textContent ?? '').trim());
          id = slugify(title) || `part-${i + 1}`;
        } else {
          id = slugify((el.textContent ?? '').trim()) || `section-${i + 1}`;
        }
      }
      // Disambiguate accidental collisions (e.g. two slides with the
      // same first heading text). The first wins its base id, the rest
      // get `-2`, `-3`, …
      const count = (seenIds.get(id) ?? 0) + 1;
      seenIds.set(id, count);
      if (count > 1) id = `${id}-${count}`;

      let title: string;
      if (candidates.strategy === 'slides') {
        title = extractSlideTitle(el, i + 1);
      } else if (candidates.strategy === 'prose') {
        title = firstSentence((el.textContent ?? '').trim()) || `Part ${i + 1}`;
      } else {
        // Headings strategy: el IS the heading. Normalize whitespace so
        // <br> / nested <span> / multiline source don't produce mashed
        // text like "Why SingingorWhistling" or trailing newlines.
        title = cleanWhitespace(el.textContent ?? '').slice(0, 200) || `Section ${i + 1}`;
      }

      this.sections.push({
        id,
        title,
        depth:
          candidates.strategy === 'slides' || candidates.strategy === 'prose'
            ? 1
            : depthFromTag(el.tagName),
        ordinal: i,
        element: el,
        accumulatedMs: 0,
        hasReadFired: false,
      });
    });
  }

  private onScroll = (): void => {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.update(performance.now());
    });
  };

  private update(nowMs: number): void {
    const next = this.computeCurrent();
    if (next === this.currentId) return;

    this.creditCurrent(nowMs);
    this.currentId = next;
    this.currentStartMs = next === null ? null : nowMs;

    if (next !== null) {
      const section = this.sections.find((s) => s.id === next);
      if (section && this.opts.onSectionEnter) {
        this.opts.onSectionEnter(toInfo(section));
      }
    }
  }

  private creditCurrent(nowMs: number): void {
    if (this.currentId === null || this.currentStartMs === null) return;
    const elapsed = nowMs - this.currentStartMs;
    if (elapsed <= 0) return;

    const section = this.sections.find((s) => s.id === this.currentId);
    if (!section) return;
    section.accumulatedMs += elapsed;

    if (!section.hasReadFired && section.accumulatedMs >= this.opts.minDwellMs) {
      section.hasReadFired = true;
      if (this.opts.onSectionRead) this.opts.onSectionRead(toInfo(section));
    }
  }

  // Install an IntersectionObserver over every discovered section.
  // Each entry's intersectionRatio is stored in `intersectionByElement`.
  // The IO callback also triggers `update()` so transitions happen the
  // moment a section's visibility changes — no waiting for the next
  // scroll event. This is the path that makes swipe decks work: when
  // slide 2's CSS transform brings it into the viewport, IO fires with
  // ratio > 0, slide 1's ratio drops to 0, and computeCurrent picks
  // slide 2 immediately.
  private installObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      // Old browsers (or jsdom without the polyfill) — fall back to the
      // scroll-listener path. computeCurrent will use the rect-based
      // heuristic below.
      return;
    }
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          this.intersectionByElement.set(entry.target as HTMLElement, entry.intersectionRatio);
        }
        this.update(performance.now());
      },
      // Multi-threshold gives smooth updates as the slide enters/exits.
      // Without these, IO only fires when the element crosses the
      // root/0% boundary, and we'd miss "this is now the most-visible"
      // transitions on swipe decks where slides overlap mid-transition.
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.95, 1.0] },
    );
    for (const section of this.sections) {
      this.intersectionObserver.observe(section.element);
    }
  }

  // Pick the "current" section. Strategy:
  //   1. If the IntersectionObserver has reported ratios, pick the
  //      section with the highest ratio (must be > 0). This works on
  //      every layout — vertical scroll, horizontal swipe, transform-
  //      driven, even animated slide-in.
  //   2. If no IO data yet (very early in start(), or no IO support),
  //      fall back to the rect-based boundary walk used by the old
  //      tracker. Same semantics as before: last section whose top
  //      crossed the configured boundary line.
  //
  // Ties (rare — two sections with equal ratio) go to the earlier
  // section in DOM order, matching reading direction.
  private computeCurrent(): string | null {
    let bestId: string | null = null;
    let bestRatio = 0;
    let anyIntersectionSeen = false;
    for (const section of this.sections) {
      const ratio = this.intersectionByElement.get(section.element);
      if (ratio === undefined) continue;
      anyIntersectionSeen = true;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = section.id;
      }
    }
    if (anyIntersectionSeen) {
      // Ratio of 0 means nothing is in viewport — return null so we
      // don't credit time to a section the reader isn't looking at.
      return bestRatio > 0 ? bestId : null;
    }

    // Fallback path: no IO data. Use the rect-based heuristic.
    const boundary = this.opts.boundaryOffsetPx;
    let current: string | null = null;
    for (const section of this.sections) {
      const top = section.element.getBoundingClientRect().top;
      if (top - boundary <= 0) {
        current = section.id;
      } else {
        break;
      }
    }
    return current;
  }
}

function depthFromTag(tag: string): number {
  switch (tag) {
    case 'H1':
      return 1;
    case 'H2':
      return 2;
    case 'H3':
      return 3;
    default:
      return 4;
  }
}

// Auto-discovery candidate picker. Filters out elements whose computed
// position is `fixed` or `sticky` — those never leave the viewport and
// would lock the "current section" computation.
type Strategy = 'configured' | 'headings' | 'slides' | 'prose';
function pickCandidates(configured: string): { elements: HTMLElement[]; strategy: Strategy } {
  const isAnchored = (el: HTMLElement): boolean => {
    try {
      const p = getComputedStyle(el).position;
      return p === 'fixed' || p === 'sticky';
    } catch {
      return false;
    }
  };

  // Strategy 1: explicit configured selector.
  // Filter out meta-text candidates — a heading that just says "01 / 14"
  // is not a real section title. Without this filter, Strategy 1 wins
  // with garbage anchors and downstream extraction never gets a shot.
  let elements = Array.from(document.querySelectorAll<HTMLElement>(configured)).filter(
    (el) => !isAnchored(el) && !isMetaPattern(cleanWhitespace(el.textContent ?? '')),
  );
  if (elements.length >= 2) {
    return { elements, strategy: 'configured' };
  }

  // Strategy 2: any heading regardless of id (same meta filter).
  elements = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3')).filter(
    (el) => !isAnchored(el) && !isMetaPattern(cleanWhitespace(el.textContent ?? '')),
  );
  if (elements.length >= 2) {
    return { elements, strategy: 'headings' };
  }

  // Strategy 3: slide / page containers — covers Reveal.js / Slidev / PDF
  // exports / custom decks. We deliberately do NOT include bare `div`s
  // here; that would over-match on most content pages.
  //
  // The `[class*="slide"]` selector is necessarily loose — it has to
  // catch `.slide`, `.reveal-slide`, `.slidev-page`, etc. — so it WILL
  // also match nested decoration like `.slide-num`, `.slide-label`,
  // `.slide-footer`. De-nest after collection: a candidate that's a
  // descendant of another candidate is a child decoration, not a real
  // slide container. Keep only the outermost matches.
  elements = dedupeNested(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        // Slide / page containers spanning every exporter we've seen:
        //   • Reveal.js / Slidev / hand-coded: <section>, <article>
        //   • Substring-class names: .slide, .reveal-slide, .slidev-page,
        //     .pitch-slide, .page, ._page_abc (Canva exports)
        //   • Data attrs: [data-slide], [data-page] (custom decks)
        //   • PDF exporters: pdf2htmlEX uses .pf + [data-page-no];
        //     PDF.js uses [data-page-number]. Adding both keeps PDF-
        //     to-HTML docs from falling through to prose fallback.
        'section, article, [class*="slide"], [class*="page"], [data-slide], [data-page], [data-page-no], [data-page-number]',
      ),
    ).filter((el) => !isAnchored(el)),
  );
  if (elements.length >= 2) {
    return { elements, strategy: 'slides' };
  }

  // Strategy 4: prose paragraphs. Last-resort fallback for docs with
  // no semantic structure (a plain essay, a long memo, an extracted
  // PDF dumped as text). We bucket all real paragraphs into <= 8
  // chunks — each chunk's anchor element is its FIRST paragraph; the
  // section title is the first sentence of that anchor. Keeps the
  // number of sections sane on a 50-paragraph essay, and gives the
  // sender per-third / per-fifth read insight even with zero markup.
  //
  // Excludes paragraphs inside chrome (nav, footer, aside, header) so
  // sidebar copy doesn't pollute the section list.
  const proseAnchors = collectProseAnchors(isAnchored);
  if (proseAnchors.length >= 2) {
    return { elements: proseAnchors, strategy: 'prose' };
  }

  return { elements: [], strategy: 'configured' };
}

// Filter out candidates that are DOM descendants of other candidates
// in the same set. After this pass only "outermost" matches remain —
// which is what we want for slide containers, where the real slide is
// always the outermost element. The sample deck would otherwise
// return 14 real `<div class="slide">` blocks PLUS 14 `.slide-num`
// PLUS 14 `.slide-label` children = 42 phantom sections.
function dedupeNested(elements: HTMLElement[]): HTMLElement[] {
  if (elements.length < 2) return elements;
  // Sort by DOM position so ancestors come before descendants.
  const sorted = [...elements].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const kept: HTMLElement[] = [];
  for (const el of sorted) {
    // Skip if any already-kept element contains this one.
    const isNested = kept.some((k) => k !== el && k.contains(el));
    if (!isNested) kept.push(el);
  }
  return kept;
}

// Collects up to 8 anchor paragraphs for the prose strategy. Real text
// paragraphs only — empties, chrome, and sticky/fixed elements are
// excluded.
const MAX_PROSE_BUCKETS = 8;
const MIN_PROSE_TEXT_LEN = 40;
function collectProseAnchors(isAnchored: (el: HTMLElement) => boolean): HTMLElement[] {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('p, li, blockquote')).filter(
    (p) => {
      const text = (p.textContent ?? '').trim();
      if (text.length < MIN_PROSE_TEXT_LEN) return false;
      if (isAnchored(p)) return false;
      // Skip paragraphs nested in non-content chrome.
      const chrome = p.closest(
        'nav, footer, aside, header, [role="banner"], [role="navigation"], [role="contentinfo"], [aria-hidden="true"]',
      );
      if (chrome) return false;
      return true;
    },
  );

  if (candidates.length === 0) return [];
  if (candidates.length <= MAX_PROSE_BUCKETS) return candidates;

  // Too many paragraphs — bucket them into <= 8 by even-stride sampling.
  // Each bucket's anchor = the FIRST paragraph in that bucket; the
  // section "captures" all the dwell time between this anchor and the
  // next (via the boundary walk in computeCurrent).
  const stride = Math.ceil(candidates.length / MAX_PROSE_BUCKETS);
  const anchors: HTMLElement[] = [];
  for (let i = 0; i < candidates.length; i += stride) {
    const el = candidates[i];
    if (el) anchors.push(el);
  }
  return anchors;
}

// Extract the first sentence of arbitrary text — used to title prose
// sections. Prefers sentence-ending punctuation (. ! ?); if none is
// found within ~120 chars, falls back to the first 80 chars + ellipsis.
// Never returns more than 120 chars so the dashboard column stays clean.
function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const m = cleaned.slice(0, 200).match(/^[\s\S]{1,120}?[.!?](?=\s|$)/);
  if (m) return m[0].trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

// URL-safe slug from arbitrary text. Used to mint stable IDs from
// heading text when the author didn't write `id` attrs. Same input
// always produces the same slug, so per-section dwell aggregates
// correctly across sessions / page reloads.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Extract a slide's title from its DOM subtree.
//
// 6-layer priority chain. Order matters; first
// layer that yields non-meta text wins. The earlier 4-layer cascade
// (semantic-heading → largest-font → first-meaningful → positional)
// failed on slide-label-shape decks where the title lives in a class-
// hinted span (`.slide-label`) rather than an `<h1>` — the largest-
// font fallback would grab body-text pull-quotes like "We own the"
// instead of the real slide name.
//
//   1. Explicit data-attr hint   (data-section-title / data-slide-title)
//   2. Class-based hint          (.slide-label, .slide-title, .day-title, …)
//   3. Semantic heading          (h1-h4, [role="heading"])
//   4. Largest-font-size text    (Canva, pdf2htmlEX, Figma-to-HTML)
//   5. First non-meta meaningful (plain prose without headings)
//   6. Positional "Slide N"      (last resort — never empty)
//
// Meta-text rejection (isMetaPattern) is applied at every layer so
// "01 / 14", "Page 5", bullets, etc. never win.
function extractSlideTitle(el: HTMLElement, ord: number): string {
  // Layer 1: explicit data-attr hint on the slide root or any descendant.
  // Senders who care about title accuracy can opt in with
  // `<div class="slide" data-section-title="The Vision">…</div>` or
  // attach the attr to any child.
  const dataAttrEl = el.matches('[data-section-title], [data-slide-title]')
    ? el
    : el.querySelector<HTMLElement>('[data-section-title], [data-slide-title]');
  if (dataAttrEl) {
    const raw =
      dataAttrEl.getAttribute('data-section-title') ??
      dataAttrEl.getAttribute('data-slide-title') ??
      '';
    const dataText = cleanWhitespace(raw);
    if (dataText && dataText.length >= 3 && !isMetaPattern(dataText)) {
      return dataText.slice(0, 200);
    }
  }

  // Layer 2: convention-based class hints. The sample deck uses
  // `<span class="slide-label">Cover</span>`; hand-coded itineraries
  // use `<div class="day-title">…</div>`; LLM-generated decks
  // sometimes use `.page-title` / `.card-title`. `[class~="x"]` is a
  // whole-word match — matches `slide-label` but NOT `slide-label-extra`.
  // First match wins; meta-pattern matches are skipped.
  const classHintSelector = [
    '[class~="slide-label"]',
    '[class~="slide-title"]',
    '[class~="section-label"]',
    '[class~="section-title"]',
    '[class~="page-title"]',
    '[class~="day-title"]',
    '[class~="hero-title"]',
    '[class~="card-title"]',
  ].join(', ');
  const classHints = el.querySelectorAll<HTMLElement>(classHintSelector);
  for (const hint of classHints) {
    const hintText = cleanWhitespace(hint.textContent ?? '');
    if (hintText && hintText.length >= 3 && !isMetaPattern(hintText)) {
      return hintText.slice(0, 200);
    }
  }

  // Layer 3: semantic heading.
  const heading = el.querySelector<HTMLElement>('h1, h2, h3, h4, [role="heading"]');
  const headingText = cleanWhitespace(heading?.textContent ?? '');
  if (headingText && !isMetaPattern(headingText) && headingText.length >= 3) {
    return headingText.slice(0, 200);
  }

  // Layer 4: largest visible text by computed font-size. Last-resort
  // visual signal for decks without semantic markup.
  const largest = findLargestVisibleText(el);
  if (largest) return largest.slice(0, 200);

  // Layer 5: first non-meta text element of meaningful length.
  const fallback = findFirstMeaningfulText(el);
  if (fallback) return fallback.slice(0, 200);

  // Layer 6: positional last resort.
  return `Slide ${ord}`;
}

// Page numbers, slide counters, navigation labels — anything that's
// structurally NOT a title. Returns true if the text should be
// rejected as a section title candidate.
function isMetaPattern(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // "01 / 14", "1/14", "01 — 14", "01-14"
  if (/^\d{1,3}\s*[/—-]\s*\d{1,3}$/.test(t)) return true;
  // "Page 1", "Page 1 of 14", "Page 1/14"
  if (/^page\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(t)) return true;
  // "Slide 1", "Slide 1 of 14"
  if (/^slide\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(t)) return true;
  // "1 of 14"
  if (/^\d{1,3}\s+of\s+\d{1,3}$/i.test(t)) return true;
  // Pure digits or short numeric strings.
  if (/^\d{1,3}$/.test(t)) return true;
  // Bullet glyphs / single-punctuation runs.
  if (/^[•·▶▸→⟶←⟵·.\-—]+$/.test(t)) return true;
  // One- or two-character strings (likely glyphs, not titles).
  if (t.length <= 2) return true;
  return false;
}

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Walks the slide's element subtree, computes each element's OWN text
// (excluding descendant element text) and font-size, returns the text
// of the element with the largest font. Filters meta patterns + too-
// short fragments. Returns null if no candidate qualifies.
function findLargestVisibleText(root: HTMLElement): string | null {
  let bestSize = 0;
  let bestText: string | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as HTMLElement;
    // Aria-hidden subtree skipped entirely.
    if (el.getAttribute('aria-hidden') === 'true') {
      node = walker.nextSibling();
      continue;
    }
    // Own-text only: sum direct text-node children, exclude descendant element text.
    let ownText = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        ownText += child.textContent ?? '';
      }
    }
    const clean = cleanWhitespace(ownText);
    if (clean && clean.length >= 3 && !isMetaPattern(clean)) {
      let fs = 0;
      try {
        fs = parseFloat(getComputedStyle(el).fontSize || '0');
      } catch {
        fs = 0;
      }
      if (!Number.isFinite(fs)) fs = 0;
      if (fs > bestSize) {
        bestSize = fs;
        bestText = clean;
      }
    }
    node = walker.nextNode();
  }
  return bestText;
}

// Last meaningful-text fallback. Scans p/span/div in DOM order, picks
// the first that's non-meta and has real length. Caps at 200 chars.
function findFirstMeaningfulText(root: HTMLElement): string | null {
  const candidates = root.querySelectorAll<HTMLElement>('p, span, div, li');
  for (const c of candidates) {
    if (c.getAttribute('aria-hidden') === 'true') continue;
    const text = cleanWhitespace(c.textContent ?? '');
    if (text && text.length >= 4 && !isMetaPattern(text)) {
      return text;
    }
  }
  return null;
}

function toInfo(s: Section): SectionInfo {
  return {
    id: s.id,
    title: s.title,
    depth: s.depth,
    ordinal: s.ordinal,
    timeSeconds: s.accumulatedMs / 1000,
  };
}
