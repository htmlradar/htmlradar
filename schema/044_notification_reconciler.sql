-- 044_notification_reconciler.sql
-- ------------------------------------------------------------
-- Closes the gap 003 documented but never finished: every notification
-- email is inserted into `notifications_log` as status='queued' with the
-- pg_net `request_id` that would let something look up what actually
-- happened, and nothing ever does. pg_net's own `net._http_response` rows
-- expire quickly (Supabase's own pg_net housekeeping deletes them well
-- inside a day), so a 'queued' row that sent fine and a 'queued' row whose
-- request pg_net silently dropped become indistinguishable within hours.
-- As of this migration, production carries 283 rows stuck at 'queued' —
-- this is not a hypothetical.
--
-- WHAT reconcile_notification_sends() DOES, IN ORDER
--
--   1. A 'queued' row whose request_id joins a net._http_response with a
--      2xx status_code -> 'sent'. Resend accepted the request.
--   2. A 'queued' row whose request_id joins a response with any other
--      status_code, or a response with no status_code at all (pg_net's own
--      failure: timeout, DNS, connection refused) -> 'failed', with the
--      code — or pg_net's error text when there was no code — recorded in
--      error_message.
--   3. A 'queued' row older than 30 minutes with NO matching response row
--      at all -> 'unverified'. Not "assume it sent" and not "assume it
--      failed": pg_net's response already expired before anything checked,
--      so the honest answer is that nobody knows. A row younger than 30
--      minutes with no response yet is left as 'queued' — pg_net may still
--      be working on it, or the response just hasn't arrived — and picked
--      up on a later run.
--
-- Every branch's WHERE starts from status='queued', so a row that already
-- resolved to 'sent', 'failed' or 'unverified' is never touched again:
-- running this twice (or every 10 minutes, forever) is a no-op on anything
-- it already answered.
--
-- 'sent' and 'unverified' are new values for the CHECK constraint 003 put
-- on notifications_log.status ('queued','delivered','failed','skipped').
-- 'sent' rather than reusing 'delivered': a 2xx from pg_net only means
-- Resend's API accepted the request, not that the recipient's mail server
-- accepted it — calling that "delivered" would claim more than this
-- reconciler can see. 'delivered' is left as-is, unused exactly as it was
-- before this migration; nothing here writes it.
--
-- SCHEDULING
--
-- pg_cron is confirmed available on this Supabase project (present in
-- pg_available_extensions, not yet installed — checked directly against
-- production via `select * from pg_extension` / `pg_available_extensions`
-- before writing this) and, like pg_net in 001, is one of the extensions
-- Supabase pre-authorises for the migration role without superuser. The
-- extension creation and the schedule call are each wrapped in their own
-- guard below: a self-hosted install running plain Postgres without
-- pg_cron built (or this file's own test run, see tests/) gets the
-- reconcile function created and callable by hand or by an external
-- scheduler, not a migration that aborts.
--
-- HANDOFF — packages/monitor/src/index.ts, sentinel()
--
-- sentinel() already reads notifications_log for status=eq.failed rows in
-- the last 24h (SENTINEL_WINDOW_MS) and alerts if any exist; a separate
-- 5-minute check does the same over the last 30 minutes. Its next revision
-- should add a status=eq.unverified count over the same 24h window,
-- reported alongside the failed count. A handful of 'unverified' rows is
-- expected (the 10-minute cron cadence keeps them rare, not zero); a count
-- that keeps climbing is the signal that the cron stopped firing or pg_net
-- itself is down, which today would look identical to "everything is
-- fine" because nothing ever left 'queued'. This migration does not touch
-- the monitor: schema only, this comment is the handoff.
--
-- Apply AFTER 003_triggers.sql (notifications_log, its status check, the
-- request_id column, the partial index on ('queued','failed') — all reused
-- as-is here) and after every migration that writes 'queued' rows into it
-- (006, 010, 013, 014, 020, 021, 025, 028, 037, 039 — same table, same
-- contract, nothing here needs to know which trigger wrote a given row).
-- Idempotent: drop/add on the constraint, create-or-replace on the
-- function, unschedule-then-schedule on the cron job.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. notifications_log.status gains 'sent' and 'unverified'.
-- ------------------------------------------------------------
alter table public.notifications_log
  drop constraint if exists notifications_log_status_check;

alter table public.notifications_log
  add constraint notifications_log_status_check
  check (status in ('queued', 'delivered', 'failed', 'skipped', 'sent', 'unverified'));

-- ------------------------------------------------------------
-- 2. reconcile_notification_sends()
--
-- SECURITY DEFINER so it can read net._http_response (service_role and the
-- function owner can; anon/authenticated never could and don't need to)
-- regardless of who calls it. No arguments, nothing to validate — the
-- table's own status column is the only input.
-- ------------------------------------------------------------
create or replace function public.reconcile_notification_sends()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 2xx: pg_net's response says the request was accepted.
  update notifications_log nl
     set status = 'sent'
    from net._http_response r
   where nl.status = 'queued'
     and nl.request_id = r.id
     and r.status_code between 200 and 299;

  -- Any other response pg_net recorded: a real non-2xx status code, or a
  -- response row with no status_code at all — pg_net's own failure (a
  -- timeout, DNS, connection refused) rather than an HTTP error.
  update notifications_log nl
     set status = 'failed',
         error_message = coalesce('HTTP ' || r.status_code::text, r.error_msg, 'pg_net request failed')
    from net._http_response r
   where nl.status = 'queued'
     and nl.request_id = r.id
     and (r.status_code is null or r.status_code not between 200 and 299);

  -- No response row at all, and old enough that pg_net's own retention has
  -- already dropped whatever it had. Never guess success or failure here —
  -- 'unverified' says plainly that nobody knows.
  update notifications_log nl
     set status = 'unverified'
   where nl.status = 'queued'
     and nl.created_at < now() - interval '30 minutes'
     and not exists (
       select 1 from net._http_response r where r.id = nl.request_id
     );
end;
$$;

comment on function public.reconcile_notification_sends() is
  'Joins queued notifications_log rows against net._http_response by request_id: 2xx -> sent, any other response -> failed (code in error_message), no response after 30 minutes -> unverified (the response already expired; never guessed). Only touches status=''queued'' rows, so re-running it is a no-op. Scheduled every 10 minutes via pg_cron below; also callable by hand as service_role.';

revoke all on function public.reconcile_notification_sends() from public, anon, authenticated;
grant execute on function public.reconcile_notification_sends() to service_role;

-- ------------------------------------------------------------
-- 3. Schedule it every 10 minutes.
--
-- Two separate guarded blocks: the extension may already be installed (or
-- may fail to install, e.g. a self-hosted Postgres without it built), and
-- the schedule call should only run once the extension is actually there.
-- Neither failure aborts the rest of this migration.
-- ------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable (%): reconcile_notification_sends() must be scheduled externally, every 10 minutes.', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'reconcile_notification_sends') then
      perform cron.unschedule('reconcile_notification_sends');
    end if;
    perform cron.schedule(
      'reconcile_notification_sends',
      '*/10 * * * *',
      'select public.reconcile_notification_sends();'
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
