// sections-v2.ts — range-based section dwell tracker.
//
// A section is a RANGE of the document, not one element: for a heading, the
// heading plus everything under it up to the next heading of the same or
// higher level. Its geometry is the union of its members' boxes, read fresh
// each sample; no wrapper is ever inserted into the customer's document.
//
// Each sample credits exactly one section — the one covering most of the
// window — gated by the IAB Viewable Impression Standard (≥50% coverage of
// the range, or of the window once the range is the taller of the two, for
// ≥1s continuously before credit qualifies). Two earlier shapes are gone and
// should not come back: measuring a heading's own 40 pixels, which stopped
// counting the moment the reader scrolled past the heading into the section
// it names; and splitting each sample across every visible section, which
// billed a section and its own subsection for the same second.
//
// Public contract is identical to sections-legacy.ts (Session imports
// `SectionTracker` and calls start/stop/pause/resume/snapshot only) so
// the swap in session.ts is a one-line import change.

import type { SectionInfo } from './types.js';

// -----------------------------------------------------------------------------
// Tuning constants
// -----------------------------------------------------------------------------

// Sample cadence. 250 ms keeps cost negligible (≤4 rect reads per second per
// section) while still catching brief mid-scroll states. rAF schedules every
// frame regardless; we only DO work when this many ms have passed.
const SAMPLE_INTERVAL_MS = 250;

// Activity watchdog. If the user hasn't moused, touched, scrolled, or
// pressed a key in this long, we treat the session as idle and stop
// accumulating dwell — even if the tab is foregrounded. Mirrors Chartbeat /
// Parse.ly engagement-time methodology.
const ACTIVITY_IDLE_MS = 5_000;

// IAB Viewable Impression Standard: a section needs half of it on screen to
// count as "visible" — half of its own height, or half the window once the
// section is taller than the window, whichever is the smaller measure. A
// section three screens long can never put half of ITSELF on screen, and the
// reader parked inside it is reading it all the same.
const MIN_COVERAGE = 0.5;

// IAB qualified dwell: 1 continuous second above MIN_COVERAGE before the
// section's time starts counting toward `qualifiedMs`. Brief glances and
// scroll-by views never qualify.
const QUALIFIED_DWELL_MS = 1_000;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  depth: number;
  ordinal: number;
  // The elements the section covers, in document order. For slides, prose
  // buckets and a configured selector that is one element per section, and
  // the range reduces to it. For headings it is the heading plus its body —
  // see rangeMembers.
  members: HTMLElement[];
  // Ordinal of the section that closes this one, so a section knows which
  // later sections are nested inside it. `ordinal + 1` when nothing is.
  endOrdinal: number;
  // Gross time credited to this section. Includes time before the section
  // qualified — useful for debugging, not surfaced.
  totalMs: number;
  // Time credited AFTER the section sustained ≥50% coverage for ≥1s.
  // This is what we report to the dashboard.
  qualifiedMs: number;
  // Rolling continuous-visible counter. Increments each sample the section
  // is ≥MIN_COVERAGE; resets to 0 when it isn't. Once it crosses
  // QUALIFIED_DWELL_MS, future credit goes to qualifiedMs.
  continuousVisibleMs: number;
  hasReadFired: boolean;
}

interface Options {
  selector: string;
  boundaryOffsetPx: number; // unused in v2 (kept for type-compatibility)
  minDwellMs: number;
  onSectionEnter?: (info: SectionInfo) => void;
  onSectionRead?: (info: SectionInfo) => void;
}

// -----------------------------------------------------------------------------
// SectionTracker
// -----------------------------------------------------------------------------

export class SectionTracker {
  private readonly opts: Options;
  private readonly sections: Section[] = [];
  private active = false;
  private rafHandle = 0;
  private lastSampleTs = 0;
  private lastActivityTs = 0;
  private readonly enteredOnce = new Set<string>();

  constructor(opts: Options) {
    this.opts = opts;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.discoverSections();
    this.bindActivityListeners();
    const now = nowMs();
    this.lastSampleTs = now;
    this.lastActivityTs = now;
    this.scheduleTick();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.cancelTick();
    this.unbindActivityListeners();
  }

  // Visibility-hidden → pause the sampler. No-op if not active. We don't
  // touch accumulated state — the user is coming back.
  pause(): void {
    this.cancelTick();
  }

  // Visibility-visible → restart the sampler. Reset continuous-visible
  // counters because the gap means we can't claim sustained visibility.
  resume(): void {
    if (!this.active) return;
    if (this.rafHandle) return;
    const now = nowMs();
    this.lastSampleTs = now;
    this.lastActivityTs = now;
    for (const s of this.sections) s.continuousVisibleMs = 0;
    this.scheduleTick();
  }

