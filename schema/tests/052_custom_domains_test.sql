-- 052_custom_domains_test.sql
-- ------------------------------------------------------------
-- Tests for 052_custom_domains.sql. This file is written as an attack, not as
-- a demonstration: almost every case below is somebody trying to make a
-- document serve on a hostname they must not have, and the assertion is the
-- refusal. Six things are worth testing and nothing else is.
--
--   1. What may be claimed. A hostname here becomes a real name on the public
--      internet with our certificate in front of it. A bare domain takes the
--      customer's own website down; a Punycode or `htmlradar`-shaped name is a
--      phishing address wearing our reputation; our own domains are ours.
--      `acme.co.uk` is the case that makes this more than a label count —
--      three labels is not "one below the registrable domain" everywhere.
--
--   2. Who may claim, and how many. One non-retired domain per account, one
--      account per hostname, Pro or comped only, and a name another account
--      once held cannot serve again without a human. That last rule is the
--      whole mitigation for having no ownership proof beyond the CNAME
--      (sprint: "Refused, with reasons"), so it is tested as a refusal to go
--      live and not merely as a flag being set — including after the previous
--      holder's ACCOUNT IS DELETED, which is the case a foreign key would
--      have quietly broken, and including the one audited way past the flag.
--
--   3. That a customer cannot write any of it. RLS scopes ROWS, not COLUMNS,
--      and `authenticated` reaches document_shares through PostgREST with the
--      public anon key. The tests in sections C and D therefore run AS the
--      authenticated role with a jwt claim set, exactly as a PostgREST
--      request does; running them as the superuser would bypass RLS and prove
--      nothing.
--
--   4. That a link's address is decided once, inside the insert that creates
--      the share, and frozen afterwards in every direction including null.
--      This is Astra's first defect: a post-insert stamp exposes a custom
--      share on htmlradar.page for the width of the update, and swallows its
--      own failure.
--
--   5. That eligibility applies to enrolment and to NEW links only. A
--      downgraded account must still be able to disconnect and still be
--      monitored, and every link it already sent must keep serving. The
--      downgrade drill is section F.
--
--   6. That the two things the database itself prints or hands over — the
--      share_lookup view the worker reads, and the abuse e-mail's link — name
--      the host the share actually stored.
--
-- WHAT IS NOT TESTED HERE: anything above the database. Whether the worker
-- refuses a pending host, whether Settings retries a failed Cloudflare call,
-- whether the monitor demotes after two failures — those are Track B, C and D
-- and they have their own tests. This file is the floor underneath all three.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users, profiles,
-- documents, shares, custom_domains, abuse_reports and rate_limits rows.
-- Everything sits inside one transaction that ROLLBACKs at the end, so
-- nothing is left behind — but a rollback does not undo a mistake made
-- against production, so point psql at a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then the whole chain in
--                                                     order, through 052)
--   psql -v ON_ERROR_STOP=1 -f schema/tests/052_custom_domains_test.sql
--
-- A throwaway Postgres in Docker is the scratch database this was written
-- against, exactly as 034's, 037's and 043's test files document:
--
--   docker run -d --name hr-schema-test -e POSTGRES_PASSWORD=postgres \
--     -p 55432:5432 postgres:15
--   export PGPASSWORD=postgres PGHOST=localhost PGPORT=55432 PGUSER=postgres
--   …then the pg_net stub 044's header gives, the role and auth.users/auth.uid
--   stubs 034's and 044's headers give, then the schema files, then this.
--
-- THE PILOT PLACEHOLDER. Section A's gethtmlradar.com cases assume the
-- migration was applied with its placeholder UNEDITED (the nil uuid, which
-- matches no account). That is how the file ships and how a self-hoster runs
-- it. On a database where the pilot id has been filled in, A13 still passes —
-- the fixture owners are not the pilot account either way.
--
-- Output is one NOTICE per test. Any failure raises and aborts the run.
-- ------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ------------------------------------------------------------
-- Helpers (same shape as 034's, 037's and 043's)
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
-- Fixtures — four accounts, because every interesting case needs two.
--
--   pro      an ordinary paying account
--   pro2     a second paying account, so "somebody else's domain" is a real
--            row and not a hypothetical
--   free     a free account
--   comped   an internal account: tier is NOT 'pro', comped is true (032).
--            Reading tier alone would refuse it, which is Astra's finding and
--            the reason the pilot would not have been able to run at all.
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'cd-pro@example.test'),
  (gen_random_uuid(), 'cd-pro2@example.test'),
  (gen_random_uuid(), 'cd-free@example.test'),
  (gen_random_uuid(), 'cd-comped@example.test'),
  (gen_random_uuid(), 'cd-spare@example.test');

insert into t_ids select 'pro',    id from auth.users where email = 'cd-pro@example.test';
insert into t_ids select 'pro2',   id from auth.users where email = 'cd-pro2@example.test';
insert into t_ids select 'free',   id from auth.users where email = 'cd-free@example.test';
insert into t_ids select 'comped', id from auth.users where email = 'cd-comped@example.test';
-- A paying account with no domain, so a case that has to SUCCEED does not
-- collide with the one-per-owner rule.
insert into t_ids select 'spare',  id from auth.users where email = 'cd-spare@example.test';

create or replace function pg_temp.uid(k text) returns uuid language sql stable as
  $$ select v from t_ids where t_ids.k = $1 $$;

