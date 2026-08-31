-- 043_trust_layer_foundation_test.sql
-- ------------------------------------------------------------
-- Tests for 043_trust_layer_foundation.sql. Four things are worth testing
-- here and nothing else is:
--
--   1. The handle format rule. A handle becomes a hostname under a wildcard
--      DNS record, so a value the rule lets through is a value that resolves
--      on the public internet. Uppercase, a leading or trailing hyphen, or a
--      `xn--` prefix each produce a hostname that is either invalid or a
--      Unicode lookalike, and none may reach the column.
--
--   2. The claim registry. The reason it exists is that a profile row is
--      deleted with its authentication account, and availability decided from
--      profiles alone would hand a deleted account's hostname — and its Safe
--      Browsing reputation — to whoever signs up next. So: reserved names are
--      unclaimable, a second account cannot take a live name, an allocated
--      name cannot change, and deleting the profile does not free it.
--
--   3. host_handle immutability and ownership. The router matches the request's
--      hostname against this column. A customer who could write it freely
--      could have their document served on `microsoft.htmlradar.page`, which
--      is exactly the reputation-poisoning per-share hostnames were introduced
--      to prevent (design property P10). `authenticated` still holds a
--      table-level UPDATE grant on document_shares, so this is reachable
--      through PostgREST and the trigger is the only thing in the way.
--
--   4. The view's shape and its grants. It carries every customer's handle and
--      every document's R2 storage key. Supabase's default privileges hand new
--      objects in `public` to anon and authenticated and PostgREST publishes
--      every view in `public`, so "did the REVOKE actually take" is the single
--      most consequential assertion in this file.
--
-- WHAT IS NOT TESTED HERE: allocation. Deriving a handle from an account,
-- shortening it on collision and falling back to a generated name is
-- application code in a later lane; this migration deliberately allocates
-- nothing. The concurrent-allocation property IS covered, in section B, at the
-- level this migration owns it: the primary key on handle_registry, which is
-- what makes two simultaneous claims resolve to one winner.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users, profiles,
-- documents, shares and handle_registry rows. Everything sits inside one
-- transaction that ROLLBACKs at the end, so nothing is left behind — but a
-- rollback does not undo a mistake made against production, so point psql at
-- a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then 002, 003, 008,
--                                                     015, 027, 032, 033, 043)
--   psql -v ON_ERROR_STOP=1 -f schema/tests/043_trust_layer_foundation_test.sql
--
-- A throwaway Postgres in Docker is the scratch database this was written
-- against, exactly as 034's, 035's and 037's test files document:
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   …then the auth-schema and role setup 034's header lists, then the schema
--   files, then this.
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
      raise notice 'PASS  % (% as expected)', label, expected;
      return;
    end if;
    raise exception 'FAIL  %: expected SQLSTATE %, got % (%)', label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %: expected SQLSTATE %, but the statement SUCCEEDED', label, expected;
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

create or replace function pg_temp.expect_ok(sql text, label text)
returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'PASS  %', label;
end;
$$;

-- ------------------------------------------------------------
-- Fixtures — two owners, one document each, one live share.
--
-- Pro only so the fixture can choose readable slugs: 033's trigger refuses a
-- chosen link ending on a free account, and nothing here is about who may pick
-- an address.
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'handle-a@example.test'),
  (gen_random_uuid(), 'handle-b@example.test');

insert into t_ids select 'owner_a', id from auth.users where email = 'handle-a@example.test';
insert into t_ids select 'owner_b', id from auth.users where email = 'handle-b@example.test';

update profiles set tier = 'pro'
 where id in (select v from t_ids where k in ('owner_a', 'owner_b'));

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Deck ' || k, 'url', 'https://example.test/deck.html'
from t_ids where k in ('owner_a', 'owner_b');
insert into t_ids select 'doc_a', id from documents where title = 'Deck owner_a';
insert into t_ids select 'doc_b', id from documents where title = 'Deck owner_b';

insert into document_shares (id, document_id, owner_id, slug)
select gen_random_uuid(),
       (select v from t_ids where k = 'doc_a'),
       (select v from t_ids where k = 'owner_a'),
       'trust-layer-deck-a1';
insert into t_ids select 'share_a', id from document_shares where slug = 'trust-layer-deck-a1';

