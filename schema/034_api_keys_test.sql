-- 034_api_keys_test.sql
-- ------------------------------------------------------------
-- Tests for 034_api_keys.sql. Two things are worth testing here and nothing
-- else is:
--
--   1. api_keys RLS. A key is a bearer credential for someone's whole
--      account, so "can customer A read, write or revoke customer B's key
--      rows through PostgREST?" is the only question that matters about this
--      table. These tests therefore run as the `authenticated` role with a
--      jwt sub set, exactly as a request through PostgREST does — running
--      them as the superuser would bypass RLS and prove nothing.
--
--   2. create_share_as. It exists so an API request can create a link with no
--      Supabase session. The risk is that it becomes a second, weaker path
--      into document_shares. So: the free-tier cap must still fire through
--      it, the chosen-address rules must still apply through it, the share
--      must end up owned by p_user_id, and no customer-reachable role may
--      execute it.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users rows,
-- profiles, documents, shares and keys. Everything sits inside one
-- transaction that ROLLBACKs at the end, so nothing is left behind — but a
-- rollback does not undo a mistake made against production, so point psql at
-- a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then 002, 003, 008,
--                                                     027, 033, 034)
--   psql -v ON_ERROR_STOP=1 -f schema/034_api_keys_test.sql
--
-- A throwaway Postgres in Docker is the scratch database this was written
-- against, and is the easiest one to get:
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   psql -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto'
--   …then the role setup below, then the schema files, then this file.
--
-- On a scratch database that is not a real Supabase project, the roles and
-- table grants Supabase provides have to exist first, or the RLS tests below
-- have nothing to run as:
--
--   create role anon nologin;
--   create role authenticated nologin;
--   create role service_role nologin bypassrls;
--   grant usage on schema public to anon, authenticated, service_role;
--   grant all on all tables in schema public to anon, authenticated, service_role;
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);
-- The helpers below read this while acting as `authenticated`, which owns
-- nothing and inherits no grant on a temp table.
grant select on t_ids to public;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'api-free@example.test'),
  (gen_random_uuid(), 'api-pro@example.test');

insert into t_ids
  select 'free', id from auth.users where email = 'api-free@example.test'
  union all
  select 'pro',  id from auth.users where email = 'api-pro@example.test';

update profiles set tier = 'pro'  where id = (select v from t_ids where k = 'pro');
update profiles set tier = 'free' where id = (select v from t_ids where k = 'free');

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Free deck', 'url', 'https://example.test/free.html'
from t_ids where k = 'free';
insert into t_ids
  select 'doc_free', id from documents
  where title = 'Free deck' and owner_id = (select v from t_ids where k = 'free');

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Pro deck', 'url', 'https://example.test/pro.html'
from t_ids where k = 'pro';
insert into t_ids
  select 'doc_pro', id from documents
  where title = 'Pro deck' and owner_id = (select v from t_ids where k = 'pro');

-- Two keys, one per user. Inserted as the superuser so the RLS tests below
-- start from a known state they did not create themselves.
insert into api_keys (user_id, key_hash, key_prefix, label)
select v, 'hash-free', 'hr_live_aaaaaa', 'free key' from t_ids where k = 'free';
insert into api_keys (user_id, key_hash, key_prefix, label)
select v, 'hash-pro',  'hr_live_bbbbbb', 'pro key'  from t_ids where k = 'pro';