  // Returns EVERY section that has entered the viewport at least once,
  // with its (possibly zero) qualified time. The dashboard renders the
  // narrative in deck order; we want sections the reader scrolled
  // through without sustaining attention to still appear (with time
  // 0 or sub-second) — same model DocSend uses for per-page views.
  //
  // Was previously filtered to sections that hit `minDwellMs` of
  // qualified time. That filter is now a UI concern (render `—` for
  // sub-threshold time) so we can show the full read pattern instead
  // of dropping "scrolled past" sections silently.
  //
  // Important — `qualifiedMs` math is UNCHANGED. We're only changing
  // what gets flushed to the DB. The IAB 50%-coverage / 1s-continuous
  // / 5s-activity rules still gate qualifiedMs accumulation. A
  // section that doesn't qualify simply ships with timeSeconds=0.
  // The `onSectionRead` callback (which still uses minDwellMs) is
  // unaffected — "read" is still a meaningful, dwell-thresholded event.
  snapshot(): SectionInfo[] {
    return this.sections
      .filter((s) => this.enteredOnce.has(s.id))
      .map((s) => ({
        id: s.id,
        title: s.title,
        depth: s.depth,
        ordinal: s.ordinal,
        timeSeconds: s.qualifiedMs / 1000,
      }));
  }

  // ---------------------------------------------------------------------------
  // Sampling loop
  // ---------------------------------------------------------------------------

