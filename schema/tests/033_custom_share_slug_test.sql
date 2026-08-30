-- 033_custom_share_slug_test.sql
-- ------------------------------------------------------------
-- Tests for 033_custom_share_slug.sql. These are the tests that matter: the
-- triggers are the only control a customer cannot walk around, because RLS on
-- document_shares lets any signed-in user INSERT, UPDATE and DELETE their own
-- rows through PostgREST without touching application code.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users rows,
-- profiles, documents and shares. Everything sits inside one transaction that
-- ROLLBACKs at the end, so nothing is left behind — but a rollback does not
-- undo a mistake made against production, so point psql at a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then 008, 027, 033)
--   psql -v ON_ERROR_STOP=1 -f schema/tests/033_custom_share_slug_test.sql
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);

insert into auth.users (id, email) values
  (gen_random_uuid(), 'free-tester@example.test'),
  (gen_random_uuid(), 'pro-tester@example.test');

insert into t_ids
  select 'free', id from auth.users where email = 'free-tester@example.test'
  union all
  select 'pro',  id from auth.users where email = 'pro-tester@example.test';

-- 001's on_auth_user_created trigger creates the profiles; make one Pro.
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

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

-- Run `sql` and require it to fail with `expected` SQLSTATE.
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

-- Act as a given user, the way PostgREST does.
create or replace function pg_temp.act_as(k text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',
                     (select v from t_ids where t_ids.k = act_as.k)::text, true);
end;
$$;

-- A raw INSERT: exactly what a signed-in customer can send to
-- /rest/v1/document_shares with the public anon key.
create or replace function pg_temp.raw_insert(owner_k text, doc_k text, slug text)
returns text language sql as $$
  select format(
    'insert into document_shares (document_id, owner_id, slug) values (%L, %L, %L)',
    (select v from t_ids where k = doc_k),
    (select v from t_ids where k = owner_k),
    slug
  );
$$;

create or replace function pg_temp.rpc_create(doc_k text, slug text)
returns text language sql as $$
  select format(
    'select create_share(%L, %L, true, false, null, null, null, null, %s)',
    (select v from t_ids where k = doc_k),
    'label',
    case when slug is null then 'null' else quote_literal(slug) end
  );
$$;

-- ------------------------------------------------------------
-- Test 1 — a free-tier owner supplying an address is rejected
-- ------------------------------------------------------------
select pg_temp.act_as('free');
select pg_temp.expect_error(
  pg_temp.raw_insert('free', 'doc_free', 'acme-proposal'),
  'P0036',
  '1a free tier, direct PostgREST-shaped INSERT with a chosen address');
select pg_temp.expect_error(
  pg_temp.rpc_create('doc_free', 'acme-proposal'),
  'P0036',
  '1b free tier, create_share with p_slug');

-- …and the free tier still gets a generated address, unchanged.
select pg_temp.expect_ok(
  pg_temp.rpc_create('doc_free', null),
  '1c free tier, create_share with no address still generates one');

do $$
declare v_row document_shares%rowtype;
begin
  select * into v_row from document_shares
   where owner_id = (select v from t_ids where k = 'free')
   order by created_at desc limit 1;
  if v_row.slug !~ '^[a-z]+-[a-z]+-[0-9a-f]{6}$' then
    raise exception 'FAIL 1d: generated slug % is not the expected shape', v_row.slug;
  end if;
  if v_row.slug_is_custom then
    raise exception 'FAIL 1d: a generated slug was marked custom';
  end if;
  raise notice 'PASS  1d generated slug % is the right shape and is not marked custom', v_row.slug;
end;
$$;

-- ------------------------------------------------------------
-- Test 2 — a Pro owner supplying a valid address succeeds
-- ------------------------------------------------------------
select pg_temp.act_as('pro');
select pg_temp.expect_ok(
  pg_temp.rpc_create('doc_pro', 'acme-proposal'),
  '2a pro tier, create_share with a chosen address');