-- ------------------------------------------------------------
-- Helpers (same shape as 033's)
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

-- How many rows a statement touched. Used for RLS, where a policy that
-- excludes a row makes the statement a silent no-op rather than an error.
create or replace function pg_temp.expect_rows(sql text, expected int, label text)
returns void language plpgsql as $$
declare v_count int;
begin
  execute sql;
  get diagnostics v_count = row_count;
  if v_count <> expected then
    raise exception 'FAIL  %: expected % row(s), got %', label, expected, v_count;
  end if;
  raise notice 'PASS  % (% row(s))', label, expected;
end;
$$;

create or replace function pg_temp.uid(k text) returns uuid language sql stable as $$
  select v from t_ids where t_ids.k = uid.k;
$$;

create or replace function pg_temp.rpc_create_as(owner_k text, doc_k text, slug text)
returns text language sql as $$
  select format(
    'select create_share_as(%L, %L, %L, true, false, null, null, null, null, %s)',
    pg_temp.uid(owner_k),
    pg_temp.uid(doc_k),
    'api label',
    case when slug is null then 'null' else quote_literal(slug) end
  );
$$;

-- ============================================================
-- Section A — api_keys RLS isolation between two customers
--
-- Run as the `authenticated` role with a jwt sub, which is what PostgREST
-- gives a signed-in customer holding the public anon key.
-- ============================================================
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';

-- Re-point the claim at the free user for real. (set_config is used rather
-- than SET because the value has to come from a query.)
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('free')::text, true); end $$;

do $$
declare v_count int;
begin
  select count(*) into v_count from api_keys;
  if v_count <> 1 then
    raise exception 'FAIL A1: free user sees % key rows, expected only their own 1', v_count;
  end if;
  if not exists (select 1 from api_keys where key_hash = 'hash-free') then
    raise exception 'FAIL A1: free user cannot see their own key';
  end if;
  raise notice 'PASS  A1 a customer sees only their own keys';
end;
$$;

-- Somebody else's key is invisible, so an UPDATE aimed at it changes nothing.
-- This is the un-revoke attack: flip revoked_at back to null on a key that
-- was switched off, or revoke a competitor's key out from under them.
select pg_temp.expect_rows(
  'update api_keys set revoked_at = null where key_hash = ''hash-pro''',
  0,
  'A2 a customer cannot update another customer''s key');

select pg_temp.expect_rows(
  'update api_keys set revoked_at = now() where key_hash = ''hash-pro''',
  0,
  'A3 a customer cannot revoke another customer''s key');

-- Creating a key pointed at somebody else's account would be a complete
-- takeover: the API resolves a key to its user_id and does everything as that
-- user. The insert policy's WITH CHECK is what stops it.
select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''hash-stolen'', ''hr_live_cccccc'', ''stolen'')',
    pg_temp.uid('pro')
  ),
  '42501',
  'A4 a customer cannot create a key for another account');

-- Nor move one of their own keys onto another account after the fact. Two
-- separate things refuse this: the UPDATE policy's WITH CHECK (RLS scopes
-- rows, not columns — 032) and the immutability trigger. The trigger is a
-- BEFORE trigger, so it is the one that answers first; P0039 rather than
-- 42501 is that ordering showing through, not a weaker refusal.
select pg_temp.expect_error(
  format(
    'update api_keys set user_id = %L where key_hash = ''hash-free''',
    pg_temp.uid('pro')
  ),
  'P0039',
  'A5 a customer cannot reassign their own key to another account');

-- Their own key they may create and revoke.
select pg_temp.expect_ok(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''hash-free-2'', ''hr_live_dddddd'', ''second key'')',
    pg_temp.uid('free')
  ),
  'A6 a customer can create a key for their own account');
select pg_temp.expect_rows(
  'update api_keys set revoked_at = now() where key_hash = ''hash-free-2''',
  1,
  'A7 a customer can revoke their own key');

-- Delete is refused outright rather than silently doing nothing, so the
-- last_used_at trail behind a leaked key cannot be erased.
select pg_temp.expect_error(
  'delete from api_keys where key_hash = ''hash-free''',
  '42501',
  'A8 deleting a key is refused — revoke is the only way to switch one off');

-- Revocation is a one-way door. Without this, "I revoked the leaked key" is a
-- claim the owner's own browser session can quietly undo through PostgREST,
-- and the API would start honouring the leaked key again.
select pg_temp.expect_error(
  'update api_keys set revoked_at = null where key_hash = ''hash-free-2''',
  'P0039',
  'A9 a revoked key cannot be brought back');

-- clock_timestamp(), not now(): now() is fixed for the whole transaction, so
-- inside this test file it would write back the very value already stored and
-- the trigger would rightly see no change at all.
select pg_temp.expect_error(
  'update api_keys set revoked_at = clock_timestamp() where key_hash = ''hash-free-2''',
  'P0039',
  'A10 the revocation timestamp cannot be moved either');

