-- 045_connect_handles_test.sql
-- ------------------------------------------------------------
-- Verifies that a signed-in customer can create only a handle tied to their
-- own live API key, cannot read its plaintext key back, and that the service
-- exchange consumes a matching unexpired handle exactly once.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. Everything is inside a transaction
-- that rolls back at the end, but point psql at a throwaway database anyway.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (then migrations through 045)
--   psql -v ON_ERROR_STOP=1 -f schema/tests/045_connect_handles_test.sql
--
-- For a plain Postgres scratch database, create the Supabase roles and grants
-- described at the top of schema/tests/034_api_keys_test.sql first.
-- Output is one NOTICE per test. Any failure aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'connect-one@example.test'),
  (gen_random_uuid(), 'connect-two@example.test');

insert into t_ids
  select 'one', id from auth.users where email = 'connect-one@example.test'
  union all
  select 'two', id from auth.users where email = 'connect-two@example.test';

insert into api_keys (id, user_id, key_hash, key_prefix, label, scope)
select gen_random_uuid(), v, 'connect-hash-one', 'hr_live_aaaaaa', 'Claude connector, claude.ai', 'read_only'
from t_ids where k = 'one';
insert into t_ids
select 'key_one', id from api_keys where key_hash = 'connect-hash-one';

insert into api_keys (id, user_id, key_hash, key_prefix, label, scope)
select gen_random_uuid(), v, 'connect-hash-two', 'hr_live_bbbbbb', 'Claude connector, example.test', 'full'
from t_ids where k = 'two';
insert into t_ids
select 'key_two', id from api_keys where key_hash = 'connect-hash-two';

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

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';
do $$ begin perform set_config('request.jwt.claim.sub', (select v::text from t_ids where k = 'one'), true); end $$;

insert into connect_handles (tx, code_hash, user_id, api_key_id, api_key, scope, expires_at)
select repeat('a', 32), repeat('1', 64),
       (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_one'),
       'hr_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'shares:read', now() + interval '2 minutes';
do $$ begin raise notice 'PASS  A1 a customer can create a handle for their own live key'; end $$;

select pg_temp.expect_error(
  format(
    'insert into connect_handles (tx, code_hash, user_id, api_key_id, api_key, scope, expires_at) values (%L, %L, %L, %L, %L, %L, now() + interval ''2 minutes'')',
    repeat('b', 32), repeat('2', 64),
    (select v from t_ids where k = 'two'), (select v from t_ids where k = 'key_two'),
    'hr_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'shares:read shares:write'
  ),
  '42501',
  'A2 a customer cannot create a handle for another account');

select pg_temp.expect_error(
  'select api_key from connect_handles',
  '42501',
  'A3 a customer cannot read plaintext connector keys');

reset role;
select set_config('request.jwt.claim.sub', '', true);

insert into connect_handles (tx, code_hash, user_id, api_key_id, api_key, scope, expires_at)
select repeat('c', 32), repeat('3', 64),
       (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_one'),
       'hr_live_cccccccccccccccccccccccccccccccccccccccc', 'shares:read', now() - interval '1 second';

set local role service_role;

do $$
declare v_count int;
begin
  delete from connect_handles
   where tx = repeat('f', 32) and code_hash = repeat('1', 64) and expires_at > now();
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL B1: a different tx consumed a handle'; end if;
  raise notice 'PASS  B1 a handle cannot be consumed with a different tx';
end;
$$;

do $$
declare v_count int;
begin
  delete from connect_handles
   where tx = repeat('c', 32) and code_hash = repeat('3', 64) and expires_at > now();
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL B2: an expired handle was consumed'; end if;
  raise notice 'PASS  B2 an expired handle cannot be consumed';
end;
$$;

do $$
declare v_key text;
begin
  delete from connect_handles
   where tx = repeat('a', 32) and code_hash = repeat('1', 64) and expires_at > now()
   returning api_key into v_key;
  if v_key is distinct from 'hr_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' then
    raise exception 'FAIL B3: the matching live handle was not returned';
  end if;
  raise notice 'PASS  B3 a matching live handle is deleted and returned atomically';
end;
$$;

do $$
declare v_count int;
begin
  delete from connect_handles
   where tx = repeat('a', 32) and code_hash = repeat('1', 64) and expires_at > now();
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL B4: a consumed handle worked twice'; end if;
  raise notice 'PASS  B4 a consumed handle cannot be replayed';
end;
$$;

do $$
declare v_count int;
begin
  perform public.purge_connect_handles();
  select count(*) into v_count from connect_handles where tx = repeat('c', 32);
  if v_count <> 0 then raise exception 'FAIL C1: purge_connect_handles() left an expired row behind'; end if;
  raise notice 'PASS  C1 purge_connect_handles() removes an expired row';
end;
$$;

reset role;
rollback;
