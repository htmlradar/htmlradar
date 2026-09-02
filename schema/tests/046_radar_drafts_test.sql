-- 046_radar_drafts_test.sql
-- ------------------------------------------------------------
-- Tests for 046_radar_drafts.sql — the invariants that belong to the database
-- rather than to the worker.
--
--   A. The status check refuses anything outside the seven states. The whole
--      one-tap flow is a state machine over this column; a typo'd status would
--      leave a draft no handler ever picks up again.
--   B. `posted` and `skipped` are terminal, enforced by a trigger. This is the
--      race Sol's review found: Skip and edit rewrote status unconditionally,
--      so a Skip arriving mid-post could unclaim a draft that Reddit was
--      already being asked about. Everything else stays mutable, because
--      `failed` and `reconcile` are explicitly retryable and filling in a
--      permalink on a posted row is not a status change.
--   C. The reservation ledger: one row per thread, append-only, with the
--      owning draft allowed to retry and nobody else allowed in. This is what
--      replaced the partial unique index on status='posted', which the failure
--      path RELEASED — so a comment Reddit accepted but never acknowledged
--      left the thread open to be commented on a second time.
--   D. Two nonces are never alike. A nonce is a bearer credential for speaking
--      as the founder; two rows sharing one would make a tap ambiguous.
--   E. Nothing customer-facing can read or write either table, or call the
--      function that writes.
--
-- WHAT IS NOT TESTED HERE: concurrency. A psql file inside one transaction has
-- exactly one session, and the cap's atomicity is a claim about several. That
-- is 046_radar_drafts_concurrency_test.sh, which launches ten simultaneous
-- psql processes against the same throwaway database; run both. The Reddit and
-- Telegram halves live in packages/monitor/tests/reddit-onetap.test.ts.
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
--                               create role service_role bypassrls;
--                               alter default privileges in schema public
--                                 grant all on tables to service_role;
--                               alter default privileges in schema public
--                                 grant execute on functions to service_role"
--   psql -v ON_ERROR_STOP=1 -f schema/046_radar_drafts.sql
--   psql -v ON_ERROR_STOP=1 -f schema/tests/046_radar_drafts_test.sql
--
-- 046 stands alone: it creates its own tables and depends on no earlier file,
-- so unlike 037's test this one does not need the 001/002/003 stack first. The
-- default-privileges lines above are not decoration: Supabase grants the
-- service role every new public table and function that way, and a stock
-- Postgres without them would fail section E for a reason that does not exist
-- on the real database.
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
-- Section A — the status check and the defaults
-- ------------------------------------------------------------
insert into radar_drafts (source_url, thing_id, draft_text, nonce)
values ('https://www.reddit.com/r/sales/comments/aaa111/x/', 't3_aaa111', 'a draft', 'nonce-a1');

select pg_temp.expect_eq(
  (select status from radar_drafts where thing_id = 't3_aaa111'),
  'pending',
  'A1 a new draft starts pending');

select pg_temp.expect_eq(
  (select version from radar_drafts where thing_id = 't3_aaa111'),
  1,
  'A2 a new draft starts at version 1');

-- A button that nobody taps stops being tappable. The default is three days
-- out, which is what the worker's expiry filter is comparing against.
select pg_temp.expect_eq(
  (select expires_at > now() + interval '71 hours'
     from radar_drafts where thing_id = 't3_aaa111'),
  true,
  'A3 a new draft expires about 72 hours out');

select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text, status)
     values (''https://www.reddit.com/r/sales/comments/aaa222/x/'', ''t3_aaa222'', ''d'', ''queued'')',
  '23514',
  'A4 the status check refuses a state no handler knows');

insert into radar_drafts (source_url, thing_id, draft_text, status, nonce) values
  ('https://www.reddit.com/r/sales/comments/aaa333/x/', 't3_aaa333', 'd', 'edited',    'nonce-a3'),
  ('https://www.reddit.com/r/sales/comments/aaa444/x/', 't3_aaa444', 'd', 'posting',   'nonce-a4'),
  ('https://www.reddit.com/r/sales/comments/aaa555/x/', 't3_aaa555', 'd', 'failed',    'nonce-a5'),
  ('https://www.reddit.com/r/sales/comments/aaa666/x/', 't3_aaa666', 'd', 'reconcile', 'nonce-a6');

select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts),
  5,
  'A5 pending, edited, posting, failed and reconcile are all accepted');

-- ------------------------------------------------------------
-- Section B — posted and skipped are one-way doors
--
-- B1 and B2 are the concurrent-Skip race: a Skip arriving while a post is in
-- flight must not be able to move the row back out of a settled state. B3 is
-- the other half — everything that is NOT terminal stays freely retryable, or
-- a draft whose outcome is unknown could never be finished.
-- ------------------------------------------------------------
update radar_drafts set status = 'posted',
                        permalink = 'https://www.reddit.com/r/sales/comments/aaa444/x/c1/',
                        posted_at = now()
 where thing_id = 't3_aaa444';

select pg_temp.expect_error(
  'update radar_drafts set status = ''pending'' where thing_id = ''t3_aaa444''',
  '23514',
  'B1 a posted draft cannot be moved back to pending');

update radar_drafts set status = 'skipped' where thing_id = 't3_aaa333';
select pg_temp.expect_error(
  'update radar_drafts set status = ''posting'' where thing_id = ''t3_aaa333''',
  '23514',
  'B2 a skipped draft cannot be re-armed for posting');

-- Filling in the permalink on a posted row is not a status change, and the
-- retryable states stay retryable.
update radar_drafts set permalink = 'https://www.reddit.com/x' where thing_id = 't3_aaa444';
update radar_drafts set status = 'pending' where thing_id = 't3_aaa555';
update radar_drafts set status = 'posting' where thing_id = 't3_aaa666';
select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts where status in ('pending', 'posting')),
  3,
  'B3 failed and reconcile stay retryable, and a posted row still takes a permalink');

