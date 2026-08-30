// sections-v2.ts — viewport-coverage-weighted section dwell tracker.
//
// Replaces winner-takes-all (sections-legacy.ts, four prior attempts)
// with proportional distribution: every visible section accumulates
// time proportional to the fraction of the viewport it occupies, gated
// by the IAB Viewable Impression Standard (≥50% self-coverage for ≥1s
// before credit qualifies).
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

// IAB Viewable Impression Standard: a section needs to occupy at least
// 50% of its own height in the viewport to count as "visible." Filters out
// tail-of-section noise during fast scrolls.
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
  element: HTMLElement;
  // Gross time credited via viewport-share weighting. Includes time before
  // the section qualified — useful for debugging, not surfaced.
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

  // Distribute `dt` ms across every section currently ≥MIN_COVERAGE-visible,
  // weighted by what fraction of the viewport each occupies.
  private sample(dt: number): void {
    const vp = typeof window !== 'undefined' ? window.visualViewport : null;
    const vpH = vp?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
    const vpTop = vp?.offsetTop ?? 0;
    if (vpH <= 0) return;

    const visible: Array<{ section: Section; viewportShare: number }> = [];
    let totalCoverage = 0;

    for (const s of this.sections) {
      const r = s.element.getBoundingClientRect();
      const visTop = Math.max(r.top, vpTop);
      const visBot = Math.min(r.bottom, vpTop + vpH);
      const visPx = Math.max(0, visBot - visTop);
      if (visPx <= 0) continue;

      const selfCoverage = r.height > 0 ? visPx / r.height : 0;
      if (selfCoverage < MIN_COVERAGE) continue;

      const viewportShare = visPx / vpH;
      visible.push({ section: s, viewportShare });
      totalCoverage += viewportShare;
    }

    if (totalCoverage <= 0) {
      // Nothing meets the threshold this sample. Reset every section's
      // continuous-visible counter — they can't claim sustained visibility
      // through a gap.
      for (const s of this.sections) s.continuousVisibleMs = 0;
      return;
    }

    const visibleIds = new Set<string>();
    for (const { section, viewportShare } of visible) {
      visibleIds.add(section.id);
      const weight = viewportShare / totalCoverage;
      const credited = dt * weight;
      section.totalMs += credited;
      section.continuousVisibleMs += dt;

      if (!this.enteredOnce.has(section.id)) {
        this.enteredOnce.add(section.id);
        this.opts.onSectionEnter?.(toInfo(section));
      }

      if (section.continuousVisibleMs >= QUALIFIED_DWELL_MS) {
        section.qualifiedMs += credited;
        if (!section.hasReadFired && section.qualifiedMs >= this.opts.minDwellMs) {
          section.hasReadFired = true;
          this.opts.onSectionRead?.(toInfo(section));
        }
      }
    }

    // Sections not visible this sample lose their continuous-visible
    // streak. Next time they re-enter view, they have to re-qualify.
    for (const s of this.sections) {
      if (!visibleIds.has(s.id)) s.continuousVisibleMs = 0;
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
        element: el,
        totalMs: 0,
        qualifiedMs: 0,
        continuousVisibleMs: 0,
        hasReadFired: false,
      });
    });
  }
}

// =============================================================================
// Helpers — discovery, title chain, meta-pattern rejection, slugify
// (lifted from sections-legacy.ts; kept in-file so v2 has no cross-file
// dependencies and the legacy file can be deleted without touching this one)
// =============================================================================

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
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
