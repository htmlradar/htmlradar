-- 024_app_error_log.sql
-- ------------------------------------------------------------
-- Catch-all backend error log. Lives alongside the analytics
-- app_events table (006) and the webhook-specific
-- webhook_events_log (022). This one captures everything that
-- otherwise gets swallowed silently: failed server actions,
-- third-party API errors (Polar, Supabase, R2), unhandled
-- exceptions in edge routes, anything an operator would need
-- to diagnose a user report.
--
-- Service role writes only. RLS enabled with no policies. Reads
-- happen via admin SQL editor, not in-app.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists app_error_log (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id     uuid references profiles(id) on delete set null,
  source      text not null,
  level       text not null default 'error',
  message     text not null,
  route       text,
  context     jsonb,
  user_agent  text
);

create index if not exists app_error_log_occurred_at_idx
  on app_error_log (occurred_at desc);

create index if not exists app_error_log_user_idx
  on app_error_log (user_id, occurred_at desc)
  where user_id is not null;

create index if not exists app_error_log_source_idx
  on app_error_log (source, occurred_at desc);

alter table app_error_log enable row level security;