-- ------------------------------------------------------------
-- Section C — the reservation ledger
--
-- One row per thread, written before the Reddit request goes out and never
-- removed. C3 is the case the old partial index got wrong: a draft whose post
-- failed must NOT release the thread, because Reddit may have taken the
-- comment anyway.
-- ------------------------------------------------------------
-- The window is rolling, and it is measured from the row's own timestamp. Three
-- reservations from yesterday must not spend today's allowance. (now() is
-- frozen for the whole of this transaction, so an aged row has to be inserted
-- with an explicit past timestamp — a smaller window would prove nothing.)
insert into radar_post_reservations (thing_id, draft_id, created_at) values
  ('t3_old1', gen_random_uuid(), now() - interval '25 hours'),
  ('t3_old2', gen_random_uuid(), now() - interval '30 hours'),
  ('t3_old3', gen_random_uuid(), now() - interval '48 hours');

select pg_temp.expect_eq(
  reserve_radar_post(gen_random_uuid(), 't3_window', 3),
  'ok',
  'C1 reservations older than the window do not count against the cap');

select pg_temp.expect_eq(
  reserve_radar_post('11111111-1111-1111-1111-111111111111'::uuid, 't3_res1'),
  'ok',
  'C2 the first caller reserves the thread');

select pg_temp.expect_eq(
  reserve_radar_post('22222222-2222-2222-2222-222222222222'::uuid, 't3_res1'),
  'thread_taken',
  'C3 a different draft is refused the same thread');

select pg_temp.expect_eq(
  reserve_radar_post('11111111-1111-1111-1111-111111111111'::uuid, 't3_res1'),
  'ok',
  'C4 the owning draft may retry its own thread after reconciliation');

select pg_temp.expect_error(
  'delete from radar_post_reservations where thing_id = ''t3_res1''',
  '23514',
  'C5 a reservation cannot be deleted, so a failure never reopens a thread');

select pg_temp.expect_error(
  'update radar_post_reservations set draft_id = gen_random_uuid()',
  '23514',
  'C6 a reservation cannot be rewritten either');

-- The cap counts reservations, not successes: a request we are unsure about
-- still spends one of the five. Three more takes the fresh ones to five
-- ('t3_window' and 't3_res1' are already inside the window).
select reserve_radar_post(gen_random_uuid(), 't3_res2');
select reserve_radar_post(gen_random_uuid(), 't3_res3');
select reserve_radar_post(gen_random_uuid(), 't3_res4');

select pg_temp.expect_eq(
  (select count(*)::int from radar_post_reservations
    where created_at > now() - interval '24 hours'),
  5,
  'C7 five reservations now sit inside the window');

select pg_temp.expect_eq(
  reserve_radar_post(gen_random_uuid(), 't3_res6'),
  'cap_reached',
  'C8 the sixth thread in the window is refused');

-- ------------------------------------------------------------
-- Section D — one live token at a time
-- ------------------------------------------------------------
select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text, nonce)
     values (''https://www.reddit.com/r/sales/comments/ddd111/x/'', ''t3_ddd111'', ''d'', ''nonce-a1'')',
  '23505',
  'D1 two drafts cannot share a callback token');

-- Spent tokens are cleared to null when a draft is re-offered, and null is not
-- a value the unique index constrains, so many settled drafts coexist.
insert into radar_drafts (source_url, thing_id, draft_text, nonce) values
  ('https://www.reddit.com/r/sales/comments/ddd222/x/', 't3_ddd222', 'd', null),
  ('https://www.reddit.com/r/sales/comments/ddd333/x/', 't3_ddd333', 'd', null);
select pg_temp.expect_eq(
  (select count(*)::int from radar_drafts where nonce is null),
  2,
  'D2 drafts with no live token are not constrained against each other');

-- ------------------------------------------------------------
-- Section E — deny all
--
-- RLS on with no policies, plus the revokes. A customer role sees nothing,
-- writes nothing, and cannot call the function that writes. The service role,
-- which is what the monitor worker holds, does all three.
-- ------------------------------------------------------------
select pg_temp.expect_eq(
  (select bool_and(relrowsecurity) from pg_class
    where relname in ('radar_drafts', 'radar_post_reservations')),
  true,
  'E1 row level security is enabled on both tables');

select pg_temp.expect_eq(
  (select count(*)::int from pg_policies
    where tablename in ('radar_drafts', 'radar_post_reservations')),
  0,
  'E2 there are no policies, so RLS denies every customer role');

set local role anon;
select pg_temp.expect_error(
  'select count(*) from radar_drafts', '42501',
  'E3 anon cannot read the drafts');
reset role;

set local role authenticated;
select pg_temp.expect_error(
  'insert into radar_drafts (source_url, thing_id, draft_text)
     values (''https://www.reddit.com/r/x/comments/eee111/x/'', ''t3_eee111'', ''mine now'')',
  '42501',
  'E4 a signed-in customer cannot write a draft');
select pg_temp.expect_error(
  'select count(*) from radar_post_reservations', '42501',
  'E5 a signed-in customer cannot read the reservation ledger');
select pg_temp.expect_error(
  'select reserve_radar_post(gen_random_uuid(), ''t3_eee222'')', '42501',
  'E6 a signed-in customer cannot call the function that reserves');
reset role;

set local role service_role;
select pg_temp.expect_eq(
  (select count(*)::int > 0 from radar_drafts),
  true,
  'E7 the service role, which is what the worker runs as, can read them');
reset role;

rollback;