  private scheduleTick(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      // Headless / non-browser env (jsdom in some configurations). Fall
      // back to setTimeout at the sample cadence so tests still drive
      // the accumulator.
      this.rafHandle = setTimeout(
        () => this.tick(nowMs()),
        SAMPLE_INTERVAL_MS,
      ) as unknown as number;
      return;
    }
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private cancelTick(): void {
    if (!this.rafHandle) return;
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle);
    } else {
      clearTimeout(this.rafHandle as unknown as number);
    }
    this.rafHandle = 0;
  }

  private tick = (ts: number): void => {
    if (!this.active) return;

    const isActive =
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      ts - this.lastActivityTs < ACTIVITY_IDLE_MS;

    // Idle (tab visible but no recent activity): advance the sample clock
    // WITHOUT crediting. Otherwise the idle gap stays folded into `elapsed`,
    // and the next active tick dumps the entire gap onto whatever section is
    // on screen — inflating section dwell well past the session's active
    // time. active_time is idle-gated (5s watchdog); section dwell must be
    // too, or the two diverge (the "timing is off" over-credit).
    if (!isActive) {
      this.lastSampleTs = ts;
      this.scheduleTick();
      return;
    }

    const elapsed = ts - this.lastSampleTs;
    if (elapsed >= SAMPLE_INTERVAL_MS) {
      this.lastSampleTs = ts;
      // Clamp to two sample intervals so a residual gap (a throttled rAF,
      // a slow frame, a wake-from-background race) can never over-credit.
      this.sample(Math.min(elapsed, SAMPLE_INTERVAL_MS * 2));
    }

    this.scheduleTick();
  };

  // Credit `dt` ms to exactly one section: the one the reader is in, which is
  // the one covering the most of the window. Splitting `dt` across every
  // visible section was what let a section and its own subsection bill for
  // the same second twice.
  private sample(dt: number): void {
    const vp = typeof window !== 'undefined' ? window.visualViewport : null;
    const vpH = vp?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
    const vpTop = vp?.offsetTop ?? 0;
    if (vpH <= 0) return;

    // In ordinal order, so the `>` below leaves ties with the earlier one.
    const candidates: Array<{ section: Section; fraction: number }> = [];

    for (const s of this.sections) {
      // Geometry is re-read every sample. The sampler is already a
      // requestAnimationFrame callback throttled to SAMPLE_INTERVAL_MS, so a
      // scroll, a resize, a lazily loaded image or a collapsed block is
      // picked up on the next tick without a listener of its own.
      const range = unionRect(s.members);
      const height = range.bottom - range.top;
      const visPx =
        height > 0
          ? Math.max(0, Math.min(range.bottom, vpTop + vpH) - Math.max(range.top, vpTop))
          : 0;
      const fraction = height > 0 ? visPx / Math.min(height, vpH) : 0;

      if (fraction < MIN_COVERAGE) {
        // No sustained visibility through a gap: the streak restarts.
        s.continuousVisibleMs = 0;
        continue;
      }
      // Visible counts as entered even for a section that goes on to be
      // skipped below, so "scrolled through, did not settle" still reports.
      if (!this.enteredOnce.has(s.id)) {
        this.enteredOnce.add(s.id);
        this.opts.onSectionEnter?.(toInfo(s));
      }
      candidates.push({ section: s, fraction });
    }

    let winner: { section: Section; fraction: number } | null = null;
    for (const c of candidates) {
      // A section that encloses another candidate is not the one being read;
      // the enclosed one is. Without this an <h1>, whose range runs to the
      // next <h1> and so usually to the end of the document, would tie at a
      // full window with every <h2> under it and, being earlier, take all of
      // their time.
      const enclosesACandidate = candidates.some(
        (other) =>
          other.section.ordinal > c.section.ordinal && other.section.ordinal < c.section.endOrdinal,
      );
      if (enclosesACandidate) {
        // Its streak stops too. A streak that kept running while a subsection
        // held the credit would be spent the instant the subsection dropped
        // out — the enclosing section would take the boundary sample without
        // ever having earned its own continuous second.
        c.section.continuousVisibleMs = 0;
        continue;
      }
      c.section.continuousVisibleMs += dt;
      if (!winner || c.fraction > winner.fraction) winner = c;
    }
    if (!winner) return;

    const section = winner.section;
    section.totalMs += dt;
    if (section.continuousVisibleMs >= QUALIFIED_DWELL_MS) {
      section.qualifiedMs += dt;
      if (!section.hasReadFired && section.qualifiedMs >= this.opts.minDwellMs) {
        section.hasReadFired = true;
        this.opts.onSectionRead?.(toInfo(section));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Activity watchdog — keystrokes / pointer / touch / scroll bump the timer.
  // No mousemove (too noisy) or focus (doesn't imply attention).
  // ---------------------------------------------------------------------------

  private readonly onActivity = (): void => {
    this.lastActivityTs = nowMs();
  };

  private bindActivityListeners(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onActivity, { passive: true });
    window.addEventListener('mousedown', this.onActivity, { passive: true });
    window.addEventListener('touchstart', this.onActivity, { passive: true });
    window.addEventListener('scroll', this.onActivity, { passive: true });
    window.addEventListener('wheel', this.onActivity, { passive: true });
  }

  private unbindActivityListeners(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onActivity);
    window.removeEventListener('mousedown', this.onActivity);
    window.removeEventListener('touchstart', this.onActivity);
    window.removeEventListener('scroll', this.onActivity);
    window.removeEventListener('wheel', this.onActivity);
  }

  // ---------------------------------------------------------------------------
  // Discovery — same four-strategy chain as v1 plus a wider slide selector
  // that catches `.day-section`-style containers from hand-coded itineraries.
  // ---------------------------------------------------------------------------

  private discoverSections(): void {
    const candidates = pickCandidates(this.opts.selector);
    const seenIds = new Map<string, number>();

    candidates.elements.forEach((el, i) => {
      let id = el.id;
      if (!id) {
        if (candidates.strategy === 'slides') {
          id = `slide-${i + 1}`;
        } else if (candidates.strategy === 'prose') {
          const title = firstSentence((el.textContent ?? '').trim());
          id = slugify(title) || `part-${i + 1}`;
        } else {
          id = slugify((el.textContent ?? '').trim()) || `section-${i + 1}`;
        }
      }
      const count = (seenIds.get(id) ?? 0) + 1;
      seenIds.set(id, count);
      if (count > 1) id = `${id}-${count}`;

      let title: string;
      if (candidates.strategy === 'slides') {
        title = extractSlideTitle(el, i + 1);
      } else if (candidates.strategy === 'prose') {
        title = firstSentence((el.textContent ?? '').trim()) || `Part ${i + 1}`;
      } else {
        title = titleText(el).slice(0, 200) || `Section ${i + 1}`;
      }

      this.sections.push({
        id,
        title,
        depth:
          candidates.strategy === 'slides' || candidates.strategy === 'prose'
            ? 1
            : depthFromTag(el.tagName),
        ordinal: i,
        members: [el],
        endOrdinal: i + 1,
        totalMs: 0,
        qualifiedMs: 0,
        continuousVisibleMs: 0,
        hasReadFired: false,
      });
    });

    // A heading is a label, not a section: 40 pixels that leave the window the
    // moment the reader starts reading what they name. So a heading's section
    // is the RANGE from the heading to the element before the next heading of
    // the same or higher level — an <h1> closes an <h2>'s range, an <h2>
    // closes an <h3>'s, and a heading of its own level closes it too.
    //
    // Keyed on the tag, not on which strategy found it: the default selector
    // is `h1, h2, h3`, so an ordinary report arrives here as 'configured'
    // and never as 'headings'. Slide containers and prose buckets are not
    // headings, so they keep their element as their whole section.
    const els = candidates.elements;
    const levels = els.map((el) => headingLevel(el.tagName));
    this.sections.forEach((section, i) => {
      const level = levels[i]!;
      if (!level) return;
      let end = els.length;
      for (let j = i + 1; j < els.length; j++) {
        if (levels[j] && levels[j]! <= level) {
          end = j;
          break;
        }
      }
      section.endOrdinal = end;
      section.members = rangeMembers(els[i]!, els[end] ?? null);
    });
  }
}