do $$
declare v_row document_shares%rowtype;
begin
  select * into v_row from document_shares where slug = 'acme-proposal';
  if not found then
    raise exception 'FAIL 2b: the row was not written with the chosen address';
  end if;
  if not v_row.slug_is_custom then
    raise exception 'FAIL 2b: a chosen address was not marked custom';
  end if;
  raise notice 'PASS  2b the chosen address was stored verbatim and marked custom';
end;
$$;

-- Case and surrounding whitespace are normalised by create_share, not rejected.
select pg_temp.expect_ok(
  pg_temp.rpc_create('doc_pro', '  Series-B-Deck  '),
  '2c create_share lowercases and trims a chosen address');
do $$
begin
  if not exists (select 1 from document_shares where slug = 'series-b-deck') then
    raise exception 'FAIL 2d: expected the normalised address series-b-deck';
  end if;
  raise notice 'PASS  2d normalised to series-b-deck';
end;
$$;

-- ------------------------------------------------------------
-- Test 3 — invalid formats are rejected
-- A raw INSERT is used deliberately: create_share lowercases and trims, so
-- only the direct path can prove the trigger itself refuses these.
-- ------------------------------------------------------------
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'Acme-Proposal'), 'P0032', '3a uppercase');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'ab'),            'P0032', '3b too short (2 chars)');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', repeat('a', 61)), 'P0032', '3c too long (61 chars)');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', '-acme'),         'P0032', '3d leading hyphen');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme-'),         'P0032', '3e trailing hyphen');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme_proposal'), 'P0032', '3f underscore');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme proposal'), 'P0032', '3g space');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme.proposal'), 'P0032', '3h dot');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme/proposal'), 'P0032', '3i slash');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', ''),              'P0032', '3j empty string');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', '_doc'),          'P0032', '3k leading underscore (the _doc preview route)');
-- The boundary cases that must be ACCEPTED, or the regex is wrong the other way.
select pg_temp.expect_ok(pg_temp.raw_insert('pro', 'doc_pro', 'abc'),           '3l exactly 3 chars is accepted');
select pg_temp.expect_ok(pg_temp.raw_insert('pro', 'doc_pro', repeat('a', 60)), '3m exactly 60 chars is accepted');

-- ------------------------------------------------------------
-- Test 4 — reserved words are rejected
-- ------------------------------------------------------------
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'login'),     'P0033', '4a login');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'billing'),   'P0033', '4b billing');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'htmlradar'), 'P0033', '4c htmlradar');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'sign-in'),   'P0033', '4d sign-in');
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'auth'),      'P0033', '4e auth');
select pg_temp.expect_error(pg_temp.rpc_create('doc_pro', 'SUPPORT'),          'P0033', '4f a reserved word survives normalisation');

-- ------------------------------------------------------------
-- Test 5 — an address already in document_shares is rejected
-- 'acme-proposal' was created by test 2.
-- ------------------------------------------------------------
select pg_temp.expect_error(pg_temp.raw_insert('pro', 'doc_pro', 'acme-proposal'), 'P0034', '5a duplicate of a live address');
select pg_temp.expect_error(pg_temp.rpc_create('doc_pro', 'acme-proposal'),        'P0034', '5b duplicate via create_share');
-- A different owner must not be able to take it either.
select pg_temp.act_as('free');
select pg_temp.expect_error(pg_temp.raw_insert('free', 'doc_free', 'acme-proposal'), 'P0034', '5c a different owner cannot take a live address');
select pg_temp.act_as('pro');

-- ------------------------------------------------------------
-- Test 6 — a chosen address cannot be hard-deleted
-- Revoking keeps the row, and the unique index on slug is what stops the
-- address ever reaching a second customer. This is the only escape hatch.
-- ------------------------------------------------------------
select pg_temp.expect_error(
  format('delete from document_shares where slug = %L', 'acme-proposal'),
  'P0037',
  '6a hard-deleting a chosen address is refused');

