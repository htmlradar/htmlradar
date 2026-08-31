-- 037_abuse_reports_test.sql
-- ------------------------------------------------------------
-- Tests for 037_abuse_reports.sql. Four things are worth testing here:
--
--   1. report_abuse writes what it was told and nothing else: the share the
--      slug resolves to, one of the four reasons, a note no longer than five
--      hundred characters, and the hash the proxy computed. A report path
--      that silently dropped reports would be worse than none, because the
--      gate link would promise something we never received.
--   2. The rate limit fires at the sixth report in the hour and the refusal
--      is a distinguishable answer, not an exception — the proxy has a page
--      for it.
--   3. The email fires once per share per six hours however many reports
--      arrive, and the window is measured from the last report we emailed
--      about rather than the last report, so a page reported every ten
--      minutes is still reported to us again six hours later.
--   4. Nothing customer-facing can reach the table or the function. The table
--      holds a stranger's report about a customer's document; a sender who
--      could read it could work out who reported them.
--
-- WHAT IS NOT TESTED HERE: the Resend send itself. With no Vault secrets on a
-- scratch database the function takes its `skipped` branch, which is the same
-- branch a misconfigured instance takes, and that branch stamps the throttle
-- the same way — so the dedup is fully exercised without pg_net ever running.
--
-- RUN THIS AGAINST A SCRATCH DATABASE ONLY. It creates auth.users, profiles,
-- documents, shares, abuse_reports, rate_limits and notifications_log rows.
-- Everything sits inside one transaction that ROLLBACKs at the end, so
-- nothing is left behind — but a rollback does not undo a mistake made
-- against production, so point psql at a scratch copy.
--
--   psql -v ON_ERROR_STOP=1 -f schema/001_init.sql   (…then 002, 003, 008,
--                                                     027, 033, 035, 037)
--   psql -v ON_ERROR_STOP=1 -f schema/tests/037_abuse_reports_test.sql
--
-- A throwaway Postgres in Docker is the scratch database this was written
-- against, exactly as 034's and 035's test files document:
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
-- Helpers (same shape as 034's and 035's)
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

-- ------------------------------------------------------------
-- Fixtures — one owner, one document, one live share to report.
-- ------------------------------------------------------------
create temporary table t_ids (k text primary key, v uuid);
grant select on t_ids to public;

insert into auth.users (id, email) values (gen_random_uuid(), 'abuse-owner@example.test');
insert into t_ids select 'owner', id from auth.users where email = 'abuse-owner@example.test';

-- Pro only so the fixture can choose readable slugs: 033's trigger refuses a
-- chosen link ending on a free account, and the tests below are about reports,
-- not about who may pick an address.
update profiles set tier = 'pro' where id = (select v from t_ids where k = 'owner');

insert into documents (id, owner_id, title, source_type, source_url)
select gen_random_uuid(), v, 'Invoice deck', 'url', 'https://example.test/deck.html'
from t_ids where k = 'owner';
insert into t_ids select 'doc', id from documents where title = 'Invoice deck';

insert into document_shares (id, document_id, owner_id, slug)
select gen_random_uuid(),
       (select v from t_ids where k = 'doc'),
       (select v from t_ids where k = 'owner'),
       'reported-deck-abc123';
insert into t_ids select 'share', id from document_shares where slug = 'reported-deck-abc123';

-- ------------------------------------------------------------
-- Section A — a report is written
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (report_abuse('reported-deck-abc123', 'phishing', 'Looks like a bank login', 'hash-a') ->> 'ok')::boolean,
  true,
  'A1 a valid report succeeds');

select pg_temp.expect_eq(
  (select count(*)::int from abuse_reports where share_id = (select v from t_ids where k = 'share')),
  1,
  'A2 exactly one row was written');

select pg_temp.expect_eq(
  (select reason from abuse_reports limit 1), 'phishing',
  'A3 the reason is stored');
