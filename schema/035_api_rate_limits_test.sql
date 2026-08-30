-- 035_api_rate_limits_test.sql
-- ------------------------------------------------------------
-- Tests for 035_api_rate_limits.sql. Four things are worth testing here:
--
--   1. rate_limit_retry_after counts, refuses past the maximum, and returns a
--      wait a client can act on. A limiter that miscounts is worse than none,
--      because it is believed.
--   2. check_rate_limit still behaves exactly as it did before 035 rewrote it
--      on top of the new function. The anon-facing RPCs in 002 depend on it,
--      and none of them were touched.
--   3. Neither function is reachable by a customer-facing role, and the
--      twenty-keys-a-day cap fires on the table rather than only in the
--      settings page — a check in the application is a check anyone can walk
--      around, because the api_keys insert policy (034) lets a signed-in
--      session write key rows straight through PostgREST.
--   4. The key cap serialises per account, so concurrent inserts cannot each
--      read a count below the cap and all commit above it. Section E explains
--      why a one-session psql script can only check the guard is there.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It writes rate_limits, auth.users,
-- profiles and api_keys rows. Everything sits inside one transaction that
-- ROLLBACKs at the end, so nothing is left behind — but a rollback does not
-- undo a mistake made against production, so point psql at a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then 002, 003, 008,
--                                                     027, 033, 034, 035)
--   psql -v ON_ERROR_STOP=1 -f schema/035_api_rate_limits_test.sql
--
-- A throwaway Postgres in Docker is the scratch database this was written
-- against, exactly as 034's test file documents:
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   psql -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto'
--   …then the role setup 034's header lists, then the schema files, then this.
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Helpers (same shape as 033's and 034's)
-- ------------------------------------------------------------
create or replace function pg_temp.expect_error(sql text, expected text, label text)
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = expected then
      raise notice 'PASS  % (% as expected)', label, expected;
      return;
    end if;
    raise exception 'FAIL  %: expected SQLSTATE %, got % (%)', label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %: expected SQLSTATE %, but the statement SUCCEEDED', label, expected;
end;
$$;

create or replace function pg_temp.expect_ok(sql text, label text)
returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'PASS  %', label;
end;
$$;

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
-- Section A — counting and refusing
-- ------------------------------------------------------------
-- Three allowed, then refused. The key is unique to this run so a leftover
-- row from a previous test cannot decide the answer.
select pg_temp.expect_eq(
  rate_limit_retry_after('test:a:count', 3600, 3), 0,
  'A1 first call inside the limit returns 0');
select pg_temp.expect_eq(
  rate_limit_retry_after('test:a:count', 3600, 3), 0,
  'A2 second call inside the limit returns 0');
select pg_temp.expect_eq(
  rate_limit_retry_after('test:a:count', 3600, 3), 0,
  'A3 the last allowed call returns 0');

-- Over the limit. The wait must be a usable number: positive, and no longer
-- than the window it is waiting out.
do $$
declare v_wait int;
begin
  v_wait := rate_limit_retry_after('test:a:count', 3600, 3);
  if v_wait <= 0 or v_wait > 3600 then
    raise exception 'FAIL  A4: expected a wait in 1..3600, got %', v_wait;
  end if;
  raise notice 'PASS  A4 the call past the limit returns a wait of % seconds', v_wait;
end;
$$;

-- A refused call still counts. Ignoring the 429 must not be a way through.
do $$
declare v_count int;
begin
  select rate_limits.count into v_count from rate_limits where key = 'test:a:count';
  -- Four calls were made above: three allowed, one refused.
  if v_count <> 4 then
    raise exception 'FAIL  A5: expected 4 counted calls, got %', v_count;
  end if;
  raise notice 'PASS  A5 refused calls are counted too';
end;
$$;

-- A different key is a different budget.
select pg_temp.expect_eq(
  rate_limit_retry_after('test:a:other', 3600, 3), 0,
  'A6 one caller''s exhausted budget is not another''s');

-- A window that has already passed starts the count again. Backdating the row
-- is how "an hour later" is expressed without waiting an hour.
update rate_limits set window_at = now() - interval '2 hours' where key = 'test:a:count';
select pg_temp.expect_eq(
  rate_limit_retry_after('test:a:count', 3600, 3), 0,
  'A7 a new window starts the count over');