// =============================================================================
// Helpers — discovery, title chain, meta-pattern rejection, slugify
// (lifted from sections-legacy.ts; kept in-file so v2 has no cross-file
// dependencies and the legacy file can be deleted without touching this one)
// =============================================================================

// The elements a heading section covers: the heading and everything after it
// in document order, up to but not including the heading that closes the
// range. The customer's DOM is never touched — no wrapper is inserted to
// measure against — so the range is carried as the list of elements it spans
// and its geometry is their union.
//
// Strictly forward. An earlier version anchored the walk on an ancestor when
// the heading had no sibling to grow into, which put that ancestor's own
// content — including whatever sat ABOVE the heading — inside the range. An
// ancestor always begins before the heading, so no ancestor is ever a member;
// the walk climbs out of one only to carry on past it.
function rangeMembers(heading: HTMLElement, stop: HTMLElement | null): HTMLElement[] {
  const members: HTMLElement[] = [heading];
  let node: HTMLElement = heading;

  for (;;) {
    let next = node.nextElementSibling as HTMLElement | null;

    if (!next) {
      // The run ends here. Step out of the container and continue after it,
      // without taking the container itself.
      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      node = parent;
      continue;
    }

    // A wrapper holding the closing heading is not stepped over: what sits
    // inside it BEFORE that heading is still part of this section, so the
    // walk descends into it instead. The wrapper is never a member — it runs
    // on past the point where the next section starts.
    while (stop && next && next !== stop && next.contains(stop)) {
      next = next.firstElementChild as HTMLElement | null;
    }
    if (!next || next === stop) break;

    members.push(next);
    node = next;
  }
  return members;
}

// The range's geometry: the union of its members' boxes, in window
// coordinates. The same rectangle a wrapper element would have had, without
// putting one in someone else's document.
function unionRect(members: HTMLElement[]): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of members) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // display:none, detached
    if (r.top < top) top = r.top;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return Number.isFinite(top) ? { top, bottom } : { top: 0, bottom: 0 };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// 1, 2 or 3 for a heading; 0 for anything else.
function headingLevel(tag: string): number {
  return tag === 'H1' ? 1 : tag === 'H2' ? 2 : tag === 'H3' ? 3 : 0;
}

function depthFromTag(tag: string): number {
  return headingLevel(tag) || 4;
}

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

  let elements = Array.from(document.querySelectorAll<HTMLElement>(configured)).filter(
    (el) => !isAnchored(el) && !isMetaPattern(cleanWhitespace(el.textContent ?? '')),
  );
  if (elements.length >= 2) return { elements, strategy: 'configured' };

  elements = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3')).filter(
    (el) => !isAnchored(el) && !isMetaPattern(cleanWhitespace(el.textContent ?? '')),
  );
  if (elements.length >= 2) return { elements, strategy: 'headings' };

  // Slide / page / chapter containers. Widened in v2 to catch
  // `.day-section`-style class names that hand-coded itineraries use.
  // `[class~="x"]` is whole-word match — safer than `[class*="x"]`
  // which over-matches `.day-header`, `.section-head`, etc.
  elements = dedupeNested(
    Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          'section',
          'article',
          '[class*="slide"]',
          '[class*="page"]',
          '[class~="day-section"]',
          '[class~="chapter"]',
          '[class~="step-section"]',
          '[data-slide]',
          '[data-page]',
          '[data-page-no]',
          '[data-page-number]',
        ].join(', '),
      ),
    ).filter((el) => !isAnchored(el)),
  );
  if (elements.length >= 2) return { elements, strategy: 'slides' };

  const proseAnchors = collectProseAnchors(isAnchored);
  if (proseAnchors.length >= 2) return { elements: proseAnchors, strategy: 'prose' };

  return { elements: [], strategy: 'configured' };
}

