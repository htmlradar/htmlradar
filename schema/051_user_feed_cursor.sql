-- 051_user_feed_cursor.sql
-- ------------------------------------------------------------
-- Cursor for the user feed in the monitor worker.
--
-- The founder learns that someone signed up, shared for the first time, was
-- read by an outsider, or hit the free limit by opening a dashboard — which
-- means he learns it late, or not at all. The five-minute cron now says each
-- of those out loud, once, in Telegram.
--
-- "Once" is the whole problem. A cron that re-reads "the last five minutes"
-- every five minutes double-sends the moment a run is slow, retried, or
-- overlaps the previous one. So the window is closed on both ends and its
-- start is this row: each run reads rows in [last_run_at, now), sends, then
-- writes now. Idempotence lives in the table, not in the worker's memory —
-- a redeploy, a restart or a second instance cannot forget it.
--
-- Same shape and same reasoning as analytics_replay_cursor (schema/029):
-- single row, service-role only, PATCHed after the work rather than before,
-- so a failed run simply doesn't advance and the next one covers the gap.
--
-- Seeded at now() rather than at the epoch, on purpose. The replay cursor
-- starts at 0 because backfilling PostHog with the full history is the point;
-- here a backfill would mean every sign-up since launch arriving as a separate
-- Telegram message the first time this runs. The feed is about what just
-- happened, so it starts from the moment it is installed.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists user_feed_cursor (
  id          int primary key default 1 check (id = 1),  -- single row
  last_run_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into user_feed_cursor (id, last_run_at)
values (1, now())
on conflict (id) do nothing;

-- Service-role only: RLS on with no policies denies anon + authenticated.
alter table user_feed_cursor enable row level security;
revoke all on user_feed_cursor from anon, authenticated;

-- ------------------------------------------------------------
-- One more thing the worker can say: kind='user_feed', one message per
-- meaningful user moment.
--
-- telegram_outbox's kind is a check constraint (038, last extended in 042),
-- and a check constraint has no ALTER form, so it is dropped and re-added.
-- The 'drop if exists' first makes this safe to run twice.
--
-- This matters more here than for the other kinds: sendTelegram writes its
-- row AFTER the send, and swallows a failed write. A kind the constraint
-- rejects would therefore send the founder a message and leave no trace of
-- it — the exact hole schema/038 was written to close.
-- ------------------------------------------------------------
alter table public.telegram_outbox
  drop constraint if exists telegram_outbox_kind_check;

alter table public.telegram_outbox
  add constraint telegram_outbox_kind_check
  check (kind in (
    'alert', 'scan', 'scan_run', 'test', 'heartbeat', 'sentinel', 'radar', 'user_feed'
  ));

comment on column public.telegram_outbox.kind is
  'alert = health/incident message; scan = a sent thread-scan message (legacy); scan_run = one per radar mining run, sent or not; test = sent by hand to prove the path; heartbeat = a maintenance session stamping the register; sentinel = the daily sentinel report; radar = the daily listening-radar digest; user_feed = one real-user moment (sign-up, first share, outside read, upgrade interest).';

-- Make the new table and the widened constraint visible to PostgREST at once.
notify pgrst, 'reload schema';
