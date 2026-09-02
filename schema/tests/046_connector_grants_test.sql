-- 046_connector_grants_test.sql
-- ------------------------------------------------------------
-- Verifies that a signed-in customer can record only their own connection,
-- cannot see or touch anybody else's, and that the reconciliation backlog
-- reports exactly the connections whose key is dead but whose OAuth grant was
-- never confirmed gone.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. Everything is inside a transaction
-- that rolls back at the end, but point psql at a throwaway database anyway.
--
-- The cheapest route is a local Postgres 16 cluster with the Supabase roles
-- created by hand, then three files — no other migration is needed:
--
--   psql -v ON_ERROR_STOP=1 -f <lines 60-176 of schema/034_api_keys.sql>
--   psql -v ON_ERROR_STOP=1 -f schema/040_api_key_scope.sql
--   psql -v ON_ERROR_STOP=1 -f schema/046_connector_grants.sql
--   psql -v ON_ERROR_STOP=1 -f schema/tests/046_connector_grants_test.sql
--
-- The roles and the minimal auth.users stub are described at the top of
-- schema/tests/034_api_keys_test.sql.
-- Output is one NOTICE per test. Any failure aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'grant-one@example.test'),
  (gen_random_uuid(), 'grant-two@example.test');

insert into t_ids
  select 'one', id from auth.users where email = 'grant-one@example.test'
  union all
  select 'two', id from auth.users where email = 'grant-two@example.test';

insert into api_keys (id, user_id, key_hash, key_prefix, label, scope)
select gen_random_uuid(), v, 'grants-hash-one', 'hr_live_aaaaaa', 'Claude connector, claude.ai', 'read_only'
from t_ids where k = 'one';
insert into t_ids select 'key_one', id from api_keys where key_hash = 'grants-hash-one';

insert into api_keys (id, user_id, key_hash, key_prefix, label, scope)
select gen_random_uuid(), v, 'grants-hash-two', 'hr_live_bbbbbb', 'Claude connector, example.test', 'full'
from t_ids where k = 'two';
insert into t_ids select 'key_two', id from api_keys where key_hash = 'grants-hash-two';

-- A second live key for account one, so the "revoked but unreconciled" case
-- can exist alongside a healthy one.
insert into api_keys (id, user_id, key_hash, key_prefix, label, scope)
select gen_random_uuid(), v, 'grants-hash-three', 'hr_live_cccccc', 'Claude connector, claude.ai', 'full'
from t_ids where k = 'one';
insert into t_ids select 'key_three', id from api_keys where key_hash = 'grants-hash-three';

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
do $$ begin perform set_config('request.jwt.claim.sub', (select v::text from t_ids where k = 'one'), true); end $$;

insert into connector_grants (user_id, api_key_id, client_id, client_host, scope)
select (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_one'),
       'https://claude.ai/api/mcp/client-metadata.json', 'claude.ai', 'shares:read';
do $$ begin raise notice 'PASS  A1 a customer can record a connection for their own live key'; end $$;

insert into connector_events (user_id, api_key_id, kind, detail)
select (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_one'),
       'grant_created', jsonb_build_object('client_host', 'claude.ai');
do $$ begin raise notice 'PASS  A2 a customer can record their own connector event'; end $$;

select pg_temp.expect_error(
  format(
    'insert into connector_grants (user_id, api_key_id, client_id, client_host, scope) values (%L, %L, %L, %L, %L)',
    (select v from t_ids where k = 'two'), (select v from t_ids where k = 'key_two'),
    'https://example.test/cimd.json', 'example.test', 'shares:read'
  ),
  '42501',
  'A3 a customer cannot record a connection for another account');

select pg_temp.expect_error(
  format(
    'insert into connector_events (user_id, kind) values (%L, %L)',
    (select v from t_ids where k = 'two'), 'grant_created'
  ),
  '42501',
  'A4 a customer cannot write an event onto another account');

do $$
declare v_count int;
begin
  -- Account two's row does not exist, so this proves only that the select
  -- policy is scoped: account one sees exactly its own one row.
  select count(*) into v_count from connector_grants;
  if v_count <> 1 then raise exception 'FAIL A5: expected 1 visible connection, saw %', v_count; end if;
  raise notice 'PASS  A5 a customer sees only their own connections';
end;
$$;

select pg_temp.expect_error(
  'insert into connector_events (user_id, kind) values (' ||
    quote_literal((select v from t_ids where k = 'one')) || ', ''nonsense'')',
  '23514',
  'A6 an unknown event kind is refused');

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- A second connection for account one, whose key is then revoked without the
-- OAuth grant ever being confirmed gone. This is the backlog case.
insert into connector_grants (user_id, api_key_id, client_id, client_host, scope)
select (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_three'),
       'https://claude.ai/api/mcp/client-metadata.json', 'claude.ai', 'shares:read shares:write';
update api_keys set revoked_at = now() - interval '1 hour'
 where id = (select v from t_ids where k = 'key_three');

select pg_temp.expect_error(
  format(
    'insert into connector_grants (user_id, api_key_id, client_id, client_host, scope) values (%L, %L, %L, %L, %L)',
    (select v from t_ids where k = 'one'), (select v from t_ids where k = 'key_one'),
    'https://claude.ai/api/mcp/client-metadata.json', 'claude.ai', 'shares:read'
  ),
  '23505',
  'B1 one key can only ever have one connection row');

set local role service_role;

do $$
declare v_count int; v_key uuid;
begin
  select count(*) into v_count from public.connector_reconcile_backlog(60);
  if v_count <> 1 then raise exception 'FAIL B2: expected 1 unreconciled connection, saw %', v_count; end if;
  select api_key_id into v_key from public.connector_reconcile_backlog(60);
  if v_key <> (select v from t_ids where k = 'key_three') then
    raise exception 'FAIL B2: the backlog named the wrong key';
  end if;
  raise notice 'PASS  B2 the backlog reports a revoked key whose grant was never tidied';
end;
$$;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.connector_reconcile_backlog(7200);
  if v_count <> 0 then raise exception 'FAIL B3: a revocation younger than the age floor was reported'; end if;
  raise notice 'PASS  B3 a revocation younger than the age floor is not yet a backlog';
end;
$$;

do $$
declare v_count int;
begin
  update connector_grants set oauth_revoked_at = now()
   where api_key_id = (select v from t_ids where k = 'key_three');
  select count(*) into v_count from public.connector_reconcile_backlog(60);
  if v_count <> 0 then raise exception 'FAIL B4: a reconciled connection is still in the backlog'; end if;
  raise notice 'PASS  B4 recording the OAuth clean-up empties the backlog';
end;
$$;

reset role;

set local role anon;
select pg_temp.expect_error(
  'select count(*) from connector_grants',
  '42501',
  'C1 an anonymous caller cannot read connections at all');
select pg_temp.expect_error(
  'select * from public.connector_reconcile_backlog(60)',
  '42501',
  'C2 an anonymous caller cannot run the backlog query');

reset role;
rollback;
