-- 029_analytics_replay_cursor.sql
-- ------------------------------------------------------------
-- Cursor for the app_events → PostHog replay job in the monitor worker.
--
-- 006 made app_events deliberately PostHog-shaped ("so we can replay
-- later"). This is the "later": the monitor cron reads rows with
-- id > last_event_id, POSTs them to PostHog's /batch endpoint, and
-- advances the cursor. Single row, service-role only — the browser
-- never talks to PostHog, so the /privacy "no third-party trackers"
-- promise holds.
--
-- Starts at 0 so the first runs backfill the full event history.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists analytics_replay_cursor (
  id            int primary key default 1 check (id = 1),  -- single row
  last_event_id bigint not null default 0,
  updated_at    timestamptz not null default now()
);

insert into analytics_replay_cursor (id, last_event_id)
values (1, 0)
on conflict (id) do nothing;

-- Service-role only: RLS on with no policies denies anon + authenticated.
alter table analytics_replay_cursor enable row level security;
revoke all on analytics_replay_cursor from anon, authenticated;