-- Revoking is the ONLY update a signed-in session may make. A rename that
-- left the key live would otherwise be an update the policy has to reason
-- about; refusing everything but revocation leaves nothing to reason about.
select pg_temp.expect_error(
  'update api_keys set label = ''renamed'' where key_hash = ''hash-free''',
  '42501',
  'A11 an update that does not revoke is refused');

-- The credential itself is fixed at creation. Writing another key's hash into
-- a row you own would authenticate you as its owner.
select pg_temp.expect_error(
  'update api_keys set key_hash = ''hash-rewritten'', revoked_at = now() where key_hash = ''hash-free''',
  'P0039',
  'A12 key_hash cannot be rewritten');

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ============================================================
-- Section B — a revoked key stops authenticating
--
-- This is the statement lib/api-auth.ts runs on every request: it looks the
-- hash up, refuses revoked rows, and stamps last_used_at in the same round
-- trip. If the revoked_at predicate ever fell out of it, a revoked key would
-- keep working — so the test is the statement itself, not a paraphrase.
-- ============================================================
do $$
declare v_user uuid;
begin
  update api_keys set last_used_at = now()
   where key_hash = 'hash-free' and revoked_at is null
   returning user_id into v_user;
  if v_user is distinct from pg_temp.uid('free') then
    raise exception 'FAIL B1: a live key did not resolve to its owner';
  end if;
  raise notice 'PASS  B1 a live key resolves to its owner and stamps last_used_at';
end;
$$;

update api_keys set revoked_at = now() where key_hash = 'hash-free';

do $$
declare v_user uuid;
begin
  update api_keys set last_used_at = now()
   where key_hash = 'hash-free' and revoked_at is null
   returning user_id into v_user;
  if v_user is not null then
    raise exception 'FAIL B2: a revoked key still resolved to a user';
  end if;
  raise notice 'PASS  B2 a revoked key resolves to nobody';
end;
$$;

-- The row is still there with its history — that is the point of revoking
-- rather than deleting.
do $$
begin
  if not exists (select 1 from api_keys where key_hash = 'hash-free' and last_used_at is not null) then
    raise exception 'FAIL B3: the revoked key lost its row or its last_used_at';
  end if;
  raise notice 'PASS  B3 the revoked key keeps its row and its last-used trail';
end;
$$;

-- Two accounts cannot end up sharing a hash (a duplicate would make one key
-- resolve to two users, and .maybeSingle() would start failing).
select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''hash-pro'', ''hr_live_eeeeee'', ''collision'')',
    pg_temp.uid('free')
  ),
  '23505',
  'B4 the same key hash cannot exist twice');

-- The RLS policy in Section A binds `authenticated` only, and the service
-- role bypasses RLS entirely — it is the role the API itself runs as. So the
-- permanence of a revocation cannot live in a policy; these prove it lives in
-- a trigger that no role gets to skip.
set local role service_role;

select pg_temp.expect_error(
  'update api_keys set revoked_at = null where key_hash = ''hash-free''',
  'P0039',
  'B5 not even the service role can bring a revoked key back');

select pg_temp.expect_error(
  format('update api_keys set user_id = %L where key_hash = ''hash-pro''', pg_temp.uid('free')),
  'P0039',
  'B6 a key cannot be moved onto another account');

-- …while the one write the API actually makes on every request still works.
select pg_temp.expect_rows(
  'update api_keys set last_used_at = now() where key_hash = ''hash-pro'' and revoked_at is null',
  1,
  'B7 the service role can still stamp last_used_at');

reset role;

-- ============================================================
-- Section C — create_share_as creates for p_user_id, and the cap still fires
-- ============================================================
select pg_temp.expect_ok(
  pg_temp.rpc_create_as('pro', 'doc_pro', null),
  'C1 create_share_as creates a link with no session');