update profiles set tier = 'pro'  where id in (pg_temp.uid('pro'), pg_temp.uid('pro2'), pg_temp.uid('spare'));
update profiles set tier = 'free' where id = pg_temp.uid('free');
update profiles set tier = 'free', comped = true where id = pg_temp.uid('comped');

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), pg_temp.uid(k), 'Deck ' || k, 'url', 'https://example.test/deck.html'
from (values ('pro'), ('pro2'), ('free'), ('comped'), ('spare')) as f(k);

-- SECURITY DEFINER on purpose: half of this file runs as `authenticated`,
-- where RLS hides other accounts' documents and domains. A helper that
-- silently returned null there would turn a hostile case into a share with no
-- document and no domain — a test that passes by testing nothing.
create or replace function pg_temp.doc(k text) returns uuid
language sql stable security definer set search_path = public as
  $$ select id from documents where title = 'Deck ' || $1 $$;

create or replace function pg_temp.domain(h text) returns uuid
language sql stable security definer set search_path = public as
  $$ select id from custom_domains where hostname = $1 and retired_at is null $$;

-- ------------------------------------------------------------
-- Section A — what may be claimed
--
-- Every insert here is the service role's (the Settings action's) job; the
-- question is only whether the trigger lets the value through. Section C
-- proves separately that a customer cannot do these inserts at all.
-- ------------------------------------------------------------
select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.acme.com'')',
         pg_temp.uid('pro')),
  'A1 an ordinary subdomain of a domain the customer owns is accepted');

select pg_temp.expect_eq(
  (select state from custom_domains where hostname = 'decks.acme.com'),
  'pending',
  'A2 and it starts pending — claimed, serving nothing');

-- Normalisation, so the unique index, the trigger and the worker's hostname
-- match all see one spelling. A trailing dot is a legal fully-qualified name
-- and is not a different host.
select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''  DECKS.Example-Co.COM.  '')',
         pg_temp.uid('pro2')),
  'A3 case, surrounding space and a trailing dot are accepted');

select pg_temp.expect_eq(
  (select count(*)::int from custom_domains where hostname = 'decks.example-co.com'),
  1,
  'A4 …and normalised to one lowercase spelling');

-- The bare-domain rule. Pointing a registrable domain at us replaces the
-- customer's own website, and the CNAME cannot coexist with their apex
-- records. Refused with a suggestion, never accepted.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.com'')',
         pg_temp.uid('free')),
  'P0045', 'A5 a bare domain is refused');

-- Astra's case. Three labels is "one below the registrable domain" only under
-- an ordinary suffix; under co.uk it is the bare domain itself.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.co.uk'')',
         pg_temp.uid('free')),
  'P0045', 'A6 a bare domain under a multi-part suffix is refused too');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.com.au'')',
         pg_temp.uid('free')),
  'P0045', 'A7 …and under com.au');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.com.br'')',
         pg_temp.uid('free')),
  'P0045', 'A7b …and under com.br');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.co.jp'')',
         pg_temp.uid('free')),
  'P0045', 'A7c …and under co.jp');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme.gov.uk'')',
         pg_temp.uid('free')),
  'P0045', 'A7d …and under gov.uk');

select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.acme.co.uk'')',
         pg_temp.uid('comped')),
  'A8 a subdomain under a multi-part suffix is fine');

-- The phishing shapes, from the PRD's "Phishing posture" check.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''xn--80ak6aa92e.example.com'')',
         pg_temp.uid('free')),
  'P0046', 'A9 a Punycode label is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''htmlradar-login.example.com'')',
         pg_temp.uid('free')),
  'P0046', 'A10 a name carrying "htmlradar" is refused, wherever it sits');

-- Digits standing in for letters. A recipient reading `htm1radar-login` in a
-- browser bar does not see the difference, which is the entire trick. Of the
-- five substitutions the rule folds, only `1` for `l` and `7` for `t` can
-- spell our name at all — the rest are there so the rule does not have to be
-- revisited if the name ever changes.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''htm1radar-login.example.com'')',
         pg_temp.uid('free')),
  'P0046', 'A10b a one standing in for an l is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''h7mlradar.example.com'')',
         pg_temp.uid('free')),
  'P0046', 'A10d a seven standing in for a t is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.htmlradar.page'')',
         pg_temp.uid('free')),
  'P0046', 'A11 our own serving domain cannot be claimed');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.htmlradar.com'')',
         pg_temp.uid('free')),
  'P0046', 'A12 nor our marketing domain');

-- The pilot exception is an exception for the PILOT, not for the name. An
-- ordinary account claiming a test name would be claiming a hostname on a
-- zone we control and read the mail of.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.gethtmlradar.com'')',
         pg_temp.uid('free')),
  'P0046', 'A13 a gethtmlradar.com test name is refused to everyone but the pilot owners');