-- A one-second window is the shortest honest wait: never 0, or the client
-- retries immediately and the limit means nothing.
do $$
declare v_wait int;
begin
  perform rate_limit_retry_after('test:a:tiny', 1, 1);
  v_wait := rate_limit_retry_after('test:a:tiny', 1, 1);
  if v_wait < 1 then
    raise exception 'FAIL  A8: expected at least 1 second, got %', v_wait;
  end if;
  raise notice 'PASS  A8 the wait is never zero seconds';
end;
$$;

-- ------------------------------------------------------------
-- Section B — check_rate_limit is unchanged on the outside
--
-- 002's RPCs call this and were not touched by 035, so its contract has to
-- survive the rewrite: true while inside the limit, false past it.
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  check_rate_limit('test:b:legacy', 3600, 2), true,
  'B1 check_rate_limit still allows the first call');
select pg_temp.expect_eq(
  check_rate_limit('test:b:legacy', 3600, 2), true,
  'B2 check_rate_limit still allows the last one inside the limit');
select pg_temp.expect_eq(
  check_rate_limit('test:b:legacy', 3600, 2), false,
  'B3 check_rate_limit still refuses past the limit');

-- Both functions share one counter, so they cannot disagree about a caller.
select pg_temp.expect_eq(
  rate_limit_retry_after('test:b:legacy', 3600, 2) > 0, true,
  'B4 both functions read the same counter');

-- ------------------------------------------------------------
-- Section C — the grants
--
-- The whole security argument for a SECURITY DEFINER counter is who may call
-- it. A customer-reachable role that could call it could pick any key and
-- exhaust anyone's budget, or hold the row lock on a hot key.
-- ------------------------------------------------------------
set local role authenticated;
select pg_temp.expect_error(
  'select rate_limit_retry_after(''test:c'', 60, 1)',
  '42501',
  'C1 authenticated cannot call rate_limit_retry_after');
select pg_temp.expect_error(
  'select check_rate_limit(''test:c'', 60, 1)',
  '42501',
  'C2 authenticated cannot call check_rate_limit');
reset role;

set local role anon;
select pg_temp.expect_error(
  'select rate_limit_retry_after(''test:c'', 60, 1)',
  '42501',
  'C3 anon cannot call rate_limit_retry_after');
reset role;

set local role service_role;
select pg_temp.expect_eq(
  rate_limit_retry_after('test:c:service', 3600, 1), 0,
  'C4 the service role, which is what the API runs as, can call it');
reset role;

-- ------------------------------------------------------------
-- Section D — twenty new API keys per account per day
--
-- Counted on creations rather than survivors: the ten-live-keys cap (034) is
-- cleared instantly by revoking, so a script can create-and-revoke forever,
-- and every one of those rows was a working credential while it lived.
-- ------------------------------------------------------------
insert into auth.users (id, email) values
  (gen_random_uuid(), 'rate-keys-a@example.test'),
  (gen_random_uuid(), 'rate-keys-b@example.test'),
  (gen_random_uuid(), 'rate-keys-c@example.test');

create temporary table t_ids (k text primary key, v uuid);
insert into t_ids
  select 'a', id from auth.users where email = 'rate-keys-a@example.test'
  union all
  select 'b', id from auth.users where email = 'rate-keys-b@example.test'
  union all
  select 'c', id from auth.users where email = 'rate-keys-c@example.test';

create or replace function pg_temp.uid(k text) returns uuid language sql stable as $$
  select v from t_ids where t_ids.k = $1;
$$;

-- Twenty created today. Every one is revoked on the way in, so the ten-live
-- cap never fires and the only limit left standing is the daily one.
do $$
declare i int;
begin
  for i in 1..20 loop
    insert into api_keys (user_id, key_hash, key_prefix, label, revoked_at)
    values (pg_temp.uid('a'), 'a-hash-' || i, 'hr_live_cccccc', 'key ' || i, now());
  end loop;
  raise notice 'PASS  D1 twenty keys in a day are allowed';
end;
$$;

select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''a-hash-21'', ''hr_live_cccccc'', ''twenty-first'')',
    pg_temp.uid('a')
  ),
  'P0038',
  'D2 the twenty-first key in a day is refused');

