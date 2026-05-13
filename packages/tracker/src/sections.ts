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

  private discoverSections(): void {
    const elements = document.querySelectorAll<HTMLElement>(this.opts.selector);
    elements.forEach((el, i) => {
      if (!el.id) return;
      this.sections.push({
        id: el.id,
        title: (el.textContent ?? '').trim().slice(0, 200),
        depth: depthFromTag(el.tagName),
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

function toInfo(s: Section): SectionInfo {
  return {
    id: s.id,
    title: s.title,
    depth: s.depth,
    ordinal: s.ordinal,
    timeSeconds: s.accumulatedMs / 1000,
  };
}