-- Malformed names: each of these either cannot resolve or resolves to
-- something other than what was typed.
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''-decks.acme.com'')',
         pg_temp.uid('free')),
  'P0044', 'A14 a leading hyphen is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks-.acme.com'')',
         pg_temp.uid('free')),
  'P0044', 'A15 a trailing hyphen is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks_1.acme.com'')',
         pg_temp.uid('free')),
  'P0044', 'A16 an underscore is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks .acme.com'')',
         pg_temp.uid('free')),
  'P0044', 'A17 a space is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, %L)',
         pg_temp.uid('free'), repeat('a', 64) || '.acme.com'),
  'P0044', 'A18 a label over sixty-three characters is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''acme'')',
         pg_temp.uid('free')),
  'P0044', 'A19 a single label is refused');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, '''')',
         pg_temp.uid('free')),
  'P0044', 'A20 an empty hostname is refused');

-- The other direction, and the reason the lookalike rule is deliberately
-- narrow: 043's reserved HANDLE list must NOT be applied to customer domains,
-- or ordinary company names stop working (Astra, "Delete or simplify").
select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''docs.example.org'')',
         pg_temp.uid('spare')),
  'A21 an ordinary name that happens to be a reserved HANDLE is fine here');

-- …and that row has done its job. Remove it so the spare account is free for
-- whatever a later section needs.
delete from custom_domains where hostname = 'docs.example.org';

-- The CHECK constraint under the trigger. If a later migration ever loosens
-- the trigger, a string that cannot be a hostname still cannot reach the
-- column.
alter table custom_domains disable trigger trg_validate_custom_domain;
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''DECKS.ACME.COM'')',
         pg_temp.uid('free')),
  '23514', 'A22 with the trigger suspended, the format constraint still refuses uppercase');
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname, state) values (%L, ''keep.acme.com'', ''retired'')',
         pg_temp.uid('free')),
  '23514', 'A23 …and a retired state with no retired_at cannot be written either');
alter table custom_domains enable trigger trg_validate_custom_domain;

-- ------------------------------------------------------------
-- Section B — who may claim, how many, and taking a name back
-- ------------------------------------------------------------
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.free-co.com'')',
         pg_temp.uid('free')),
  'P0047', 'B1 a free account cannot connect a domain');

-- comped is a boolean, not a tier (032). A8 already proved it works; this
-- says so in one line, because reading `tier` alone is the mistake that would
-- have stopped the pilot.
select pg_temp.expect_eq(
  (select count(*)::int from custom_domains
    where owner_id = pg_temp.uid('comped') and hostname = 'decks.acme.co.uk'),
  1,
  'B2 a comped account, whose tier is not pro, can');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks2.acme.com'')',
         pg_temp.uid('pro')),
  'P0048', 'B3 one non-retired domain per account');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.acme.com'')',
         pg_temp.uid('comped')),
  'P0048', 'B4 …which also answers a second account claiming a taken name, when that account already has one');

-- The same question from an account with no domain of its own: this is the
-- one the Settings copy has to explain, because the customer can see their
-- own DNS pointing at us.
insert into auth.users (id, email) values (gen_random_uuid(), 'cd-pro3@example.test');
insert into t_ids select 'pro3', id from auth.users where email = 'cd-pro3@example.test';
update profiles set tier = 'pro' where id = pg_temp.uid('pro3');
insert into documents (id, owner_id, title, source_type, source_url)
values (gen_random_uuid(), pg_temp.uid('pro3'), 'Deck pro3', 'url', 'https://example.test/deck.html');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.acme.com'')',
         pg_temp.uid('pro3')),
  'P0056', 'B5 a hostname another account holds cannot be claimed');

-- The unique partial index is the race resolution: two simultaneous claims
-- both insert, one commits, the other gets this. Same collision, arriving
-- serially.
alter table custom_domains disable trigger trg_validate_custom_domain;
select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.acme.com'')',
         pg_temp.uid('pro3')),
  '23505', 'B6 with the trigger suspended, the unique index is still the race resolution');
alter table custom_domains enable trigger trg_validate_custom_domain;

-- Immutability. A claim is half of the address of every link issued on it.
select pg_temp.expect_error(
  'update custom_domains set hostname = ''other.acme.com'' where hostname = ''decks.acme.com''',
  'P0049', 'B7 a hostname cannot be changed');

select pg_temp.expect_error(
  format('update custom_domains set owner_id = %L where hostname = ''decks.acme.com''',
         pg_temp.uid('pro3')),
  'P0049', 'B8 a claim cannot be moved to another account');

select pg_temp.expect_error(
  'update custom_domains set previous_owner_review = true where hostname = ''decks.acme.com''',
  'P0049', 'B9 the re-claim review flag is the database''s, not the caller''s');

-- The state machine the monitor drives.
select pg_temp.expect_ok(
  'update custom_domains set state = ''live'', verified_at = now() where hostname = ''decks.acme.com''',
  'B10 pending may become live');

select pg_temp.expect_ok(
  'update custom_domains set state = ''disconnected'', consecutive_failures = 2 where hostname = ''decks.example-co.com''',
  'B11 a domain may be disconnected');

select pg_temp.expect_ok(
  'update custom_domains set state = ''live'', consecutive_failures = 0 where hostname = ''decks.example-co.com''',
  'B12 …and recover');

select pg_temp.expect_ok(
  'update custom_domains set state = ''retired'' where hostname = ''decks.example-co.com''',
  'B13 and be retired');

select pg_temp.expect_eq(
  (select retired_at is not null from custom_domains where hostname = 'decks.example-co.com'),
  true,
  'B14 retiring stamps the tombstone without the caller remembering to');

select pg_temp.expect_error(
  'update custom_domains set state = ''live'' where hostname = ''decks.example-co.com''',
  'P0049', 'B15 retired is terminal — a disconnected domain cannot be resurrected');

-- Taking a name back. The customer who retired it may claim it again; anybody
-- else may claim it but may not serve on it until a human agrees. This is the
-- whole mitigation for having no ownership proof beyond the CNAME.
select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.example-co.com'')',
         pg_temp.uid('pro2')),
  'B16 the account that retired a name may claim it again');