-- The window rolls: it is twenty a day, not twenty ever. created_at is
-- immutable (034), so "two days ago" is written at insert rather than
-- backdated afterwards.
do $$
declare i int;
begin
  for i in 1..20 loop
    insert into api_keys (user_id, key_hash, key_prefix, label, created_at, revoked_at)
    values (pg_temp.uid('b'), 'b-hash-' || i, 'hr_live_cccccc', 'key ' || i,
            now() - interval '2 days', now());
  end loop;
end;
$$;
select pg_temp.expect_ok(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label, revoked_at) values (%L, ''b-hash-21'', ''hr_live_cccccc'', ''next day'', now())',
    pg_temp.uid('b')
  ),
  'D3 yesterday''s keys do not count against today');

-- One account's day never counts against another's.
select pg_temp.expect_ok(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label, revoked_at) values (%L, ''c-hash-1'', ''hr_live_cccccc'', ''unaffected'', now())',
    pg_temp.uid('c')
  ),
  'D4 a capped account does not cap anybody else');

-- The ten-live cap from 034 still fires, and fires first: ten live keys is
-- well inside the daily twenty.
do $$
declare i int;
begin
  for i in 2..11 loop
    insert into api_keys (user_id, key_hash, key_prefix, label)
    values (pg_temp.uid('c'), 'c-hash-' || i, 'hr_live_cccccc', 'live ' || i);
  end loop;
end;
$$;
select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''c-hash-12'', ''hr_live_cccccc'', ''eleventh live'')',
    pg_temp.uid('c')
  ),
  'P0038',
  'D5 the ten-live-keys cap from 034 still fires');

-- ------------------------------------------------------------
-- Section E — the caps hold under concurrency, and re-running is cheap
--
-- WHAT THIS SECTION CANNOT DO
--
-- The real test of the race is two sessions inserting at the same instant and
-- neither seeing the other's uncommitted row. A psql script is one session, so
-- it cannot stage that: everything above runs sequentially, where a count
-- taken before each insert is always right and the bug is invisible. Proving
-- the fix would need a second connection (two psql processes, or dblink, which
-- is not installed on a stock Postgres image), and a test that needs a harness
-- the repository does not have is a test nobody runs.
--
-- So this checks the mechanism instead of the outcome: the lock call is in the
-- function body, ahead of both counts. That is a weaker claim — it says the
-- guard is present, not that it works — but it is the claim this file can
-- make honestly, and it fails loudly if someone edits the lock back out.
--
-- The lock is per account (hashtext of the user id), transaction-scoped, and
-- taken before either count, so concurrent inserts for one account queue up
-- and each sees every earlier committed row.
-- ------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.api_keys_enforce_limit'::regproc);

  if position('pg_advisory_xact_lock' in v_def) = 0 then
    raise exception 'FAIL  E1: api_keys_enforce_limit takes no advisory lock, so two concurrent inserts can both pass the cap';
  end if;
  raise notice 'PASS  E1 the key cap serialises on a per-account advisory lock';

  -- Ahead of both counts, or it serialises nothing that matters.
  if position('pg_advisory_xact_lock' in v_def) > position('revoked_at is null' in v_def) then
    raise exception 'FAIL  E2: the lock is taken after the first count, which is the race it was meant to close';
  end if;
  raise notice 'PASS  E2 the lock is taken before the counts, not after';

  -- Keyed on the account. A global lock would serialise every account's key
  -- creation against every other's for no benefit.
  if position('new.user_id' in v_def) = 0 then
    raise exception 'FAIL  E3: the lock is not keyed on the account';
  end if;
  raise notice 'PASS  E3 the lock is per account rather than global';
end;
$$;

-- Re-running 035 must not drop and recreate the trigger: DROP TRIGGER takes an
-- ACCESS EXCLUSIVE lock on api_keys, which interrupts live key creation on a
-- retried deployment. The trigger is still attached exactly once.
do $$
declare v_count int;
begin
  select count(*) into v_count
  from pg_catalog.pg_trigger
  where tgname = 'trg_api_keys_enforce_limit'
    and tgrelid = 'public.api_keys'::regclass
    and not tgisinternal;

  if v_count <> 1 then
    raise exception 'FAIL  E4: expected exactly one trg_api_keys_enforce_limit, found %', v_count;
  end if;
  raise notice 'PASS  E4 the insert trigger is attached exactly once';
end;
$$;

do $$
begin
  raise notice '----------------------------------------';
  raise notice 'All 035 rate limit + key creation cap tests passed.';
  raise notice '----------------------------------------';
end;
$$;

rollback;
