-- 022_polar_webhooks.sql
-- ------------------------------------------------------------
-- Idempotency log for Polar webhook events.
--
-- The /api/webhooks/polar route inserts a row keyed on the Polar
-- event id before processing. A duplicate delivery (Polar retries
-- on non-2xx, and occasionally re-fires on transient errors) hits
-- the primary-key conflict and short-circuits — no double tier
-- flips, no double "Pro since" timestamps.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists webhook_events_log (
  event_id    text primary key,
  event_type  text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error       text
);

alter table webhook_events_log enable row level security;

-- No client access; only the service-role key (used by the webhook
-- route) writes here. RLS denies everyone else by default once enabled.

-- Partial index for "find events that failed mid-processing" queries.
-- Most rows have processed_at set, so the partial keeps the index small.
create index if not exists webhook_events_log_unprocessed_idx
  on webhook_events_log (received_at)
  where processed_at is null;