select pg_temp.expect_eq(
  (select previous_owner_review from custom_domains
    where hostname = 'decks.example-co.com' and retired_at is null),
  false,
  'B17 …with no review needed, because the previous holder is the same account');

select pg_temp.expect_ok(
  'update custom_domains set state = ''retired'' where hostname = ''decks.example-co.com'' and retired_at is null',
  'B18 (retire it again to set up the re-claim by a stranger)');

select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.example-co.com'')',
         pg_temp.uid('pro3')),
  'B19 a different account may claim a retired name');

select pg_temp.expect_eq(
  (select previous_owner_review from custom_domains
    where hostname = 'decks.example-co.com' and retired_at is null),
  true,
  'B20 …and the row is flagged for review');

select pg_temp.expect_error(
  'update custom_domains set state = ''live'' where hostname = ''decks.example-co.com'' and retired_at is null',
  'P0050', 'B21 a flagged re-claim cannot serve until support clears it');

-- The way past the flag, and the fact that there is exactly one. A safeguard
-- with no documented way through it is a safeguard somebody disables at two
-- in the morning; a safeguard with one audited way through it is a decision
-- with a name on it.
select pg_temp.expect_error(
  'update custom_domains set previous_owner_review = false where hostname = ''decks.example-co.com'' and retired_at is null',
  'P0049', 'B22 an ordinary update cannot clear the review flag');

set local role service_role;

select pg_temp.expect_error(
  format('select approve_custom_domain_reclaim(%L, ''  '')',
         pg_temp.domain('decks.example-co.com')),
  'P0057', 'B23 approving without saying why is refused');

select pg_temp.expect_error(
  format('select approve_custom_domain_reclaim(%L, ''who cares'')', gen_random_uuid()),
  'P0058', 'B24 approving a domain that does not exist is refused');

select pg_temp.expect_error(
  format('select approve_custom_domain_reclaim(%L, ''nothing to approve'')',
         pg_temp.domain('decks.acme.com')),
  'P0059', 'B25 approving a domain that is not under review is refused');

select pg_temp.expect_eq(
  (select previous_owner_review from approve_custom_domain_reclaim(
     pg_temp.domain('decks.example-co.com'),
     'Spoke to the new owner, they showed the registrar invoice — AR, 17 Sep')),
  false,
  'B26 support approval clears the flag');

reset role;

select pg_temp.expect_eq(
  (select reclaim_approved_at is not null and reclaim_approved_by is not null
          and reclaim_note like '%registrar invoice%'
     from custom_domains where hostname = 'decks.example-co.com' and retired_at is null),
  true,
  'B27 …and records when, which role, and why');

select pg_temp.expect_ok(
  'update custom_domains set state = ''live'' where hostname = ''decks.example-co.com'' and retired_at is null',
  'B28 …after which the re-claimed name may serve');

-- The approval setting is bound to one row id and is transaction-local, so it
-- cannot be reused to launder a second row in the same transaction.
insert into auth.users (id, email) values
  (gen_random_uuid(), 'cd-second@example.test'),
  (gen_random_uuid(), 'cd-third@example.test');
insert into t_ids select 'second', id from auth.users where email = 'cd-second@example.test';
insert into t_ids select 'third',  id from auth.users where email = 'cd-third@example.test';
update profiles set tier = 'pro' where id in (pg_temp.uid('second'), pg_temp.uid('third'));
insert into custom_domains (owner_id, hostname) values (pg_temp.uid('second'), 'decks.spare-co.com');
update custom_domains set state = 'retired' where hostname = 'decks.spare-co.com';
insert into custom_domains (owner_id, hostname) values (pg_temp.uid('third'), 'decks.spare-co.com');

select pg_temp.expect_error(
  'update custom_domains set previous_owner_review = false where hostname = ''decks.spare-co.com'' and retired_at is null',
  'P0049', 'B29 one approval does not clear the next row''s flag');

-- ------------------------------------------------------------
-- Deleting the account must not launder the name.
--
-- This is the case a foreign key would have broken: `on delete cascade` to
-- auth.users would take the claim away with the account, and the next person
-- to claim that hostname would look like the first one ever to hold it. The
-- claim outlives the account exactly as handle_registry's does (043).
-- ------------------------------------------------------------
insert into auth.users (id, email) values
  (gen_random_uuid(), 'cd-gone@example.test'),
  (gen_random_uuid(), 'cd-newcomer@example.test');
insert into t_ids select 'gone',     id from auth.users where email = 'cd-gone@example.test';
insert into t_ids select 'newcomer', id from auth.users where email = 'cd-newcomer@example.test';
update profiles set tier = 'pro' where id in (pg_temp.uid('gone'), pg_temp.uid('newcomer'));

insert into custom_domains (owner_id, hostname, state, verified_at)
values (pg_temp.uid('gone'), 'decks.leaving-co.com', 'live', now());

select pg_temp.expect_ok(
  format('delete from auth.users where id = %L', pg_temp.uid('gone')),
  'B30 the account that held a domain is deleted');

select pg_temp.expect_eq(
  (select count(*)::int from profiles where id = pg_temp.uid('gone')),
  0,
  'B31 the profile row really is gone');

select pg_temp.expect_eq(
  (select owner_id = pg_temp.uid('gone') and owner_deleted_at is not null
     from custom_domains where hostname = 'decks.leaving-co.com'),
  true,
  'B32 …and the claim survived it, stamped with the fact that its holder left');

