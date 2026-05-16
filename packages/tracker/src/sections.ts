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

  constructor(opts: Options) {
    this.opts = opts;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.discoverSections();
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.update(performance.now());
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.creditCurrent(performance.now());
    window.removeEventListener('scroll', this.onScroll);
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
        title = (el.textContent ?? '').trim().slice(0, 200);
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

  // `this.sections` is populated by `querySelectorAll` in DOM order, so we
  // can walk it linearly and bail at the first heading that's still below
  // the boundary. Sticky/fixed headings break this assumption — filtered
  // out at discovery (see `discoverSections`).
  private computeCurrent(): string | null {
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
  let elements = Array.from(document.querySelectorAll<HTMLElement>(configured)).filter(
    (el) => !isAnchored(el),
  );
  if (elements.length >= 2) {
    return { elements, strategy: 'configured' };
  }

  // Strategy 2: any heading regardless of id.
  elements = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3')).filter(
    (el) => !isAnchored(el),
  );
  if (elements.length >= 2) {
    return { elements, strategy: 'headings' };
  }

  // Strategy 3: slide / page containers — covers Reveal.js / Slidev / PDF
  // exports / custom decks. We deliberately do NOT include bare `div`s
  // here; that would over-match on most content pages.
  elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      'section, article, [class*="slide"], [class*="page"], [data-slide], [data-page]',
    ),
  ).filter((el) => !isAnchored(el));
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

// For slide-container strategy: try heading text first (the most
// reliable signal), then first paragraph/span, finally the first
// 80 chars of any text in the slide, finally fall back to "Slide N".
function extractSlideTitle(el: HTMLElement, ord: number): string {
  const heading = el.querySelector<HTMLElement>('h1, h2, h3, [role="heading"]');
  const headingText = heading?.textContent?.trim();
  if (headingText) return headingText.slice(0, 200);

  const para = el.querySelector<HTMLElement>('p, span');
  const paraText = para?.textContent?.trim();
  if (paraText) return paraText.slice(0, 200);

  const allText = (el.textContent ?? '').trim();
  if (allText) {
    return allText.length > 80 ? `${allText.slice(0, 80)}…` : allText;
  }
  return `Slide ${ord}`;
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