function dedupeNested(elements: HTMLElement[]): HTMLElement[] {
  if (elements.length < 2) return elements;
  const sorted = [...elements].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const kept: HTMLElement[] = [];
  for (const el of sorted) {
    const isNested = kept.some((k) => k !== el && k.contains(el));
    if (!isNested) kept.push(el);
  }
  return kept;
}

const MAX_PROSE_BUCKETS = 8;
const MIN_PROSE_TEXT_LEN = 40;
function collectProseAnchors(isAnchored: (el: HTMLElement) => boolean): HTMLElement[] {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('p, li, blockquote')).filter(
    (p) => {
      const text = (p.textContent ?? '').trim();
      if (text.length < MIN_PROSE_TEXT_LEN) return false;
      if (isAnchored(p)) return false;
      const chrome = p.closest(
        'nav, footer, aside, header, [role="banner"], [role="navigation"], [role="contentinfo"], [aria-hidden="true"]',
      );
      if (chrome) return false;
      return true;
    },
  );
  if (candidates.length === 0) return [];
  if (candidates.length <= MAX_PROSE_BUCKETS) return candidates;

  const stride = Math.ceil(candidates.length / MAX_PROSE_BUCKETS);
  const anchors: HTMLElement[] = [];
  for (let i = 0; i < candidates.length; i += stride) {
    const el = candidates[i];
    if (el) anchors.push(el);
  }
  return anchors;
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const m = cleaned.slice(0, 200).match(/^[\s\S]{1,120}?[.!?](?=\s|$)/);
  if (m) return m[0].trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// 6-layer title chain. Identical to the Release A logic in
// sections-legacy.ts.
function extractSlideTitle(el: HTMLElement, ord: number): string {
  // Layer 1: data-attr hint
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

  // Layer 2: convention-based class hints
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
    const hintText = titleText(hint);
    if (hintText && hintText.length >= 3 && !isMetaPattern(hintText)) {
      return hintText.slice(0, 200);
    }
  }

  // Layer 3: semantic heading
  const heading = el.querySelector<HTMLElement>('h1, h2, h3, h4, [role="heading"]');
  const headingText = heading ? titleText(heading) : '';
  if (headingText && !isMetaPattern(headingText) && headingText.length >= 3) {
    return headingText.slice(0, 200);
  }

  // Layer 4: largest font-size
  const largest = findLargestVisibleText(el);
  if (largest) return largest.slice(0, 200);

  // Layer 5: first meaningful text
  const fallback = findFirstMeaningfulText(el);
  if (fallback) return fallback.slice(0, 200);

  // Layer 6: positional
  return `Slide ${ord}`;
}

function isMetaPattern(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^\d{1,3}\s*[/—-]\s*\d{1,3}$/.test(t)) return true;
  if (/^page\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(t)) return true;
  if (/^slide\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?$/i.test(t)) return true;
  if (/^\d{1,3}\s+of\s+\d{1,3}$/i.test(t)) return true;
  if (/^\d{1,3}$/.test(t)) return true;
  if (/^[•·▶▸→⟶←⟵·.\-—]+$/.test(t)) return true;
  if (t.length <= 2) return true;
  return false;
}

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Human-readable text of an element: unlike textContent, child elements are
// separated by a space ("<span>03</span>Market" → "03 Market"). A leading
// slide number is dropped only when it is its own child element (never from
// plain text, so "5 ways to cut churn" keeps its 5) and text remains after it.
function titleText(el: Node): string {
  const text = cleanWhitespace(spacedText(el));
  const first = Array.from(el.childNodes).find((c) => (c.textContent ?? '').trim());
  const numbered =
    first?.nodeType === 1 && /^\d{1,3}$/.test(cleanWhitespace(first.textContent ?? ''));
  return numbered ? text.replace(/^\d{1,3}\s+(?=\S)/, '') : text;
}

function spacedText(node: Node): string {
  let out = '';
  node.childNodes.forEach((c) => {
    out += c.nodeType === 3 ? (c.textContent ?? '') : ` ${spacedText(c)} `;
  });
  return out;
}

function findLargestVisibleText(root: HTMLElement): string | null {
  let bestSize = 0;
  let bestText: string | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as HTMLElement;
    if (el.getAttribute('aria-hidden') === 'true') {
      node = walker.nextSibling();
      continue;
    }
    let ownText = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
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

function findFirstMeaningfulText(root: HTMLElement): string | null {
  const candidates = root.querySelectorAll<HTMLElement>('p, span, div, li');
  for (const c of candidates) {
    if (c.getAttribute('aria-hidden') === 'true') continue;
    const text = titleText(c);
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
    timeSeconds: s.qualifiedMs / 1000,
  };
}
