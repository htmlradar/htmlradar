-- 038_telegram_outbox.sql
-- ------------------------------------------------------------
-- Every message the monitor worker sends to Telegram, written down.
--
-- WHY THIS TABLE EXISTS
--
-- A Telegram bot cannot read its own sent history. The Bot API hands out
-- incoming updates and nothing else — there is no "what did I say" call. So
-- the only copy of anything this company has ever said to its founder lived
-- on the founder's phone, and an agent that needed to know what yesterday's
-- scan sent had to ask him to paste a screenshot of it.
--
-- The silent run is worse than the unreadable one. On 2026-08-30 the daily
-- thread scan ran, found nothing, sent nothing, and left no trace of having
-- run at all. From outside, that is indistinguishable from a cron that never
-- fired, a revoked bot token, and Reddit refusing every query — three very
-- different problems with one identical symptom, which is silence.
--
-- This table makes all of that legible. The worker writes one row per send
-- attempt with the full text and whether Telegram accepted it, and one row
-- per scan run whether or not anything was sent, carrying the per-query
-- outcome of all ten fetches in `meta`. "It ran and there was genuinely
-- nothing" and "every fetch 429'd" stop looking alike.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No bot token, ever. The token lives in the request URL, never in a row.
-- The chat id may ride in `meta`: it is not a secret, it is the founder's own
-- chat, and without it a row cannot be attributed to a destination.
--
-- No retry column, no delivery status beyond `telegram_ok`. Telegram either
-- took the message or it did not; a message the founder did not receive is
-- re-sent by fixing the cause and running the job again, not by a queue.
--
-- No foreign key to anything. This is a log of things said, and it must
-- survive the deletion of whatever prompted them.
--
-- HOW IT IS WRITTEN
--
-- The monitor worker POSTs straight to PostgREST with the service-role key it
-- already holds for every other read and write it does. No RPC: an RPC exists
-- to let an untrusted caller write safely, and there is no untrusted caller
-- here — the only writer is a Cloudflare Worker holding a secret.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists public.telegram_outbox (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  -- 'alert'    — a health/incident message (5-minute cron)
  -- 'scan'     — the daily thread-scan message that was actually sent
  -- 'scan_run' — one per scan run, sent or not, carrying the per-query
  --              outcomes in meta; this is the row that ends silent runs
  -- 'test'     — a message sent by hand to prove the path works
  kind           text not null check (kind in ('alert', 'scan', 'scan_run', 'test')),
  -- The function that decided to send, e.g. 'scanThreads'. Free text on
  -- purpose: a check constraint here would need a migration every time a new
  -- caller appears, and the cost of a typo is one confusing row.
  source         text,
  message        text,
  -- Null on a scan_run that had nothing to send: neither true nor false is
  -- honest about a send that never happened.
  telegram_ok    boolean,
  telegram_error text,
  meta           jsonb
);

comment on table public.telegram_outbox is
  'Every outgoing Telegram message and every scan run. Exists because a Telegram bot cannot read back its own sent history, so without this the record lives only on the founder''s phone.';
comment on column public.telegram_outbox.telegram_error is
  'Telegram''s refusal, verbatim and truncated. Never contains the bot token — the token is in the request URL, not the body.';
comment on column public.telegram_outbox.meta is
  'Free-form context. For kind=scan_run: one entry per fetch (source, query, http status or error, item count), the total item count, and whether a message was sent.';

-- Every question anyone asks this table is "what happened recently", so the
-- one index is the one that answers it.
create index if not exists idx_telegram_outbox_created_at
  on public.telegram_outbox (created_at desc);

-- ------------------------------------------------------------
-- RLS — deny all
--
-- RLS on with no policies means anon and authenticated see nothing and can
-- write nothing through PostgREST. The revoke is the belt to that braces: it
-- drops the table-level privilege too, so a policy added by accident in some
-- later migration still grants nothing on its own.
--
-- The service role bypasses RLS, which is how the worker writes and how an
-- agent reads. Nobody else has any business here: these rows quote internal
-- operational messages, and a customer has no reason to see them.
-- ------------------------------------------------------------
alter table public.telegram_outbox enable row level security;

revoke all on public.telegram_outbox from anon, authenticated;

-- Make the new table visible to PostgREST immediately.
notify pgrst, 'reload schema';