select pg_temp.expect_eq(
  (select note from abuse_reports limit 1), 'Looks like a bank login',
  'A4 the note is stored');
select pg_temp.expect_eq(
  (select reporter_ip_hash from abuse_reports limit 1), 'hash-a',
  'A5 the hash the proxy computed is stored, and it is all we hold of the reporter');

-- The slug is what the reporter's browser had; the share id is what the
-- operator needs. Resolving it in the function is the whole reason the proxy
-- does not have to.
select pg_temp.expect_eq(
  (select share_id from abuse_reports limit 1),
  (select v from t_ids where k = 'share'),
  'A6 the slug resolved to the right share');

-- A made-up slug is refused, and refused without saying whether it exists.
select pg_temp.expect_eq(
  report_abuse('no-such-slug-xyz', 'other', null, 'hash-a') ->> 'error', 'no_share',
  'A7 an unknown slug is refused');

-- A reason outside the four is refused before anything is counted or written.
select pg_temp.expect_eq(
  report_abuse('reported-deck-abc123', 'i-do-not-like-it', null, 'hash-a') ->> 'error', 'bad_reason',
  'A8 an unknown reason is refused');
select pg_temp.expect_eq(
  (select count(*)::int from abuse_reports), 1,
  'A9 the refused report wrote nothing');

-- An empty note is no note, so the operator's email says "(none)" rather than
-- showing an empty quote block.
select report_abuse('reported-deck-abc123', 'malware', '   ', 'hash-a');
select pg_temp.expect_eq(
  (select note from abuse_reports where reason = 'malware'), null,
  'A10 a blank note is stored as no note');

-- Five hundred characters is the cap the form advertises. The function caps
-- too, because the form is not the only thing that can call it.
select report_abuse('reported-deck-abc123', 'personal_data', repeat('x', 900), 'hash-a');
select pg_temp.expect_eq(
  (select char_length(note) from abuse_reports where reason = 'personal_data'), 500,
  'A11 an over-long note is cut to 500 characters, not rejected');

-- ------------------------------------------------------------
-- Section B — five an hour, then refused
--
-- Three reports have been written above on 'hash-a' (A1, A10, A11) plus two
-- refusals that were counted (A7's unknown slug, which is counted on purpose,
-- and… not A8, which is refused before the counter). So two more succeed and
-- the sixth call is the one that is refused.
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (report_abuse('reported-deck-abc123', 'other', 'fifth', 'hash-a') ->> 'ok')::boolean, true,
  'B1 the fifth report in the hour is accepted');
select pg_temp.expect_eq(
  report_abuse('reported-deck-abc123', 'other', 'sixth', 'hash-a') ->> 'error', 'rate_limited',
  'B2 the sixth is refused');
select pg_temp.expect_eq(
  (select count(*)::int from abuse_reports where note = 'sixth'), 0,
  'B3 the refused report wrote no row');

-- Another reporter has their own budget: one address flooding must not stop
-- everyone else reporting the same page.
select pg_temp.expect_eq(
  (report_abuse('reported-deck-abc123', 'phishing', 'from someone else', 'hash-b') ->> 'ok')::boolean,
  true,
  'B4 a different address hash is a different budget');

-- An hour later the budget is back. Backdating the counter row is how "an
-- hour later" is written without waiting an hour.
update rate_limits set window_at = now() - interval '2 hours' where key = 'abuse_report:hash-a';
select pg_temp.expect_eq(
  (report_abuse('reported-deck-abc123', 'other', 'next hour', 'hash-a') ->> 'ok')::boolean, true,
  'B5 the next hour starts a fresh budget');

-- ------------------------------------------------------------
-- Section C — one email per share per six hours
--
-- With no Vault secrets here, every send takes the `skipped` branch, which
-- logs one notifications_log row and stamps notified_at exactly as the real
-- send does. Counting those rows counts the emails.
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (select count(*)::int from notifications_log where email_to = 'abuse@htmlradar.com'),
  1,
  'C1 seven reports on one share produced one email');

