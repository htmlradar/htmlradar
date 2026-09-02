-- 046_radar_drafts.sql
-- ------------------------------------------------------------
-- One row per drafted reply the founder can post with a tap.
--
-- WHY THIS TABLE EXISTS
--
-- Until now the daily digest wrote a draft into a Telegram message and the
-- story ended there: the founder copied the text, opened Reddit, found the
-- thread, and pasted. Two minutes a day, and every one of those two minutes
-- was a chance to not bother.
--
-- The one-tap path removes the copying, not the founder. A draft arrives as
-- its own Telegram message with two buttons. "Post as me" posts that exact
-- text from HIS Reddit account; "Skip" closes it. Nothing posts without the
-- tap — the SOP rule that only the founder speaks in public is unchanged, the
-- tap IS the speaking.
--
-- A button needs somewhere to point. Telegram hands a callback back with at
-- most 64 bytes of our own data in it, which is enough for an id and nothing
-- else, so the draft text, the thread it belongs to, and what has happened to
-- it have to live in a row. That row is this table.
--
-- WHAT EACH COLUMN IS FOR
--
--   thing_id     Reddit's fullname for the THREAD ('t3_' + the base-36 id in
--                the URL). This is what POST /api/comment takes as its parent,
--                and it is the identity we deduplicate on: one comment per
--                thread, ever.
--   draft_text   Exactly what will be posted. A reply in Telegram replaces it
--                (status becomes 'edited') and the replacement gets its own
--                message with its own button — an edit is never posted without
--                a second tap.
--   status       pending -> posted | skipped | failed, with 'edited' as the
--                waiting state after a reply. See the check below.
--   telegram_message_id  Which message carries the buttons. A reply in
--                Telegram arrives quoting a message id and nothing else, so
--                without this column there is no way back from "he replied to
--                that one" to "this draft".
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No foreign key to radar_items. The draft quotes a public thread by URL and
-- must outlive whatever pruning ever happens to the insight base. No queue, no
-- retry counter: a post either happened or it did not, and a failure is
-- reported back into the Telegram message in plain words for the founder to
-- decide about. No Reddit credentials — the refresh token is a Worker secret
-- and never touches a row.
--
-- RLS is deny-all, the same posture as radar_items (042) and telegram_outbox
-- (038): these are internal operational rows written by the monitor worker
-- with the service role, and no customer-facing role has any business here.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists public.radar_drafts (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- The public thread this reply answers. Not unique: a thread can be drafted
  -- for twice and skipped once; only POSTING is deduplicated (see the index).
  source_url           text not null,
  -- 't3_' + the thread's base-36 id, parsed out of source_url. The parent
  -- POST /api/comment is given.
  thing_id             text not null,
  -- 'sales', 'startups', ... — carried so a row reads without parsing a URL.
  subreddit            text,
  -- Exactly what gets posted, replaced in place when the founder sends an
  -- edited version back.
  draft_text           text not null,
  -- pending — sent to Telegram, waiting for a tap
  -- edited  — the founder replied with new text; waiting for a tap on THAT
  -- posted  — the comment exists on Reddit, permalink below
  -- skipped — the founder said no
  -- failed  — a tap happened and Reddit refused; the reason is in error
  status               text not null default 'pending'
                         check (status in ('pending', 'edited', 'posted', 'skipped', 'failed')),
  -- Absolute URL of the posted comment. Null until posted.
  permalink            text,
  posted_at            timestamptz,
  -- Reddit's refusal in plain words, as shown to the founder in Telegram.
  error                text,
  -- The Telegram message carrying this draft's buttons. Bigint because message
  -- ids are not bounded by int4 and a wrapped id would address someone else's
  -- draft.
  telegram_message_id  bigint,
  meta                 jsonb
);

comment on table public.radar_drafts is
  'One row per drafted reply offered to the founder in Telegram with Post as me / Skip buttons. Holds the text a callback id points at; nothing here posts on its own.';
comment on column public.radar_drafts.thing_id is
  'Reddit fullname of the parent THREAD (t3_ + base-36 id). The dedup key for posting: the partial unique index below allows at most one posted comment per thread.';
comment on column public.radar_drafts.status is
  'pending = awaiting a tap; edited = the founder sent replacement text and it awaits its own tap; posted = live on Reddit; skipped = declined; failed = Reddit refused, reason in error.';
comment on column public.radar_drafts.telegram_message_id is
  'The message carrying the buttons. A Telegram reply quotes only a message id, so this is the only way back from that reply to this draft.';

-- ------------------------------------------------------------
-- One comment per thread, enforced by the database.
--
-- The worker checks before posting, but two taps a second apart both pass that
-- check and both post. A partial unique index makes the second INSERT/UPDATE
-- fail instead, which is the difference between "we try not to double-post"
-- and "we cannot". Partial, because the same thread may legitimately have a
-- skipped draft and a pending one.
-- ------------------------------------------------------------
create unique index if not exists uq_radar_drafts_posted_thing
  on public.radar_drafts (thing_id)
  where status = 'posted';

-- The daily cap counts posted rows in the last 24 hours; the callback handler
-- looks a draft up by its id (the primary key already answers that).
create index if not exists idx_radar_drafts_posted_at
  on public.radar_drafts (posted_at desc)
  where status = 'posted';

-- A Telegram reply arrives with a message id and the handler has to find the
-- draft it belongs to.
create index if not exists idx_radar_drafts_message_id
  on public.radar_drafts (telegram_message_id);

-- ------------------------------------------------------------
-- RLS — deny all
--
-- RLS on with no policies means anon and authenticated see nothing and can
-- write nothing through PostgREST. The revoke drops the table-level privilege
-- too, so a policy added by accident in a later migration still grants nothing
-- on its own. The service role bypasses RLS, which is how the worker reads and
-- writes.
-- ------------------------------------------------------------
alter table public.radar_drafts enable row level security;

revoke all on public.radar_drafts from anon, authenticated;

-- Make the new table visible to PostgREST at once.
notify pgrst, 'reload schema';