do $$
declare v_row document_shares%rowtype;
begin
  select * into v_row from document_shares
   where document_id = pg_temp.uid('doc_pro') order by created_at desc limit 1;
  if v_row.owner_id is distinct from pg_temp.uid('pro') then
    raise exception 'FAIL C2: the share was owned by % rather than p_user_id', v_row.owner_id;
  end if;
  if v_row.slug !~ '^[a-z]+-[a-z]+-[0-9a-f]{6}$' then
    raise exception 'FAIL C2: generated slug % is not the expected shape', v_row.slug;
  end if;
  if v_row.slug_is_custom then
    raise exception 'FAIL C2: a generated slug came back marked custom';
  end if;
  raise notice 'PASS  C2 the share is owned by p_user_id and its address was generated';
end;
$$;

-- p_user_id is the identity, not the connection's. Nothing about the caller
-- leaks into the row.
select pg_temp.expect_error(
  'select create_share_as(null, null, null, true, false, null, null, null, null, null)',
  'P0020',
  'C3 create_share_as with no user is refused');

-- A document that belongs to somebody else cannot be shared into an account
-- that does not own it — create_share''s own ownership check, still doing its
-- job through the wrapper.
select pg_temp.expect_error(
  pg_temp.rpc_create_as('pro', 'doc_free', null),
  'P0021',
  'C4 create_share_as cannot share a document the user does not own');

-- The free-tier cap (027). Two links, lifetime, then it fires.
select pg_temp.expect_ok(pg_temp.rpc_create_as('free', 'doc_free', null), 'C5 free tier link 1 of 2');
select pg_temp.expect_ok(pg_temp.rpc_create_as('free', 'doc_free', null), 'C6 free tier link 2 of 2');
select pg_temp.expect_error(
  pg_temp.rpc_create_as('free', 'doc_free', null),
  'P0031',
  'C7 the free-tier cap still fires through create_share_as');

-- Pro is still exempt.
select pg_temp.expect_ok(pg_temp.rpc_create_as('pro', 'doc_pro', null), 'C8 pro is not capped');

-- ============================================================
-- Section D — the chosen-address rules still apply through create_share_as
-- ============================================================
select pg_temp.expect_ok(
  pg_temp.rpc_create_as('pro', 'doc_pro', 'acme-api-deck'),
  'D1 pro tier, a chosen address through the API path');

do $$
begin
  if not exists (select 1 from document_shares where slug = 'acme-api-deck' and slug_is_custom) then
    raise exception 'FAIL D2: the chosen address was not stored and marked custom';
  end if;
  raise notice 'PASS  D2 the chosen address is stored and marked custom';
end;
$$;

select pg_temp.expect_ok(
  pg_temp.rpc_create_as('pro', 'doc_pro', '  Series-C-Deck  '),
  'D3 case and whitespace are normalised, not rejected');
do $$
begin
  if not exists (select 1 from document_shares where slug = 'series-c-deck') then
    raise exception 'FAIL D4: expected the normalised address series-c-deck';
  end if;
  raise notice 'PASS  D4 normalised to series-c-deck';
end;
$$;

select pg_temp.expect_error(
  pg_temp.rpc_create_as('pro', 'doc_pro', 'Acme_Bad Slug'),
  'P0032',
  'D5 an invalid address is still rejected');
select pg_temp.expect_error(
  pg_temp.rpc_create_as('pro', 'doc_pro', 'billing'),
  'P0033',
  'D6 a reserved address is still rejected');
select pg_temp.expect_error(
  pg_temp.rpc_create_as('pro', 'doc_pro', 'acme-api-deck'),
  'P0034',
  'D7 a taken address is still rejected');

-- A free-tier caller supplying an address is refused for being free, not for
-- anything about the address. Checked on a fresh free account, because the
-- one above is now at its cap and the cap trigger sorts first.
insert into auth.users (id, email) values (gen_random_uuid(), 'api-free2@example.test');
insert into t_ids select 'free2', id from auth.users where email = 'api-free2@example.test';
update profiles set tier = 'free' where id = pg_temp.uid('free2');
insert into documents (id, owner_id, title, source_type, source_url)
values (gen_random_uuid(), pg_temp.uid('free2'), 'Free2 deck', 'url', 'https://example.test/f2.html');
insert into t_ids select 'doc_free2', id from documents where title = 'Free2 deck';

