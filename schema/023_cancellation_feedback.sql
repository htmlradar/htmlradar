-- 023_cancellation_feedback.sql
-- ------------------------------------------------------------
-- Captures why users cancel their Pro subscription so we can spot
-- the dominant reason and fix the actual problem (price, missing
-- feature, low usage, switched tool, etc.) instead of guessing.
--
-- Only the service-role key (server actions from /settings) writes
-- here. RLS is enabled with no policies — denies everyone else.
-- Reads happen via admin SQL editor, not in-app.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists cancellation_feedback (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  subscription_id text not null,
  reason          text not null,
  comment         text,
  created_at      timestamptz not null default now()
);

create index if not exists cancellation_feedback_profile_idx
  on cancellation_feedback (profile_id, created_at desc);

alter table cancellation_feedback enable row level security;
