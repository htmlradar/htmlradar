-- 041_outbox_kinds.sql
-- ------------------------------------------------------------
-- Two more things the worker can say: 'heartbeat' and 'sentinel'.
--
-- WHY
--
-- The maintenance register (docs/control/MAINTENANCE-REGISTER.md) lists the
-- duties that never close — the abuse queue, the failed-email sweep, the daily
-- thread scan. Reading it was a thing a session did by hand, so "nobody looked
-- for two days" left exactly the same trace as "somebody looked and all was
-- well", which is no trace at all. Two kinds close that gap:
--
--   'heartbeat' — a maintenance session stamping "I ran the register today".
--                 One row, written by whoever did the pass. Its absence is
--                 the signal; its presence is the receipt.
--   'sentinel'  — the daily 03:30 UTC cron (packages/monitor, sentinel())
--                 reporting the machine-checkable half of that register, and
--                 whether a heartbeat has been stamped in the last 48 hours.
--
-- Both ride in telegram_outbox rather than a table of their own, because they
-- are messages to the founder and this is where messages to the founder are
-- written down. A heartbeat with nothing sent is a row with telegram_ok null,
-- the same shape scan_run already uses.
--
-- The constraint is dropped and re-added rather than altered, because a check
-- constraint has no ALTER form. `drop constraint if exists` first makes the
-- whole file safe to run twice.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
-- ORDERING: run this AFTER 038 (telegram_outbox).
-- ------------------------------------------------------------

alter table public.telegram_outbox
  drop constraint if exists telegram_outbox_kind_check;

alter table public.telegram_outbox
  add constraint telegram_outbox_kind_check
  check (kind in ('alert', 'scan', 'scan_run', 'test', 'heartbeat', 'sentinel'));

comment on column public.telegram_outbox.kind is
  'alert = health/incident message; scan = the daily thread-scan message that was sent; scan_run = one per scan run, sent or not; test = sent by hand to prove the path; heartbeat = a maintenance session stamping the register; sentinel = the daily sentinel report on the register''s machine-checkable duties.';

notify pgrst, 'reload schema';
