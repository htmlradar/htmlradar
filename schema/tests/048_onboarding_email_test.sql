-- 048_onboarding_email_test.sql
-- ------------------------------------------------------------
-- Tests for 048_onboarding_email.sql. What is worth testing here is not the
-- e-mail body — a human looks at that in the rendered preview — but the
-- three things that decide whether a stranger's inbox gets one copy, none,
-- or two:
--
--   A. WHO IS PICKED. The window (older than 15 minutes, younger than 24
--      hours) and the exclusions (internal domains, comped accounts).
--   B. EXACTLY ONCE. A second run, and a third, must send nothing more.
--   C. THE PAPER TRAIL. One notifications_log row per send, kind
--      'onboarding', so the reconciler and the sentinel can see it, and one
--      app_events row.
--
-- Plus the two safety properties: no customer-reachable role may execute the
-- function, and a database with no Resend secrets must claim nothing (so the
-- sends still happen once the secrets are fixed).
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users rows and
-- profiles and calls the real send function. Everything is inside one
-- transaction that ROLLBACKs at the end, but a rollback does not undo a
-- mistake made against production — and this file's whole subject is a
-- function that sends mail to customers. Point psql at a throwaway.
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:16-alpine
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   …the Supabase role setup at the top of schema/tests/034_api_keys_test.sql,
--   …an auth.users table and auth.uid(), and stubs for net.http_post and
--     vault.decrypted_secrets (a bare Postgres has neither pg_net nor Vault;
--     the stub http_post should record its arguments in a table so the
--     assertions below can read what would have been sent),
--   …then schema/001 through 048 in order,
--   …then this file.
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Fixtures. Seven accounts, one per rule the sweep has to apply.
-- created_at is set explicitly because the whole selection is a time window;
-- handle_new_user() (001) makes the profile row, we age it afterwards.
-- ------------------------------------------------------------
create temporary table t_case (label text primary key, email text, id uuid);

insert into auth.users (email) values
  ('eligible@example.test'),        -- 2 hours old, ordinary customer: SEND
  ('just-signed-up@example.test'),  -- 3 minutes old: too new
  ('stale@example.test'),           -- 30 hours old: outside the window
  ('qa-bot@htmlradar.com'),         -- internal domain
  ('founder@draconic.ai'),          -- internal domain
  ('comped@example.test'),          -- comped account
  ('already@example.test');         -- onboarding_sent_at already stamped

insert into t_case (label, email, id)
select split_part(email, '@', 1), email, id from auth.users;

update profiles set created_at = now() - interval '2 hours'   where email = 'eligible@example.test';
update profiles set created_at = now() - interval '3 minutes' where email = 'just-signed-up@example.test';
update profiles set created_at = now() - interval '30 hours'  where email = 'stale@example.test';
update profiles set created_at = now() - interval '2 hours'   where email = 'qa-bot@htmlradar.com';
update profiles set created_at = now() - interval '2 hours'   where email = 'founder@draconic.ai';
update profiles set created_at = now() - interval '2 hours', comped = true
                                                              where email = 'comped@example.test';
update profiles set created_at = now() - interval '2 hours',
                    onboarding_sent_at = now() - interval '1 hour'
                                                              where email = 'already@example.test';

-- ------------------------------------------------------------
-- A. Who is picked
-- ------------------------------------------------------------
do $$
declare v_sent int; v_to text;
begin
  select public.send_onboarding_emails() into v_sent;
  if v_sent <> 1 then
    raise exception 'FAIL A1: expected exactly 1 send, got %', v_sent;
  end if;
  raise notice 'PASS  A1 one eligible account of seven is picked';

  select email into v_to from profiles where onboarding_sent_at is not null
     and email <> 'already@example.test';
  if v_to <> 'eligible@example.test' then
    raise exception 'FAIL A2: the wrong account was picked: %', v_to;
  end if;
  raise notice 'PASS  A2 the account picked is the ordinary customer, not an excluded one';
end;
$$;

do $$
declare v_row record;
begin
  for v_row in
    select label, email from t_case
     where label in ('just-signed-up', 'stale', 'qa-bot', 'founder', 'comped')
  loop
    if exists (select 1 from profiles
                where email = v_row.email and onboarding_sent_at is not null) then
      raise exception 'FAIL A3: % should not have been mailed', v_row.email;
    end if;
  end loop;
  raise notice 'PASS  A3 too-new, too-old, internal-domain and comped accounts are all left alone';
end;
$$;

-- ------------------------------------------------------------
-- B. Exactly once
-- ------------------------------------------------------------
do $$
declare v_sent int; v_mails int;
begin
  select public.send_onboarding_emails() into v_sent;
  if v_sent <> 0 then
    raise exception 'FAIL B1: a second run sent % more', v_sent;
  end if;
  select public.send_onboarding_emails() into v_sent;
  if v_sent <> 0 then
    raise exception 'FAIL B2: a third run sent % more', v_sent;
  end if;

  select count(*) into v_mails from net.sent_mail
   where body->'to' @> '["eligible@example.test"]'::jsonb;
  if v_mails <> 1 then
    raise exception 'FAIL B3: the eligible account received % e-mails, expected 1', v_mails;
  end if;
  raise notice 'PASS  B1-B3 re-running the sweep sends nothing more; exactly one e-mail exists';
end;
$$;

