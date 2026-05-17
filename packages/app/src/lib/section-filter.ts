// Mirror of the tracker's `isMetaPattern` check, used at the query
// layer in /docs/[id] to defend against straggling meta-titled rows
// in section_events. Once migration 011 runs and all viewer browsers
// pick up the new tracker (`/v1/tracker.js`), no new meta rows can be
// written — and this filter becomes a no-op. Belt + suspenders.
//
// Keep the regexes in lockstep with packages/tracker/src/sections.ts
// `isMetaPattern`. If you change one, change the other.

const PAGE_NUMBER = /^\s*\d{1,3}\s*[/—-]\s*\d{1,3}\s*$/;
const PAGE_PHRASE = /^\s*page\s+\d{1,3}(\s*(of|\/|—|-)\s*\d{1,3})?\s*$/i;
const SLIDE_OF = /^\s*slide\s+\d{1,3}\s+of\s+\d{1,3}\s*$/i;
const N_OF_M = /^\s*\d{1,3}\s+of\s+\d{1,3}\s*$/i;
const BARE_DIGITS = /^\s*\d{1,3}\s*$/;
const GLYPH_RUN = /^\s*[•·▶▸→⟶←⟵·.\-—]+\s*$/;
const NUMERIC_ID = /^\d+(-\d+)*$/;

export function isMetaSectionTitle(title: string | null, id: string): boolean {
  // Numeric-only section_id is the old tracker's slug-of-meta-text
  // artifact ("01 / 14" → slug "01-14"); reject regardless of title.
  if (NUMERIC_ID.test(id)) return true;
  if (!title) return false;
  const t = title.trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  return (
    PAGE_NUMBER.test(t) ||
    PAGE_PHRASE.test(t) ||
    SLIDE_OF.test(t) ||
    N_OF_M.test(t) ||
    BARE_DIGITS.test(t) ||
    GLYPH_RUN.test(t)
  );
}