-- ------------------------------------------------------------
-- Section A — the format rule
--
-- A CHECK constraint, so every refusal is 23514. The rule is the design's:
-- 3 to 24 characters, lowercase letters, digits and hyphens, starting and
-- ending with a letter or digit, no two hyphens in a row.
-- ------------------------------------------------------------
select pg_temp.expect_ok(
  format('update profiles set handle = ''acme-corp'' where id = %L',
         (select v from t_ids where k = 'owner_a')),
  'A1 a well-formed handle is accepted');

select pg_temp.expect_eq(
  (select handle from profiles where id = (select v from t_ids where k = 'owner_a')),
  'acme-corp',
  'A2 and it is stored as written');

-- Every rejection below is on owner_b, whose handle is still null.
select pg_temp.expect_error(
  format('update profiles set handle = ''ab'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A3 two characters is too short');

select pg_temp.expect_error(
  format('update profiles set handle = %L where id = %L',
         repeat('a', 25), (select v from t_ids where k = 'owner_b')),
  '23514', 'A4 twenty-five characters is too long');

select pg_temp.expect_error(
  format('update profiles set handle = ''-acme'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A5 a leading hyphen is refused');

select pg_temp.expect_error(
  format('update profiles set handle = ''acme-'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A6 a trailing hyphen is refused');

select pg_temp.expect_error(
  format('update profiles set handle = ''Acme'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A7 an uppercase letter is refused');

select pg_temp.expect_error(
  format('update profiles set handle = ''acme_corp'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A8 an underscore is refused');

select pg_temp.expect_error(
  format('update profiles set handle = ''ac--me'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A9 two hyphens in a row are refused');

-- The one that matters most: the no-double-hyphen clause is what bans every
-- Punycode-encoded Unicode lookalike, without a second rule.
select pg_temp.expect_error(
  format('update profiles set handle = ''xn--80ak6aa92e'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A10 a Punycode xn-- prefix is refused');

select pg_temp.expect_error(
  format('update profiles set handle = ''acme corp'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  '23514', 'A11 a space is refused');

select pg_temp.expect_ok(
  format('update profiles set handle = null where id = %L',
         (select v from t_ids where k = 'owner_b')),
  'A12 null is still allowed — it is the state of every account today');

-- ------------------------------------------------------------
-- Section B — the claim registry
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (select count(*)::int from handle_registry where claimed_by is null),
  193,
  'B1 the reserved-name seed is present in full');

-- A spread across all three groups the design names.
select pg_temp.expect_eq(
  (select count(*)::int from handle_registry
    where handle in ('htmlradar', 'www', 'api', 'mail', 'admin', 'app', 'docs',
                     'cdn', 'status', 'secure', 'login', 'microsoft', 'google',
                     'apple', 'paypal', 'micros0ft', 'html-radar', 'abuse',
                     'postmaster', 'docsend')),
  20,
  'B2 the names the design calls out by name are all reserved');

select pg_temp.expect_error(
  format('update profiles set handle = ''microsoft'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  'P0041', 'B3 a reserved name cannot be claimed');

select pg_temp.expect_error(
  format('update profiles set handle = ''htmlradar'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  'P0041', 'B4 HTMLRadar''s own name cannot be claimed');

-- A1 already claimed 'acme-corp' for owner_a. The registry should say so.
select pg_temp.expect_eq(
  (select claimed_by from handle_registry where handle = 'acme-corp'),
  (select v from t_ids where k = 'owner_a'),
  'B5 allocating a handle writes the claim');

select pg_temp.expect_eq(
  (select released_at is null from handle_registry where handle = 'acme-corp'),
  true,
  'B6 a live claim is not released');

select pg_temp.expect_error(
  format('update profiles set handle = ''acme-corp'' where id = %L',
         (select v from t_ids where k = 'owner_b')),
  'P0041', 'B7 a second account cannot take a live handle');

-- The primary key on handle_registry is what makes two simultaneous claims
-- resolve to one winner; this is the same collision the second transaction
-- would see, arriving serially.
select pg_temp.expect_error(
  'insert into handle_registry (handle) values (''acme-corp'')',
  '23505', 'B8 the registry primary key is the race resolution');

select pg_temp.expect_error(
  format('update profiles set handle = ''acme-two'' where id = %L',
         (select v from t_ids where k = 'owner_a')),
  'P0040', 'B9 an allocated handle cannot be changed');

select pg_temp.expect_error(
  format('update profiles set handle = null where id = %L',
         (select v from t_ids where k = 'owner_a')),
  'P0040', 'B10 an allocated handle cannot be cleared either');

-- Re-asserting the same value is the one tolerated no-op, so a backfill or an
-- idempotent write does not blow up.
select pg_temp.expect_ok(
  format('update profiles set handle = ''acme-corp'' where id = %L',
         (select v from t_ids where k = 'owner_a')),
  'B11 re-writing the same handle is a no-op, not an error');

-- The whole reason this table exists. Deleting the account cascades the
-- profile away; the claim must survive it.
select pg_temp.expect_ok(
  format('delete from auth.users where id = %L',
         (select v from t_ids where k = 'owner_b')),
  'B12 an account with no handle deletes cleanly');

-- owner_a holds a chosen-address share, and 033 blocks the cascade that would
-- delete it. Suspending that guard around the deletion is exactly the escape
-- hatch 033's header documents for a genuine erasure; the guard itself is 033's
-- test's business, not this one's.
alter table document_shares disable trigger trg_block_custom_slug_delete;
select pg_temp.expect_ok(
  format('delete from auth.users where id = %L',
         (select v from t_ids where k = 'owner_a')),
  'B13 deleting the account cascades the profile away');
alter table document_shares enable trigger trg_block_custom_slug_delete;

select pg_temp.expect_eq(
  (select count(*)::int from profiles where id = (select v from t_ids where k = 'owner_a')),
  0,
  'B14 the profile row really is gone');

select pg_temp.expect_eq(
  (select count(*)::int from handle_registry where handle = 'acme-corp'),
  1,
  'B15 …and the claim on its handle survived it');

select pg_temp.expect_eq(
  (select released_at is not null from handle_registry where handle = 'acme-corp'),
  true,
  'B16 the claim is stamped released, recording that the holder is gone');

-- The property the whole table is for: a retired name is never silently
-- re-issued to the next signup.
insert into auth.users (id, email) values (gen_random_uuid(), 'handle-c@example.test');
insert into t_ids select 'owner_c', id from auth.users where email = 'handle-c@example.test';

select pg_temp.expect_error(
  format('update profiles set handle = ''acme-corp'' where id = %L',
         (select v from t_ids where k = 'owner_c')),
  'P0041', 'B17 a retired handle cannot be inherited by a new account');

-- ------------------------------------------------------------
-- Section C — host_handle
-- ------------------------------------------------------------
update profiles set tier = 'pro', handle = 'zephyr-labs'
 where id = (select v from t_ids where k = 'owner_c');

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Deck owner_c', 'url', 'https://example.test/deck.html'
from t_ids where k = 'owner_c';
insert into t_ids select 'doc_c', id from documents where title = 'Deck owner_c';

select pg_temp.expect_ok(
  format('insert into document_shares (document_id, owner_id, slug) values (%L, %L, ''trust-layer-apex-1'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  'C1 a share still creates with no hostname — the state of every share today');

select pg_temp.expect_eq(
  (select host_handle from document_shares where slug = 'trust-layer-apex-1'),
  null::text,
  'C2 and that hostname is null, so it is served on the apex forever');

select pg_temp.expect_ok(
  format('insert into document_shares (document_id, owner_id, slug, host_handle) values (%L, %L, ''trust-layer-host-1'', ''zephyr-labs'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  'C3 a share may be created on its own account''s handle');

-- The reputation-poisoning attempt. `authenticated` holds a table-level UPDATE
-- grant on document_shares, so this is a reachable PostgREST write.
select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, host_handle) values (%L, %L, ''trust-layer-host-2'', ''microsoft'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  'P0043', 'C4 a share cannot be created on a hostname the account does not hold');

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, host_handle) values (%L, %L, ''trust-layer-host-3'', ''acme-corp'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  'P0043', 'C5 nor on another account''s retired hostname');

select pg_temp.expect_error(
  'update document_shares set host_handle = ''acme-corp'' where slug = ''trust-layer-host-1''',
  'P0042', 'C6 a stored hostname cannot be changed');

select pg_temp.expect_error(
  'update document_shares set host_handle = null where slug = ''trust-layer-host-1''',
  'P0042', 'C7 a stored hostname cannot be cleared — that would move a sent link');

-- Null to the owner's own handle is the one permitted transition: it is how a
-- later lane records a hostname on a share it has just created.
select pg_temp.expect_ok(
  'update document_shares set host_handle = ''zephyr-labs'' where slug = ''trust-layer-apex-1''',
  'C8 null may become the account''s own handle');

-- A malformed hostname is caught by the ownership check first, because a BEFORE
-- trigger runs ahead of a CHECK constraint and no well-formed handle can equal
-- a malformed string. That ordering is the right one — the stricter rule
-- answers — so this asserts the code the customer actually gets.
select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, host_handle) values (%L, %L, ''trust-layer-host-4'', ''XN--BAD'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  'P0043', 'C9 a malformed hostname is refused by the ownership check first');

-- …and the CHECK constraint underneath it still holds on its own, which is what
-- makes it worth having: if a later migration ever loosens the trigger, a
-- string that could not be a hostname still cannot reach the column.
alter table document_shares disable trigger trg_validate_share_host_handle;
select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, host_handle) values (%L, %L, ''trust-layer-host-4'', ''XN--BAD'')',
         (select v from t_ids where k = 'doc_c'),
         (select v from t_ids where k = 'owner_c')),
  '23514', 'C10 with the trigger suspended, the format constraint still refuses it');
alter table document_shares enable trigger trg_validate_share_host_handle;

-- ------------------------------------------------------------
-- Section D — the private view
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'share_lookup'),
  array[
    'id', 'slug', 'document_id', 'owner_id', 'recipient_label',
    'require_email', 'require_password', 'allowed_email_domains',
    'allowed_emails', 'lock_deck', 'expires_at', 'revoked_at', 'host_handle',
    'owner_handle', 'owner_tier', 'document_title', 'document_source_type',
    'document_source_url', 'document_current_version', 'document_r2_key',
    'document_deleted_at'
  ],
  'D1 the view exposes exactly the columns the proxy needs, in order');

-- The password hash is the field most obviously absent, and deliberately so:
-- password checking goes through the rate-limited RPC, not a view read on
-- every request.
select pg_temp.expect_eq(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'share_lookup'
      and column_name = 'password_hash'),
  0,
  'D2 the password hash is not in it');

select pg_temp.expect_eq(
  (select host_handle from share_lookup where slug = 'trust-layer-host-1'),
  'zephyr-labs',
  'D3 the stored hostname is readable without a second query');

select pg_temp.expect_eq(
  (select owner_handle from share_lookup where slug = 'trust-layer-host-1'),
  'zephyr-labs',
  'D4 so is the owner''s current handle, which routing must NOT use');

select pg_temp.expect_eq(
  (select owner_tier from share_lookup where slug = 'trust-layer-host-1'),
  'pro',
  'D5 and the owner''s tier, replacing the proxy''s separate profile read');

-- The consequential one. Supabase's default privileges grant new objects in
-- `public` to anon and authenticated, and PostgREST publishes every view in
-- `public`. Without the REVOKE this view is a public index of every share,
-- every handle and every document's storage key.
set local role anon;
select pg_temp.expect_error(
  'select count(*) from share_lookup', '42501',
  'D6 anon cannot read the view');
reset role;

set local role authenticated;
select pg_temp.expect_error(
  'select count(*) from share_lookup', '42501',
  'D7 a signed-in customer cannot read the view either — not even their own rows');
reset role;

-- Deny-all RLS on the registry, for the same reason: which names are taken is
-- an enumeration of who our customers are.
set local role authenticated;
select pg_temp.expect_error(
  'select count(*) from handle_registry', '42501',
  'D8 a signed-in customer cannot read the claim registry');
select pg_temp.expect_error(
  format('update profiles set handle = ''sneaky-name'' where id = %L',
         (select v from t_ids where k = 'owner_c')),
  '42501',
  'D9 a signed-in customer has no grant to write handle at all (032''s column lockdown)');
reset role;

set local role service_role;
select pg_temp.expect_eq(
  (select count(*)::int from share_lookup where slug = 'trust-layer-host-1'),
  1,
  'D10 the service role, which is what the proxy runs as, can read it');
reset role;

rollback;