do $$
begin
  if not exists (select 1 from document_shares where slug = 'acme-proposal') then
    raise exception 'FAIL 6b: the row disappeared despite the delete being refused';
  end if;
  raise notice 'PASS  6b the row survived the refused delete';
end;
$$;

-- Revoke is the supported way to switch it off, and it keeps the address held.
select pg_temp.expect_ok(
  format('update document_shares set revoked_at = now() where slug = %L', 'acme-proposal'),
  '6c revoking a chosen address is allowed');
select pg_temp.expect_error(
  pg_temp.raw_insert('pro', 'doc_pro', 'acme-proposal'),
  'P0034',
  '6d a revoked chosen address is still held against reuse');

-- The flag itself must not be editable, or the guard is one PATCH away from
-- being switched off. RLS scopes rows, not columns (see 032).
select pg_temp.expect_error(
  format('update document_shares set slug_is_custom = false where slug = %L', 'acme-proposal'),
  'P0035',
  '6e slug_is_custom cannot be flipped off by the owner');

-- Nor can a client lie on the way IN to make a chosen address deletable. The
-- insert is allowed (this owner is Pro), but the trigger overwrites the flag,
-- so the row is still undeletable.
select pg_temp.expect_ok(
  format(
    'insert into document_shares (document_id, owner_id, slug, slug_is_custom) values (%L, %L, %L, false)',
    (select v from t_ids where k = 'doc_pro'),
    (select v from t_ids where k = 'pro'),
    'sneaky-deletable'
  ),
  '6f an INSERT claiming slug_is_custom = false is accepted');
do $$
begin
  if not (select slug_is_custom from document_shares where slug = 'sneaky-deletable') then
    raise exception 'FAIL 6g: the client-supplied slug_is_custom = false was trusted';
  end if;
  raise notice 'PASS  6g the trigger overwrote the client-supplied flag with true';
end;
$$;
select pg_temp.expect_error(
  format('delete from document_shares where slug = %L', 'sneaky-deletable'),
  'P0037',
  '6h …so the row is still undeletable');

-- ------------------------------------------------------------
-- Test 7 — updating slug on an existing row is rejected
-- ------------------------------------------------------------
select pg_temp.expect_error(
  format('update document_shares set slug = %L where slug = %L', 'renamed-deck', 'acme-proposal'),
  'P0035',
  '7a renaming an existing address');
-- Editing anything else on the row must still work — the trigger is on the
-- whole row, so a too-broad guard would break the edit form entirely.
select pg_temp.expect_ok(
  format('update document_shares set recipient_label = %L where slug = %L', 'Renamed label', 'acme-proposal'),
  '7b other columns are still editable');
-- Writing the same value back is not a change.
select pg_temp.expect_ok(
  format('update document_shares set slug = %L where slug = %L', 'acme-proposal', 'acme-proposal'),
  '7c setting slug to its current value is allowed');

-- ------------------------------------------------------------
-- Test 8 — a generated address can still be hard-deleted, as today
-- ------------------------------------------------------------
do $$
declare v_slug text;
begin
  select slug into v_slug from document_shares
   where owner_id = (select v from t_ids where k = 'free') and not slug_is_custom
   limit 1;
  if v_slug is null then
    raise exception 'FAIL 8a: no generated share to delete';
  end if;
  delete from document_shares where slug = v_slug;
  if exists (select 1 from document_shares where slug = v_slug) then
    raise exception 'FAIL 8a: generated share % was not deleted', v_slug;
  end if;
  raise notice 'PASS  8a a generated address is still hard-deletable';
end;
$$;

do $$
begin
  raise notice '----------------------------------------';
  raise notice 'All 033 address control tests passed.';
  raise notice '----------------------------------------';
end;
$$;

rollback;