-- Retired as well as stamped: the hostname is serving nothing, so it must
-- stop holding the one-per-hostname index against everybody else. The row
-- stays; only the claim on the index goes.
select pg_temp.expect_eq(
  (select state from custom_domains where hostname = 'decks.leaving-co.com'),
  'retired',
  'B32b …and retired, because a deleted account serves nothing');

-- And it lands on the monitor's list of Cloudflare hostnames still standing:
-- retiring never clears cloudflare_id, or nothing would record that the
-- hostname is ours to delete.
update custom_domains set cloudflare_id = 'cf-leaving-co'
 where hostname = 'decks.leaving-co.com';
select pg_temp.expect_eq(
  (select count(*)::int from custom_domains
    where retired_at is not null and cloudflare_id is not null
      and cloudflare_deleted_at is null
      and hostname = 'decks.leaving-co.com'),
  1,
  'B32c …and shows up in the sweep for hostnames still standing at Cloudflare');

-- The property the whole arrangement is for.
select pg_temp.expect_ok(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''decks.leaving-co.com'')',
         pg_temp.uid('newcomer')),
  'B33 a new account may claim the hostname of a deleted account');

select pg_temp.expect_eq(
  (select previous_owner_review from custom_domains
    where hostname = 'decks.leaving-co.com' and retired_at is null),
  true,
  'B34 …but it is still flagged for review — deleting the account did not launder the name');

select pg_temp.expect_error(
  'update custom_domains set state = ''live'' where hostname = ''decks.leaving-co.com'' and retired_at is null',
  'P0050', 'B35 …and it still cannot serve until a person agrees');

-- ------------------------------------------------------------
-- Section C — a customer cannot write any of this
--
-- These run AS `authenticated` with a jwt claim set, which is exactly what a
-- PostgREST request with the public anon key and a signed-in session is.
-- Running them as the superuser would bypass RLS and prove nothing.
-- ------------------------------------------------------------
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('pro')::text, true); end $$;

select pg_temp.expect_eq(
  (select count(*)::int from custom_domains),
  1,
  'C1 a signed-in customer sees their own domain');

select pg_temp.expect_eq(
  (select count(*)::int from custom_domains where owner_id <> pg_temp.uid('pro')),
  0,
  'C2 …and nobody else''s, which would be a list of who our customers are');

select pg_temp.expect_error(
  format('insert into custom_domains (owner_id, hostname) values (%L, ''self-serve.acme.com'')',
         pg_temp.uid('pro')),
  '42501', 'C3 a customer cannot insert a claim, even their own');

select pg_temp.expect_error(
  'update custom_domains set state = ''live'' where hostname = ''decks.acme.com''',
  '42501', 'C4 a customer cannot promote their own domain to live');

select pg_temp.expect_error(
  'delete from custom_domains where hostname = ''decks.acme.com''',
  '42501', 'C5 a customer cannot delete the claim record');

reset role;

set local role anon;
select pg_temp.expect_error(
  'select count(*) from custom_domains', '42501',
  'C6 anon cannot read the table at all');
reset role;

-- The approval function is the one way past the re-claim review, so the grant
-- on it is the whole of its security argument: a caller who can execute it
-- chooses the row, and could therefore approve their own claim on somebody
-- else's hostname.
do $$
declare
  v_sig text := 'approve_custom_domain_reclaim(uuid, text)';
  r record;
begin
  for r in select unnest(array['anon', 'authenticated', 'public']) as who loop
    if has_function_privilege(r.who, v_sig, 'execute') then
      raise exception 'FAIL C7: % can execute approve_custom_domain_reclaim', r.who;
    end if;
  end loop;
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception 'FAIL C7: the service role cannot execute approve_custom_domain_reclaim';
  end if;
  raise notice 'PASS  C7 only the service role may approve a re-claim';
end;
$$;
select set_config('request.jwt.claim.sub', '', true);

-- ------------------------------------------------------------
-- Section D — a share's address, and the attempt to point it somewhere else
--
-- `authenticated` holds a table-level UPDATE and INSERT grant on
-- document_shares (001's policy is row-scoped), so every insert below is a
-- write a customer can really make through PostgREST. The trigger is the only
-- thing in the way.
-- ------------------------------------------------------------
-- pro2 needs a live domain of its own, for "somebody else's domain".
update custom_domains set state = 'retired'
 where owner_id = pg_temp.uid('pro2') and retired_at is null;
insert into custom_domains (owner_id, hostname, state, verified_at)
values (pg_temp.uid('pro2'), 'decks.other-co.com', 'live', now());

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('pro')::text, true); end $$;

select pg_temp.expect_ok(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-own-domain-1'', %L)',
         pg_temp.doc('pro'), pg_temp.uid('pro'), pg_temp.domain('decks.acme.com')),
  'D1 a link may be created on the account''s own live domain');

-- THE case this whole migration exists for.
select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-steal-1'', %L)',
         pg_temp.doc('pro'), pg_temp.uid('pro'), pg_temp.domain('decks.other-co.com')),
  'P0052', 'D2 a link cannot be created on another account''s domain');

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-steal-2'', %L)',
         pg_temp.doc('pro'), pg_temp.uid('pro'), gen_random_uuid()),
  'P0052', 'D3 nor on a domain id that does not exist');

reset role;

