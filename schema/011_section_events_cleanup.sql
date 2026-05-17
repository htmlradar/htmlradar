-- 011_section_events_cleanup.sql
-- ------------------------------------------------------------
-- One-time cleanup of garbage section_events created by the old tracker.
--
-- The pre-v1.1.3 section detector emitted page-number text ("01 / 14",
-- "Page 1 of 12", "Slide 3", bare digits) as section titles when the
-- doc had no semantic headings, and over-counted on decks where
-- [class*="slide"] matched nested decoration (`.slide-num`,
-- `.slide-label`). The v1.1.3 tracker fixes both at source. This
-- migration retroactively removes the bad rows already in
-- section_events so existing dashboards stop showing phantom sections.
--
-- Idempotent: the WHERE clauses target exactly the meta-text patterns
-- the new tracker now rejects, so re-running this is a no-op once the
-- new tracker is the only writer.
--
-- Apply: paste into Supabase SQL editor, run once.
-- ------------------------------------------------------------

begin;

-- 1) Page-number titles: "01 / 14", "1/14", "01 - 14", "01 — 14"
delete from section_events
where section_title ~ '^\s*\d{1,3}\s*[/—\-]\s*\d{1,3}\s*$';

-- 2) "Page N", "Page N of M", "Page N/M"
delete from section_events
where section_title ~* '^\s*page\s+\d{1,3}(\s*(of|/|—|-)\s*\d{1,3})?\s*$';

-- 3) "Slide N", "Slide N of M" — note: the NEW tracker also emits
--    "Slide N" as a positional fallback, BUT it does so only when a
--    slide has zero usable text. To avoid wiping legitimate positional
--    fallbacks, we only nuke "Slide N" rows where the OLD tracker is
--    the source — heuristic: rows with depth IS NULL OR rows where the
--    section_id matches the old meta-slug pattern. Conservative: only
--    delete rows where section_title looks like "Slide N of M" (a
--    pattern the new tracker never emits) or rows where section_id is
--    purely numeric (the old slug-of-meta-text artifact).
delete from section_events
where section_title ~* '^\s*slide\s+\d{1,3}\s+of\s+\d{1,3}\s*$';

-- 4) "1 of 14" — alternative page-counter phrasing
delete from section_events
where section_title ~* '^\s*\d{1,3}\s+of\s+\d{1,3}\s*$';

-- 5) section_id is purely digits — the old code slugged page-number text
--    ("01 / 14" → "01-14") and that's the only path that produces a
--    numeric-only section_id.
delete from section_events
where section_id ~ '^\d+(-\d+)*$';

-- 6) Bullet glyphs / single-punctuation runs / very short fragments
delete from section_events
where section_title is not null
  and (
    section_title ~ '^\s*[•·▶▸→⟶←⟵·.\-—]+\s*$'
    or char_length(trim(section_title)) <= 2
  );

commit;

-- Done. New v1.1.3 tracker code is the only writer going forward, and
-- it rejects all of the above patterns at extract time.