select pg_temp.expect_error(
  pg_temp.rpc_create_as('free2', 'doc_free2', 'free-tier-vanity'),
  'P0036',
  'D8 a free-tier caller still cannot choose an address through the API');

-- ============================================================
-- Section E — only the service role may execute create_share_as
--
-- This grant is the entire reason p_user_id is safe to accept. If
-- `authenticated` could execute it, any signed-in customer could create links
-- in anybody's account through PostgREST.
-- ============================================================
do $$
declare
  v_sig text := 'create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text)';
  r record;
begin
  for r in select unnest(array['anon', 'authenticated', 'public']) as who loop
    if has_function_privilege(r.who, v_sig, 'execute') then
      raise exception 'FAIL E1: % can execute create_share_as', r.who;
    end if;
  end loop;
  raise notice 'PASS  E1 anon, authenticated and public cannot execute create_share_as';
end;
$$;

do $$
declare v_sig text := 'create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text)';
begin
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'FAIL E2: the service role cannot execute create_share_as';
  end if;
  raise notice 'PASS  E2 the service role can execute create_share_as';
end;
$$;

-- And it really runs when the service role calls it, rather than tripping on
-- a privilege it does not hold on the tables underneath.
set local role service_role;
select pg_temp.expect_ok(
  pg_temp.rpc_create_as('pro', 'doc_pro', null),
  'E3 the service role can actually create a link through it');
reset role;

-- ============================================================
-- Section F — ten live keys per account
--
-- The cap has to be a trigger rather than a check in the settings action,
-- because the insert policy lets a signed-in customer write key rows straight
-- through PostgREST. So it is tested the way it would be attacked: as
-- `authenticated`, inserting directly.
-- ============================================================
insert into auth.users (id, email) values (gen_random_uuid(), 'api-limit@example.test');
insert into t_ids select 'limit', id from auth.users where email = 'api-limit@example.test';

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('limit')::text, true); end $$;

do $$
declare i int;
begin
  for i in 1..10 loop
    insert into api_keys (user_id, key_hash, key_prefix, label)
    values (pg_temp.uid('limit'), 'limit-hash-' || i, 'hr_live_ffffff', 'key ' || i);
  end loop;
  raise notice 'PASS  F1 ten live keys are allowed';
end;
$$;

select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''limit-hash-11'', ''hr_live_ffffff'', ''eleventh'')',
    pg_temp.uid('limit')
  ),
  'P0038',
  'F2 the eleventh live key is refused');

-- Revoking is how you make room, which is also why the count is of live keys
-- rather than of rows: the revoked ones stay for their last_used_at trail.
select pg_temp.expect_rows(
  'update api_keys set revoked_at = now() where key_hash = ''limit-hash-1''',
  1,
  'F3 one of the ten is revoked');

select pg_temp.expect_ok(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''limit-hash-11'', ''hr_live_ffffff'', ''eleventh'')',
    pg_temp.uid('limit')
  ),
  'F4 revoking one makes room for another');

-- …and the account is back at its cap, so the next one is refused again.
select pg_temp.expect_error(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''limit-hash-12'', ''hr_live_ffffff'', ''twelfth'')',
    pg_temp.uid('limit')
  ),
  'P0038',
  'F5 back at the cap, the next one is refused again');

-- One account's keys never count against another's. (Both of the free user's
-- keys were revoked in Sections A and B, so this account is at zero live.)
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('free')::text, true); end $$;
select pg_temp.expect_ok(
  format(
    'insert into api_keys (user_id, key_hash, key_prefix, label) values (%L, ''hash-free-3'', ''hr_live_ffffff'', ''unaffected'')',
    pg_temp.uid('free')
  ),
  'F6 a capped account does not cap anybody else');

reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
begin
  raise notice '----------------------------------------';
  raise notice 'All 034 API key + create_share_as tests passed.';
  raise notice '----------------------------------------';
end;
$$;

rollback;