-- A pending domain serves nothing, so a link born on one is born broken.
-- (pro3 still holds the flagged re-claim from B19; retire it so the one
-- domain per account rule leaves room for this one.)
update custom_domains set state = 'retired'
 where owner_id = pg_temp.uid('pro3') and retired_at is null;
insert into custom_domains (owner_id, hostname) values (pg_temp.uid('pro3'), 'pending.pro3.com');

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('pro3')::text, true); end $$;

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-pending-1'', %L)',
         pg_temp.doc('pro3'), pg_temp.uid('pro3'), pg_temp.domain('pending.pro3.com')),
  'P0053', 'D4 a link cannot be created on a pending domain');

reset role;
update custom_domains set state = 'disconnected' where hostname = 'pending.pro3.com';
set local role authenticated;

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-disc-1'', %L)',
         pg_temp.doc('pro3'), pg_temp.uid('pro3'), pg_temp.domain('pending.pro3.com')),
  'P0053', 'D5 nor on a disconnected one');

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- One address per link. A share carrying both would have two, and the worker
-- would have to pick — which is a decision nothing should ever have to make.
update profiles set handle = 'acme-links' where id = pg_temp.uid('pro');

-- A handle share, created here while the account is still Pro. Section H
-- reports on it, to prove the third address shape.
insert into document_shares (document_id, owner_id, slug, host_handle)
values (pg_temp.doc('pro'), pg_temp.uid('pro'), 'cd-handle-1', 'acme-links');

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, host_handle, custom_domain_id) values (%L, %L, ''cd-both-1'', ''acme-links'', %L)',
         pg_temp.doc('pro'), pg_temp.uid('pro'), pg_temp.domain('decks.acme.com')),
  'P0054', 'D6 a link cannot carry a handle and a custom domain at once');

-- Frozen, in every direction, including null. Astra's first defect: a
-- post-insert stamp exposes a custom share on htmlradar.page for the width of
-- the update and swallows its own failure, so the stamp is gone and so is the
-- gap it went through.
select pg_temp.expect_error(
  format('update document_shares set custom_domain_id = %L where slug = ''cd-own-domain-1''',
         pg_temp.domain('decks.other-co.com')),
  'P0051', 'D7 a link''s domain cannot be repointed');

select pg_temp.expect_error(
  'update document_shares set custom_domain_id = null where slug = ''cd-own-domain-1''',
  'P0051', 'D8 nor cleared — that would move a link somebody has already been sent');

select pg_temp.expect_ok(
  format('insert into document_shares (document_id, owner_id, slug) values (%L, %L, ''cd-apex-1'')',
         pg_temp.doc('pro'), pg_temp.uid('pro')),
  'D9 a link with no domain is still the ordinary case');

select pg_temp.expect_error(
  format('update document_shares set custom_domain_id = %L where slug = ''cd-apex-1''',
         pg_temp.domain('decks.acme.com')),
  'P0051', 'D10 …and null cannot be filled in afterwards either');

-- ------------------------------------------------------------
-- Section E — create_share chooses the host, in the insert that creates it
-- ------------------------------------------------------------
update profiles set default_custom_domain_id = pg_temp.domain('decks.acme.com')
 where id = pg_temp.uid('pro');

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('pro')::text, true); end $$;

select pg_temp.expect_eq(
  (select custom_domain_id from create_share(
     pg_temp.doc('pro'), 'Default host', true, false, null, null, null, null)),
  pg_temp.domain('decks.acme.com'),
  'E1 an ordinary create_share call issues on the account''s domain — no caller changes anywhere');

select pg_temp.expect_eq(
  (select custom_domain_id from create_share(
     pg_temp.doc('pro'), 'HTMLRadar host', true, false, null, null, null, null,
     null, null, true)),
  null::uuid,
  'E2 …and the per-share HTMLRadar choice still gets the apex');

select pg_temp.expect_eq(
  (select custom_domain_id from create_share(
     pg_temp.doc('pro'), 'Explicit host', true, false, null, null, null, null,
     null, pg_temp.domain('decks.acme.com'))),
  pg_temp.domain('decks.acme.com'),
  'E3 an explicit domain id is honoured');

