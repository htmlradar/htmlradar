-- 042_radar_items.sql
-- ------------------------------------------------------------
-- The listening radar's durable insight base.
--
-- WHY THIS TABLE EXISTS
--
-- The old daily scan was deliberately stateless: it searched Hacker News and
-- Reddit, Telegrammed a shortlist, and remembered nothing. That threw away the
-- most valuable thing it saw. Every morning the same buyer questions, the same
-- competitor-pain moments, and the same "I wish there was a tool" posts went
-- past unrecorded, so no one could ever ask "what do people keep asking for?"
--
-- This table is the "mine everything" half of the radar. Every item every
-- source returns is written here and categorised, whether or not anyone ever
-- replies to it. The worthwhile few become drafted replies in the daily digest;
-- the rest become intelligence — the recurring questions that tell us which
-- page to write next.
--
-- HOW IT IS WRITTEN, AND WHY IT IS IDEMPOTENT
--
-- The monitor worker upserts rows keyed on source_url (PostgREST
-- merge-duplicates on the unique constraint below). Re-seeing the same thread
-- moves last_seen_at and refreshes the classification, but the worker's payload
-- deliberately omits first_seen_at and acted, so a conflict cannot overwrite
-- them. That is the whole trick: first_seen_at stays frozen at the first
-- sighting, which is what lets the digest ask "new in the last 24 hours"; and
-- acted stays whatever it was, so an item the founder already replied to does
-- not resurface as fresh.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No foreign key to anything: this is a log of what the public web said, and it
-- must outlive whatever prompted it. No triage/workflow columns beyond acted:
-- the founder acting on an item is a boolean, not a ticketing system. No PII: a
-- title, a snippet, a public URL, and a timestamp are all a public thread is.
--
-- RLS is deny-all. These are internal operational rows; the worker reads and
-- writes them with the service role, and no customer-facing role has any
-- business here. Same posture as abuse_reports (037) and telegram_outbox (038).
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ORDERING: run this AFTER 038 (telegram_outbox), whose kind constraint it
-- extends at the bottom.
-- ------------------------------------------------------------

create table if not exists public.radar_items (
  id             uuid primary key default gen_random_uuid(),
  -- Which source surfaced it first: 'GoogleAlerts', 'HN', or 'Reddit'.
  source         text,
  -- The public URL. Unique, and the whole basis of idempotency: re-seeing a
  -- thread updates the existing row rather than inserting a duplicate.
  source_url     text not null unique,
  title          text,
  snippet        text,
  -- When the source dated the item (its own published/updated time), null when
  -- the source gave none.
  published_at   timestamptz,
  -- When the radar first saw it. Frozen on the first insert (the upsert never
  -- rewrites it), so the digest's 24-hour window means "new to us".
  first_seen_at  timestamptz not null default now(),
  -- Bumped every time the item is seen again, so "still being discussed" is
  -- answerable without a second table.
  last_seen_at   timestamptz not null default now(),
  -- The five buckets the classifier sorts every item into. 'noise' is stored
  -- like any other — mine everything — and simply never reaches the digest.
  category       text check (category in (
                   'buyer_question',
                   'competitor_mention',
                   'product_feedback',
                   'reputation',
                   'noise'
                 )),
  -- 0–100 buying intent from the classifier's additive model. A drafted reply
  -- is attached in the digest only at/above the reply threshold in code.
  intent_score   int,
  -- Has the founder acted on it (replied himself)? Defaults false and stays
  -- false until he tells us — there is no auto-post. The upsert never touches
  -- this column, so a re-sighting cannot un-act an item.
  acted          boolean not null default false,
  meta           jsonb
);

comment on table public.radar_items is
  'The listening radar''s insight base. Every item every source returns, categorised and scored, whether or not anyone replies. Keyed on source_url so re-seeing an item is idempotent.';
comment on column public.radar_items.source_url is
  'Public URL, unique. Idempotency key: an upsert on conflict here updates last_seen_at and the classification but never first_seen_at or acted.';
comment on column public.radar_items.first_seen_at is
  'When the radar first saw this item. Never rewritten by the upsert, so the digest''s 24-hour window means genuinely new to us.';
comment on column public.radar_items.acted is
  'True once the founder has replied himself. There is no auto-post; the digest only drafts. The upsert never changes this, so a re-sighting cannot reset it.';

-- The digest asks "new, non-noise, in the last 24 hours, by score"; the weekly
-- insight asks "everything in the last 7 days, grouped by category". These two
-- indexes answer both.
create index if not exists idx_radar_items_first_seen on public.radar_items (first_seen_at desc);
create index if not exists idx_radar_items_category on public.radar_items (category);

-- ------------------------------------------------------------
-- RLS — deny all
--
-- RLS on with no policies means anon and authenticated see nothing and can
-- write nothing through PostgREST. The revoke is the belt to that braces: it
-- drops the table-level privilege too, so a policy added by accident in some
-- later migration still grants nothing on its own. The service role bypasses
-- RLS, which is how the worker reads and writes.
-- ------------------------------------------------------------
alter table public.radar_items enable row level security;

revoke all on public.radar_items from anon, authenticated;

-- ------------------------------------------------------------
-- One more thing the worker can say: kind='radar', the daily digest message.
--
-- telegram_outbox's kind is a check constraint (038, last extended in 041), and
-- a check constraint has no ALTER form, so it is dropped and re-added. The
-- 'drop if exists' first makes this safe to run twice.
-- ------------------------------------------------------------
alter table public.telegram_outbox
  drop constraint if exists telegram_outbox_kind_check;

alter table public.telegram_outbox
  add constraint telegram_outbox_kind_check
  check (kind in (
    'alert', 'scan', 'scan_run', 'test', 'heartbeat', 'sentinel', 'radar'
  ));

comment on column public.telegram_outbox.kind is
  'alert = health/incident message; scan = a sent thread-scan message (legacy); scan_run = one per radar mining run, sent or not; test = sent by hand to prove the path; heartbeat = a maintenance session stamping the register; sentinel = the daily sentinel report; radar = the daily listening-radar digest.';

-- Make the new table and the widened constraint visible to PostgREST at once.
notify pgrst, 'reload schema';
