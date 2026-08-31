-- 044_notification_reconciler_test.sql
-- ------------------------------------------------------------
-- Tests for 044_notification_reconciler.sql. Four things are worth testing
-- here and nothing else is:
--
--   1. A queued row whose request_id joins a fake 2xx response becomes
--      'sent'.
--   2. A queued row whose request_id joins a fake non-2xx response becomes
--      'failed', with the code recorded in error_message.
--   3. A queued row old enough that no response row exists at all (the
--      orphan pg_net's own retention already dropped) becomes
--      'unverified' — never guessed as sent or failed.
--   4. Running reconcile_notification_sends() a second time changes
--      nothing: every WHERE clause in the function starts from
--      status = 'queued', so a row already resolved is never revisited.
--
-- A fifth, cheap check rides along: a queued row that is BOTH young and
-- unanswered stays 'queued'. That's the negative case of "never guess" —
-- worth one assertion since the whole point of the 30-minute cutoff is
-- that a fresh row is not yet evidence of anything.
--
-- WHAT IS NOT TESTED HERE: the pg_cron schedule itself. Scheduling a cron
-- job and having it actually fire needs the pg_cron background worker
-- running, which a scratch database spun up for one transaction does not
-- have. The migration's own two guarded DO blocks (extension, then
-- schedule) are what make that safe to skip: on a Postgres without pg_cron
-- at all — this scratch database included — they log a NOTICE and move on,
-- proven by the migration applying cleanly below.
--
-- THE net._http_response STUB — READ THIS BEFORE RUNNING ANYTHING
--
-- 001_init.sql unconditionally runs `create extension if not exists
-- "pg_net"`, and a stock `postgres:15` Docker image does not ship the real
-- pg_net (no background worker, no real HTTP delivery — nor would you want
-- that in a test: this file needs to fake specific response codes on
-- demand, which the real extension's async delivery can't give you
-- deterministically). The fix used here is a fake pg_net EXTENSION, not a
-- fake schema created after the fact, so that 001's own
-- `create extension if not exists "pg_net"` line succeeds unmodified:
--
--   docker exec hr-schema-test bash -c 'cat > /usr/share/postgresql/15/extension/pg_net.control <<EOF
--   comment = '"'"'stub: schema net + _http_response table only, for HTMLRadar schema tests'"'"'
--   default_version = '"'"'0.1'"'"'
--   relocatable = false
--   schema = net
--   EOF
--   cat > /usr/share/postgresql/15/extension/pg_net--0.1.sql <<EOF
--   create table _http_response (
--     id           bigint primary key,
--     status_code  integer,
--     content_type text,
--     headers      jsonb,
--     content      text,
--     timed_out    boolean,
--     error_msg    text,
--     created      timestamptz not null default now()
--   );
--   EOF'
--
-- `schema = net` in the control file makes `create extension pg_net` create
-- the `net` schema itself and put the one table in it — matching the real
-- extension's shape (checked directly against production:
-- `select column_name, data_type from information_schema.columns where
-- table_schema='net' and table_name='_http_response'`) closely enough for
-- everything this migration reads: id, status_code, error_msg. Nothing
-- here needs net.http_post to exist at all — the notify_on_first_open
-- trigger that would call it is disabled before every fixture insert below
-- (see Section A), so it's never invoked.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. Everything sits inside one
-- transaction that ROLLBACKs at the end, so nothing is left behind — but a
-- rollback does not undo a mistake made against production, so point psql
-- at a scratch copy.
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   …then the pg_net stub above, then:
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   psql -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto'
--   …then the role setup and the auth.users / auth.uid() stub 034's and
--   043's headers assume a real Supabase project already provides:
--
--   create role anon nologin;
--   create role authenticated nologin;
--   create role service_role nologin bypassrls;
--   grant usage on schema public to anon, authenticated, service_role;
--   grant all on all tables in schema public to anon, authenticated, service_role;
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--   create schema if not exists auth;
--   create table auth.users (id uuid primary key default gen_random_uuid(), email text);
--   grant usage on schema auth to postgres;
--   grant select on auth.users to service_role, authenticated;
--   create or replace function auth.uid() returns uuid language sql stable as
--     $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
--
--   …then schema/001_init.sql, schema/003_triggers.sql,
--   schema/044_notification_reconciler.sql, then this file.
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Helpers (same shape as 034's, 037's and 043's)
-- ------------------------------------------------------------
create or replace function pg_temp.expect_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %: expected %, got %', label, want, got;
  end if;
  raise notice 'PASS  %', label;
end;
$$;

-- ------------------------------------------------------------
-- Section A — fixtures
--
-- One owner, one document, one share, one viewer, four sessions — one per
-- notifications_log row this file needs. trg_notify_on_first_open fires on
-- every insert into sessions regardless of how the row gets there, and it
-- calls net.http_post (which does not exist in the stub) and reads
-- vault.decrypted_secrets (which does not exist at all here) — neither of
-- which this file is testing, so the trigger is disabled for every fixture
-- insert, the same way 043's test disabled trg_block_custom_slug_delete
-- around the one operation its own trigger would have blocked.
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values (gen_random_uuid(), 'reconcile-owner@example.test');
insert into t_ids select 'owner', id from auth.users where email = 'reconcile-owner@example.test';

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Reconciler test deck', 'url', 'https://example.test/deck.html'
from t_ids where k = 'owner';
insert into t_ids select 'doc', id from documents where title = 'Reconciler test deck';

insert into document_shares (id, document_id, owner_id, slug)
select gen_random_uuid(), (select v from t_ids where k = 'doc'), (select v from t_ids where k = 'owner'),
       'reconciler-test-share';
insert into t_ids select 'share', id from document_shares where slug = 'reconciler-test-share';

insert into viewers (id, share_id, email)
select gen_random_uuid(), (select v from t_ids where k = 'share'), 'viewer@example.test';
insert into t_ids select 'viewer', id from viewers where email = 'viewer@example.test';

alter table sessions disable trigger trg_notify_on_first_open;

insert into sessions (id, share_id, viewer_id, document_version)
select gen_random_uuid(), (select v from t_ids where k = 'share'), (select v from t_ids where k = 'viewer'), 1
from generate_series(1, 4);

alter table sessions enable trigger trg_notify_on_first_open;

insert into t_ids
select 'session_' || row_number() over (order by started_at), id
from sessions where share_id = (select v from t_ids where k = 'share');

-- Fake pg_net responses: 200 for the sent case, 500 for the failed case.
-- No row at all for the other two sessions — one becomes the orphan, one
-- stays queued.
insert into net._http_response (id, status_code, error_msg) values
  (90001, 200, null),
  (90002, 500, null);

insert into notifications_log (session_id, email_to, request_id, status, created_at) values
  ((select v from t_ids where k = 'session_1'), 'owner@example.test', 90001, 'queued', now()),
  ((select v from t_ids where k = 'session_2'), 'owner@example.test', 90002, 'queued', now()),
  ((select v from t_ids where k = 'session_3'), 'owner@example.test', 90003, 'queued', now() - interval '45 minutes'),
  ((select v from t_ids where k = 'session_4'), 'owner@example.test', 90004, 'queued', now());

-- ------------------------------------------------------------
-- Section B — one run
-- ------------------------------------------------------------
select reconcile_notification_sends();

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90001),
  'sent',
  'B1 a fake 200 response becomes sent');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90002),
  'failed',
  'B2 a fake 500 response becomes failed');

select pg_temp.expect_eq(
  (select error_message from notifications_log where request_id = 90002),
  'HTTP 500',
  'B3 …with the code recorded in error_message');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90003),
  'unverified',
  'B4 an old orphan with no response row becomes unverified');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90004),
  'queued',
  'B5 a young row with no response row yet is left alone, not guessed at');

-- ------------------------------------------------------------
-- Section C — running it again is a no-op
--
-- Change what the fake responses say after the fact. If the second run
-- touched already-resolved rows, this would flip 90001 to failed; it must
-- not, because the function's every UPDATE starts from status = 'queued'
-- and none of these rows are 'queued' any more.
-- ------------------------------------------------------------
update net._http_response set status_code = 500 where id = 90001;

select reconcile_notification_sends();

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90001),
  'sent',
  'C1 a second run does not revisit an already-sent row');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90002),
  'failed',
  'C2 …nor an already-failed one');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90003),
  'unverified',
  'C3 …nor an already-unverified one');

select pg_temp.expect_eq(
  (select status from notifications_log where request_id = 90004),
  'queued',
  'C4 …and the still-young row is still just queued, still not guessed at');

rollback;