select pg_temp.expect_eq(
  (select count(*)::int from abuse_reports where notified_at is not null),
  1,
  'C2 exactly one report carries the stamp that caused it');

select pg_temp.expect_eq(
  (select status from notifications_log where email_to = 'abuse@htmlradar.com'),
  'skipped',
  'C3 an instance with no Resend configuration logs the miss instead of failing');

-- Six hours on, the next report emails again. Measured from the report we
-- emailed about, not from the last report to arrive — otherwise a page
-- reported every ten minutes would go quiet forever after the first email.
update abuse_reports set notified_at = now() - interval '7 hours' where notified_at is not null;
select report_abuse('reported-deck-abc123', 'phishing', 'still up', 'hash-c');
select pg_temp.expect_eq(
  (select count(*)::int from notifications_log where email_to = 'abuse@htmlradar.com'),
  2,
  'C4 six hours later the same share emails again');

-- A different share is a different conversation and is never throttled by
-- another share's window.
insert into document_shares (id, document_id, owner_id, slug)
select gen_random_uuid(),
       (select v from t_ids where k = 'doc'),
       (select v from t_ids where k = 'owner'),
       'second-deck-def456';
select report_abuse('second-deck-def456', 'phishing', 'another page', 'hash-d');
select pg_temp.expect_eq(
  (select count(*)::int from notifications_log where email_to = 'abuse@htmlradar.com'),
  3,
  'C5 a report on another share is not throttled by the first share');

-- ------------------------------------------------------------
-- Section D — the table and the function are ours alone
--
-- The whole security argument: the rate-limit identity is an argument to the
-- function, so a caller who can choose it can choose to have no limit. The
-- proxy computes the hash and calls this with the service role; nobody else
-- calls it at all.
-- ------------------------------------------------------------
set local role anon;
select pg_temp.expect_error(
  'select report_abuse(''reported-deck-abc123'', ''other'', null, ''forged'')',
  '42501',
  'D1 anon cannot call report_abuse');
select pg_temp.expect_error(
  'select count(*) from abuse_reports', '42501',
  'D2 anon cannot read the reports');
select pg_temp.expect_error(
  'insert into abuse_reports (share_id, reason) values (gen_random_uuid(), ''other'')',
  '42501',
  'D3 anon cannot write a report directly');
reset role;

set local role authenticated;
select pg_temp.expect_error(
  'select report_abuse(''reported-deck-abc123'', ''other'', null, ''forged'')',
  '42501',
  'D4 a signed-in customer cannot call report_abuse');
-- A document owner cannot read reports about their own shares either. RLS is
-- on with no policies, so there is no row any customer role can see.
select pg_temp.expect_error(
  'select count(*) from abuse_reports', '42501',
  'D5 a signed-in customer cannot read the reports about their own document');
reset role;

set local role service_role;
select pg_temp.expect_eq(
  (report_abuse('reported-deck-abc123', 'other', 'from the proxy', 'hash-e') ->> 'ok')::boolean,
  true,
  'D6 the service role, which is what the proxy runs as, can call it');
reset role;

-- ------------------------------------------------------------
-- Section E — the constraint holds when the function is not the writer
--
-- The check on `reason` and the length check on `note` are the last line: a
-- future caller that skipped the function still cannot write a report with a
-- reason nothing triages or a note nothing displays.
-- ------------------------------------------------------------
select pg_temp.expect_error(
  format('insert into abuse_reports (share_id, reason) values (%L, ''nonsense'')',
         (select v from t_ids where k = 'share')),
  '23514',
  'E1 the reason check refuses a reason outside the four');
select pg_temp.expect_error(
  format('insert into abuse_reports (share_id, reason, note) values (%L, ''other'', repeat(''x'', 501))',
         (select v from t_ids where k = 'share')),
  '23514',
  'E2 the length check refuses a note over 500 characters');

rollback;
