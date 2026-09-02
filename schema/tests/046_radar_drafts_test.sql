-- 046_radar_drafts_test.sql
-- ------------------------------------------------------------
-- Tests for 046_radar_drafts.sql. Three things are worth testing here and
-- nothing else is:
--
--   1. The status check refuses anything outside the five states. The whole
--      one-tap flow is a state machine over this column; a typo'd status
--      would leave a draft that no handler ever picks up again.
--   2. The partial unique index allows at most ONE posted row per thread,
--      while still allowing any number of pending or skipped ones for the
--      same thread. The worker checks before it posts, but two taps a second
--      apart both pass that check — this index is what makes double-posting
--      to a stranger's thread impossible rather than merely unlikely.
--   3. Nothing customer-facing can read or write the table. These rows quote
--      internal drafts and carry the founder's own Telegram message ids.
--
-- WHAT IS NOT TESTED HERE: the Reddit call, the Telegram call, and the daily
-- cap. All three live in the monitor worker, not in the database, and are
-- covered by packages/monitor/tests/reddit-onetap.test.ts with both APIs
-- stubbed. The database's job is the two invariants above.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. Everything sits inside one
-- transaction that ROLLBACKs at the end, so nothing is left behind — but a
-- rollback does not undo a mistake made against production, so point psql at
-- a scratch copy.
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   psql -v ON_ERROR_STOP=1 -c "create role anon; create role authenticated;
--                               create role service_role bypassrls"
--   psql -v ON_ERROR_STOP=1 -f schema/046_radar_drafts.sql
--   psql -v ON_ERROR_STOP=1 -f schema/tests/046_radar_drafts_test.sql
--
-- 046 stands alone: it creates one table and depends on no earlier file, so
-- unlike 037's test this one does not need the 001/002/003 stack first.
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Helpers (same shape as 034's, 035's and 037's)
-- ------------------------------------------------------------
create or replace function pg_temp.expect_error(sql text, expected text, label text)
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = expected then
      raise notice 'PASS %  (% as expected)', label, expected;
      return;
    end if;
    raise exception 'FAIL %  expected SQLSTATE %, got % (%)',
      label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL %  expected SQLSTATE %, but the statement succeeded',
    label, expected;
end $$;

create or replace function pg_temp.expect_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is not distinct from want then
    raise notice 'PASS %', label;
    return;
  end if;
  raise exception 'FAIL %  expected %, got %', label, want, got;
end $$;

-- ------------------------------------------------------------
-- Section A — the status check
-- ------------------------------------------------------------
insert into radar_drafts (source_url, thing_id, draft_text)
values ('https://www.reddit.com/r/sales/comments/aaa111/x/', 't3_aaa111', 'a draft');

select pg_temp.expect_eq(
  (select status from radar_drafts where thing_id = 't3_aaa111'),
  'pending',
  'A1 a new draft starts pending');

select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text, status)
     values (''https://www.reddit.com/r/sales/comments/aaa222/x/'', ''t3_aaa222'', ''d'', ''queued'')',
  '23514',
  'A2 the status check refuses a state no handler knows');

-- Every state the flow actually uses is accepted.
insert into radar_drafts (source_url, thing_id, draft_text, status)
values ('https://www.reddit.com/r/sales/comments/aaa333/x/', 't3_aaa333', 'd', 'edited'),
       ('https://www.reddit.com/r/sales/comments/aaa444/x/', 't3_aaa444', 'd', 'skipped'),
       ('https://www.reddit.com/r/sales/comments/aaa555/x/', 't3_aaa555', 'd', 'failed');

select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts),
  4,
  'A3 pending, edited, skipped and failed are all accepted');

-- ------------------------------------------------------------
-- Section B — one posted comment per thread, ever
--
-- B1 and B2 are the double-tap race: the second tap must be refused by the
-- database, not merely by the worker's own look-before-you-leap check.
-- B3 is the other half — the index is PARTIAL, so a thread that was drafted
-- for and skipped can still be drafted for again.
-- ------------------------------------------------------------
insert into radar_drafts (source_url, thing_id, draft_text, status, permalink, posted_at)
values ('https://www.reddit.com/r/sales/comments/bbb111/x/', 't3_bbb111', 'the reply',
        'posted', 'https://www.reddit.com/r/sales/comments/bbb111/x/c1/', now());

select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts where status = 'posted'),
  1,
  'B1 the first post lands');

select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text, status, posted_at)
     values (''https://www.reddit.com/r/sales/comments/bbb111/x/'', ''t3_bbb111'', ''again'',
             ''posted'', now())',
  '23505',
  'B2 a second posted row for the same thread is refused');

insert into radar_drafts (source_url, thing_id, draft_text, status)
values ('https://www.reddit.com/r/sales/comments/bbb222/x/', 't3_bbb222', 'd1', 'skipped'),
       ('https://www.reddit.com/r/sales/comments/bbb222/x/', 't3_bbb222', 'd2', 'skipped'),
       ('https://www.reddit.com/r/sales/comments/bbb222/x/', 't3_bbb222', 'd3', 'pending');

select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts where thing_id = 't3_bbb222'),
  3,
  'B3 the index is partial: unposted drafts for one thread are not limited');

-- ------------------------------------------------------------
-- Section C — deny all
--
-- RLS on with no policies, plus the revoke. A customer role sees nothing and
-- writes nothing; the service role, which is what the monitor worker holds,
-- reads and writes freely.
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (select relrowsecurity from pg_class where relname = 'radar_drafts'),
  true,
  'C1 row level security is enabled');

select pg_temp.expect_eq(
  (select count(*)::int from pg_policies where tablename = 'radar_drafts'),
  0,
  'C2 there are no policies, so RLS denies every customer role');

set local role anon;
select pg_temp.expect_error(
  'select count(*) from radar_drafts', '42501',
  'C3 anon cannot read the drafts');
reset role;

set local role authenticated;
select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text)
     values (''https://www.reddit.com/r/x/comments/ccc111/x/'', ''t3_ccc111'', ''mine now'')',
  '42501',
  'C4 a signed-in customer cannot write a draft');
reset role;

set local role service_role;
select pg_temp.expect_eq(
  (select count(*)::int > 0 from radar_drafts),
  true,
  'C5 the service role, which is what the worker runs as, can read them');
reset role;

rollback;