-- ------------------------------------------------------------
-- C. What actually gets posted, and the paper trail
-- ------------------------------------------------------------
do $$
declare v_body jsonb; v_status text; v_kind text; v_req bigint; v_events int;
begin
  select body into v_body from net.sent_mail
   where body->'to' @> '["eligible@example.test"]'::jsonb;

  if v_body->>'subject' <> 'Your HTMLRadar account, and the four ways to use it' then
    raise exception 'FAIL C1: unexpected subject %', v_body->>'subject';
  end if;
  if v_body->>'reply_to' <> 'hello@htmlradar.com' then
    raise exception 'FAIL C2: reply-to must reach hello@, got %', v_body->>'reply_to';
  end if;
  if coalesce(v_body->>'text', '') = '' then
    raise exception 'FAIL C3: no plain-text alternative was sent';
  end if;
  if coalesce(v_body->'headers'->>'List-Unsubscribe', '') = '' then
    raise exception 'FAIL C4: no List-Unsubscribe header';
  end if;
  -- Every image has to be absolute and on the production host: a relative
  -- src in an e-mail resolves against nothing and shows as a broken box.
  if position('src="https://htmlradar.com/brand/email/' in (v_body->>'html')) = 0 then
    raise exception 'FAIL C5: images are not absolute htmlradar.com URLs';
  end if;
  raise notice 'PASS  C1-C5 subject, reply-to, plain-text part, unsubscribe header, absolute images';

  select status, kind, request_id into v_status, v_kind, v_req
    from notifications_log where email_to = 'eligible@example.test';
  if v_status <> 'queued' then
    raise exception 'FAIL C6: notifications_log status is %, expected queued', v_status;
  end if;
  if v_kind is distinct from 'onboarding' then
    raise exception 'FAIL C7: notifications_log kind is %, expected onboarding', v_kind;
  end if;
  if v_req is null then
    raise exception 'FAIL C8: no pg_net request_id was recorded, so nothing can reconcile it';
  end if;
  raise notice 'PASS  C6-C8 one notifications_log row, queued, kind=onboarding, with a request id';

  select count(*) into v_events from app_events
   where event = 'onboarding.email_sent';
  if v_events <> 1 then
    raise exception 'FAIL C9: expected 1 onboarding.email_sent event, got %', v_events;
  end if;
  raise notice 'PASS  C9 one analytics event per send';
end;
$$;

-- ------------------------------------------------------------
-- D. The test hatch reaches an internal address, and still only once.
-- This is the path the founder's own test send uses, so it has to work
-- against a domain the sweep is otherwise forbidden to touch.
-- ------------------------------------------------------------
do $$
declare v_sent int;
begin
  select public.send_onboarding_emails('qa-bot@htmlradar.com') into v_sent;
  if v_sent <> 1 then
    raise exception 'FAIL D1: the test hatch sent %, expected 1', v_sent;
  end if;
  select public.send_onboarding_emails('qa-bot@htmlradar.com') into v_sent;
  if v_sent <> 0 then
    raise exception 'FAIL D2: the test hatch re-sent to an already-mailed account';
  end if;
  raise notice 'PASS  D1-D2 the named-address hatch overrides the domain exclusion, once only';
end;
$$;

-- ------------------------------------------------------------
-- E. No secrets, no claim. A database that cannot send must leave the
-- pending rows pending, or the sends are lost the moment Vault is empty.
-- ------------------------------------------------------------
do $$
declare v_sent int; v_pending int; v_skipped int;
begin
  insert into auth.users (email) values ('later@example.test');
  update profiles set created_at = now() - interval '2 hours' where email = 'later@example.test';

  delete from vault.decrypted_secrets where name = 'resend_api_key';
  select public.send_onboarding_emails() into v_sent;
  if v_sent <> 0 then
    raise exception 'FAIL E1: sent % with no Resend key', v_sent;
  end if;
  select count(*) into v_pending from profiles
   where email = 'later@example.test' and onboarding_sent_at is null;
  if v_pending <> 1 then
    raise exception 'FAIL E2: the row was claimed even though nothing was sent';
  end if;
  select count(*) into v_skipped from notifications_log
   where status = 'skipped' and kind = 'onboarding';
  if v_skipped <> 1 then
    raise exception 'FAIL E3: the skipped send was not logged';
  end if;
  raise notice 'PASS  E1-E3 with no Resend secret: nothing sent, nothing claimed, one skipped row';

  insert into vault.decrypted_secrets values ('resend_api_key', 're_test_key');
  select public.send_onboarding_emails() into v_sent;
  if v_sent <> 1 then
    raise exception 'FAIL E4: the deferred account was not sent once the secret came back';
  end if;
  raise notice 'PASS  E4 the deferred account is sent on the next run after the secret returns';
end;
$$;

-- ------------------------------------------------------------
-- F. Nobody customer-reachable may fire it. A public EXECUTE grant would
-- let any signed-in user replay an onboarding e-mail into any inbox.
-- ------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'public.send_onboarding_emails(text)', 'execute') then
      raise exception 'FAIL F1: % can execute send_onboarding_emails', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.send_onboarding_emails(text)', 'execute') then
    raise exception 'FAIL F2: service_role cannot execute send_onboarding_emails';
  end if;
  raise notice 'PASS  F1-F2 anon and authenticated cannot execute it; service_role can';
end;
$$;

-- ------------------------------------------------------------
-- G. The cron job is NOT scheduled by the migration. It ships off, and it
-- stays off until a human runs the one-line schedule statement.
-- ------------------------------------------------------------
do $$
declare v_jobs int;
begin
  -- Two nested ifs, not one AND: plpgsql plans a statement the first time it
  -- runs it, so an expression naming cron.job would fail to parse on a
  -- database without pg_cron even when the guard is false.
  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where jobname = ''send_onboarding_emails'''
      into v_jobs;
    if v_jobs <> 0 then
      raise exception 'FAIL G1: the migration scheduled the job; it must ship switched off';
    end if;
    raise notice 'PASS  G1 the sweep is not scheduled by the migration';
  else
    raise notice 'PASS  G1 (vacuous) pg_cron is not installed here, so nothing could be scheduled';
  end if;
end;
$$;

rollback;