-- An explicit choice that is not the caller's meets the trigger, which is
-- what the public API turns into a 422. An IMPLIED choice never can, because
-- the default is validated when it is set.
select pg_temp.expect_error(
  format('select create_share(%L, ''Someone else''''s'', true, false, null, null, null, null, null, %L)',
         pg_temp.doc('pro'), pg_temp.domain('decks.other-co.com')),
  'P0052', 'E4 an explicit domain id belonging to someone else is refused');

reset role;

-- The stale default. There is NO silent fallback: a customer who asked for
-- their own domain and got htmlradar.page instead would e-mail a buyer a link
-- that is not what they believe it is, and nothing anywhere would say so. The
-- refusal is the kindness.
update custom_domains set state = 'disconnected' where hostname = 'decks.acme.com';

set local role authenticated;
select pg_temp.expect_error(
  format('select create_share(%L, ''Stale default'', true, false, null, null, null, null)',
         pg_temp.doc('pro')),
  'P0053', 'E5 a default that stopped serving refuses the link rather than quietly moving it to htmlradar.page');

-- …and naming it explicitly is refused too, which is what the API turns into
-- its 422.
select pg_temp.expect_error(
  format('select create_share(%L, ''Stale explicit'', true, false, null, null, null, null, null, %L)',
         pg_temp.doc('pro'), pg_temp.domain('decks.acme.com')),
  'P0053', 'E6 …and so is naming it explicitly');

-- The way out is one argument, which is why refusing is affordable.
select pg_temp.expect_eq(
  (select custom_domain_id from create_share(
     pg_temp.doc('pro'), 'Stale but urgent', true, false, null, null, null, null,
     null, null, true)),
  null::uuid,
  'E6b …while the HTMLRadar address is still one argument away');

reset role;
update custom_domains set state = 'live' where hostname = 'decks.acme.com';
select set_config('request.jwt.claim.sub', '', true);

-- create_share_as is the public API's path: same choice, same rules, no
-- Supabase session.
set local role service_role;
select pg_temp.expect_eq(
  (select custom_domain_id from create_share_as(
     pg_temp.uid('pro'), pg_temp.doc('pro'), 'API default', true, false,
     null, null, null, null)),
  pg_temp.domain('decks.acme.com'),
  'E7 create_share_as issues on the account''s domain too');

select pg_temp.expect_eq(
  (select custom_domain_id from create_share_as(
     pg_temp.uid('pro'), pg_temp.doc('pro'), 'API apex', true, false,
     null, null, null, null, null, null, true)),
  null::uuid,
  'E8 …and passes the HTMLRadar choice through');
reset role;

-- ------------------------------------------------------------
-- Section F — the default on the profile, and the downgrade drill
--
-- The rule is a state rule, not a transition test: a profile that is not Pro
-- and not comped holds no default. A transition test has to be right about
-- every writer; a state rule cannot be stale. It is also why neither
-- `expirePro` in the monitor nor the Polar webhook needs a code change.
-- ------------------------------------------------------------
select pg_temp.expect_error(
  format('update profiles set default_custom_domain_id = %L where id = %L',
         pg_temp.domain('decks.other-co.com'), pg_temp.uid('pro')),
  'P0055', 'F1 a default has to be a domain of that same account');

select pg_temp.expect_error(
  format('update profiles set default_custom_domain_id = %L where id = %L',
         pg_temp.domain('pending.pro3.com'), pg_temp.uid('pro3')),
  'P0055', 'F2 …and it has to be live');

-- The regression that costs money. A customer's domain goes disconnected at
-- three in the morning; nobody writes to their profile until Polar renews
-- them at the end of the month and sets tier = 'pro'. If the default were
-- re-validated on every write, that write would fail, the webhook would fail,
-- Polar would retry, and a paying customer would sit on the free tier because
-- their DNS was down. The default is validated when it is SET and not
-- afterwards; what it is worth at serving time is decided at serving time.
update custom_domains set state = 'disconnected' where hostname = 'decks.acme.com';

select pg_temp.expect_ok(
  format('update profiles set tier = ''pro'', pro_until = now() + interval ''30 days'' where id = %L',
         pg_temp.uid('pro')),
  'F2b a renewal succeeds while the account''s default domain is disconnected');

select pg_temp.expect_eq(
  (select default_custom_domain_id is not null from profiles where id = pg_temp.uid('pro')),
  true,
  'F2c …and the default is left exactly where it was');

-- Setting it afresh while it is disconnected is a different question, and
-- that one is refused: admission is checked, standing is not.
select pg_temp.expect_error(
  format('update profiles set default_custom_domain_id = %L where id = %L',
         pg_temp.domain('decks.acme.com'), pg_temp.uid('pro2')),
  'P0055', 'F2d …while adopting a disconnected domain as a default is still refused');

update custom_domains set state = 'live' where hostname = 'decks.acme.com';

-- The drill (PRD M5): flip the tier, confirm issued links still serve and new
-- branded links stop.
select pg_temp.expect_ok(
  format('update profiles set tier = ''free'' where id = %L', pg_temp.uid('pro')),
  'F3 a downgrade is allowed to happen');

select pg_temp.expect_eq(
  (select default_custom_domain_id from profiles where id = pg_temp.uid('pro')),
  null::uuid,
  'F4 …and clears the default by itself, with no monitor or webhook change');

select pg_temp.expect_eq(
  (select count(*)::int from document_shares
    where slug = 'cd-own-domain-1' and custom_domain_id is not null),
  1,
  'F5 the link already sent still carries its domain — we never stop serving what was sent');

select pg_temp.expect_eq(
  (select state from custom_domains where hostname = 'decks.acme.com'),
  'live',
  'F6 …and the domain itself is untouched by the downgrade');

-- The lapsed account that tries again. pro2 is used rather than pro because
-- pro is already over the free-tier link cap, and 027's trigger sorts first
-- on purpose (033's reasoning): a free customer over their cap is told about
-- the cap, which is the thing they can act on. Both refusals are correct; this
-- one is the refusal about domains.
update profiles set tier = 'free' where id = pg_temp.uid('pro2');

set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', pg_temp.uid('pro2')::text, true); end $$;

select pg_temp.expect_error(
  format('insert into document_shares (document_id, owner_id, slug, custom_domain_id) values (%L, %L, ''cd-lapsed-1'', %L)',
         pg_temp.doc('pro2'), pg_temp.uid('pro2'), pg_temp.domain('decks.other-co.com')),
  'P0047', 'F7 but a lapsed account cannot create a NEW branded link');

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Disconnecting and monitoring are UPDATEs, and they must keep working for an
-- account that is no longer paying: otherwise a lapsed customer cannot turn
-- off a hostname they own.
select pg_temp.expect_ok(
  'update custom_domains set last_checked_at = now(), consecutive_failures = 1, last_error = ''probe failed'' where hostname = ''decks.acme.com''',
  'F8 the monitor can still check a lapsed account''s domain');

select pg_temp.expect_ok(
  'update custom_domains set state = ''retired'' where hostname = ''decks.acme.com''',
  'F9 …and a lapsed account can still disconnect it');

-- A comped account keeps its default, because comped is the exemption (032).
update custom_domains set state = 'retired'
 where owner_id = pg_temp.uid('pro3') and retired_at is null;
insert into custom_domains (owner_id, hostname, state, verified_at)
values (pg_temp.uid('pro3'), 'live.pro3.com', 'live', now());
update profiles set default_custom_domain_id = (select id from custom_domains where hostname = 'live.pro3.com')
 where id = pg_temp.uid('pro3');

select pg_temp.expect_ok(
  format('update profiles set tier = ''free'', comped = true where id = %L', pg_temp.uid('pro3')),
  'F10 an internal account is moved off the pro tier');

select pg_temp.expect_eq(
  (select default_custom_domain_id is not null from profiles where id = pg_temp.uid('pro3')),
  true,
  'F11 …and keeps its default, because comped is the exemption');

-- ------------------------------------------------------------
-- Section G — share_lookup, the worker's one read
--
-- The worker must decide "is this hostname allowed to serve this share RIGHT
-- NOW" without a second query and without a cache, which is Astra's B1
-- finding: a cached "live" survives retirement.
-- ------------------------------------------------------------
set local role service_role;

select pg_temp.expect_eq(
  (select custom_domain_hostname from share_lookup where slug = 'cd-own-domain-1'),
  'decks.acme.com',
  'G1 the share''s hostname is readable in the one lookup');

select pg_temp.expect_eq(
  (select custom_domain_state from share_lookup where slug = 'cd-own-domain-1'),
  'retired',
  'G2 …and so is the domain''s CURRENT state, which F9 just retired under it');

select pg_temp.expect_eq(
  (select custom_domain_owner_id from share_lookup where slug = 'cd-own-domain-1'),
  pg_temp.uid('pro'),
  'G3 …and its owner, so the worker can refuse a share whose domain changed hands');

select pg_temp.expect_eq(
  (select custom_domain_id is null and custom_domain_hostname is null
     from share_lookup where slug = 'cd-apex-1'),
  true,
  'G4 an apex share reads as no domain at all, not as a missing row');

select pg_temp.expect_eq(
  (select count(*)::int from share_lookup where slug = 'cd-apex-1'),
  1,
  'G5 …and the left join did not drop it');

reset role;

-- ------------------------------------------------------------
-- Section H — the abuse e-mail names the host the report came in on
--
-- 037 hard-coded https://htmlradar.page/r/<slug>. On a custom-domain share
-- that address is a 404, and the one workflow where minutes matter would
-- start by looking at nothing.
--
-- The body is only built when Resend is configured, so the fixture configures
-- it: a secret by whichever route this database offers, and a stand-in
-- net.http_post that keeps the message instead of sending it. Both are undone
-- by the ROLLBACK at the end.
-- ------------------------------------------------------------
create table mail_capture (subject text, body text);

do $$
begin
  begin
    perform vault.create_secret('re_scratch_key', 'resend_api_key');
    perform vault.create_secret('abuse-test@example.test', 'resend_from');
  exception when others then
    -- A scratch database with the simple stand-in table 044's header gives.
    insert into vault.decrypted_secrets (name, decrypted_secret)
    values ('resend_api_key', 're_scratch_key'), ('resend_from', 'abuse-test@example.test');
  end;
end $$;

create or replace function net.http_post(
  url                   text,
  body                  jsonb default null,
  params                jsonb default '{}'::jsonb,
  headers               jsonb default '{}'::jsonb,
  timeout_milliseconds  integer default 5000
) returns bigint language plpgsql as $$
begin
  insert into public.mail_capture (subject, body) values (body ->> 'subject', body ->> 'text');
  return 1::bigint;
end;
$$;

set local role service_role;

select pg_temp.expect_eq(
  (report_abuse('cd-own-domain-1', 'phishing', null, 'cd-hash-1') ->> 'ok')::boolean,
  true,
  'H1 a report on a custom-domain share is accepted');

select pg_temp.expect_eq(
  (select body like '%Link: https://decks.acme.com/r/cd-own-domain-1%' from mail_capture limit 1),
  true,
  'H2 …and the e-mail names the customer domain the share stored, not htmlradar.page');

select pg_temp.expect_eq(
  (report_abuse('cd-apex-1', 'phishing', null, 'cd-hash-2') ->> 'ok')::boolean,
  true,
  'H3 a report on an apex share is accepted');

select pg_temp.expect_eq(
  (select body like '%Link: https://htmlradar.page/r/cd-apex-1%'
     from mail_capture where body like '%cd-apex-1%'),
  true,
  'H4 …and that one still names the apex');

reset role;

set local role service_role;
select pg_temp.expect_eq(
  (report_abuse('cd-handle-1', 'phishing', null, 'cd-hash-3') ->> 'ok')::boolean,
  true,
  'H5 a report on a handle share is accepted');

select pg_temp.expect_eq(
  (select body like '%Link: https://acme-links.htmlradar.page/r/cd-handle-1%'
     from mail_capture where body like '%cd-handle-1%'),
  true,
  'H6 …and names {handle}.htmlradar.page');
reset role;

rollback;
