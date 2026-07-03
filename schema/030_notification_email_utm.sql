-- 030_notification_email_utm.sql
-- ------------------------------------------------------------
-- Tag the dashboard links inside notification emails with UTM params so
-- "owner came back because we emailed them" is attributable in analytics.
-- Without this, an email click-through is indistinguishable from a direct
-- visit (mail clients strip referrers). events-client.ts already captures
-- utm_* on every page.viewed — no app change needed.
--
-- Touches ONLY the v_dashboard_url assignments from 025 (first-open email)
-- and 028 (disabled-link email); everything else in those functions is
-- unchanged. Re-declaring the full functions here would drift from their
-- canonical files, so this migration patches the URL via a targeted
-- re-create of each function body's current form: run AFTER 025 and 028.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create or replace). NOTE: this file intentionally re-states the two
-- functions from 025/028 with only the URL lines changed — if you later
-- edit 025/028, port the UTM suffix along.
-- ------------------------------------------------------------

-- The two URL construction lines change from:
--   v_dashboard_url := 'https://htmlradar.com/dashboard/' || v_share.slug;
-- to the tagged versions below. Because the functions are large and
-- otherwise unchanged, apply via targeted replace on the live definitions:

do $$
declare
  fn_src text;
begin
  -- 1. notify_on_first_open (from 025)
  select pg_get_functiondef(oid) into fn_src
  from pg_proc where proname = 'notify_on_first_open';
  if fn_src is null then
    raise exception 'notify_on_first_open not found — run 025 first';
  end if;
  if position('utm_source=email' in fn_src) = 0 then
    fn_src := replace(
      fn_src,
      '''https://htmlradar.com/dashboard/'' || v_share.slug',
      '''https://htmlradar.com/dashboard/'' || v_share.slug || ''?utm_source=email&utm_medium=notification&utm_campaign=first_open'''
    );
    execute fn_src;
  end if;

  -- 2. notify_disabled_attempt (from 028)
  select pg_get_functiondef(oid) into fn_src
  from pg_proc where proname = 'notify_disabled_attempt';
  if fn_src is null then
    raise exception 'notify_disabled_attempt not found — run 028 first';
  end if;
  if position('utm_source=email' in fn_src) = 0 then
    fn_src := replace(
      fn_src,
      '''https://htmlradar.com/dashboard/'' || v_share.slug',
      '''https://htmlradar.com/dashboard/'' || v_share.slug || ''?utm_source=email&utm_medium=notification&utm_campaign=disabled_open_attempt'''
    );
    execute fn_src;
  end if;
end $$;
