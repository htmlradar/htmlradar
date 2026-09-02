-- 047_radar_drafts.sql
-- ------------------------------------------------------------
-- One row per drafted reply the founder can post with a tap, plus the
-- reservation table that makes "one comment per thread, five a day" true
-- rather than merely likely.
--
-- WHY THIS EXISTS
--
-- Until now the daily digest wrote a draft into a Telegram message and the
-- story ended there: the founder copied the text, opened Reddit, found the
-- thread, and pasted. Two minutes a day, and every one of those two minutes
-- was a chance to not bother.
--
-- The one-tap path removes the copying, not the founder. A draft arrives as
-- its own Telegram message with two buttons. "Post as me" posts that exact
-- text from HIS Reddit account; "Skip" closes it. Nothing posts without the
-- tap — the SOP rule that only the founder speaks in public is unchanged, the
-- tap IS the speaking.
--
-- A button needs somewhere to point. Telegram hands a callback back with at
-- most 64 bytes of our own data in it, which is enough for a one-time token
-- and nothing else, so the draft text, the thread it belongs to, and what has
-- happened to it have to live in a row. That row is radar_drafts.
--
-- WHAT SOL'S REVIEW CHANGED (3 Sep 2026)
--
-- The first cut of this file trusted a status column and a partial unique
-- index to hold the safety rails. Three of the rails leaked:
--
--   * A tap carried only a draft id, so a stale button, a replayed callback,
--     or a forged one all looked identical to a fresh tap. Hence `nonce`,
--     `version` and `expires_at` below: an approval is bound to ONE message,
--     ONE version of the text, ONE token, and a finite lifetime.
--   * Skip and edit rewrote `status` unconditionally, so a concurrent Skip
--     could unclaim a draft mid-post. Hence the terminal-state trigger:
--     `posted` and `skipped` are one-way doors, enforced by the database
--     rather than by whichever code path got there first.
--   * The per-thread guard was `status='posted'`, which the failure path
--     RELEASED — so a comment Reddit accepted but never acknowledged left the
--     thread open for a second comment. Hence radar_post_reservations: an
--     append-only row written BEFORE the Reddit request is sent and never
--     removed, so "we may already have spoken here" survives any outcome.
--     The daily cap counts those reservations, inside the same function and
--     the same lock, so two taps cannot both see four and both proceed.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No foreign key from radar_drafts to radar_items. The draft quotes a public
-- thread by URL and must outlive whatever pruning ever happens to the insight
-- base. No retry counter: a post either happened, definitely did not, or is
-- ambiguous, and the third case has its own status and its own reconciliation
-- rather than a number that gets decremented. No Reddit credentials — the
-- refresh token is a Worker secret and never touches a row.
--
-- RLS is deny-all on both tables, the same posture as radar_items (042) and
-- telegram_outbox (038): these are internal operational rows written by the
-- monitor worker with the service role, and no customer-facing role has any
-- business here.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent, in the
-- narrow sense that re-running this exact file changes nothing — it will not
-- repair a radar_drafts table that already exists in some other shape.
-- ------------------------------------------------------------

create table if not exists public.radar_drafts (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- The public thread this reply answers. Not unique: a thread can be drafted
  -- for twice and skipped once. Posting is deduplicated by the reservation
  -- table below, not here.
  source_url           text not null,
  -- 't3_' + the thread's base-36 id, parsed out of source_url. The parent
  -- POST /api/comment is given.
  thing_id             text not null,
  -- 'sales', 'startups', ... — carried so a row reads without parsing a URL.
  subreddit            text,
  -- Exactly what gets posted, replaced in place when the founder sends an
  -- edited version back.
  draft_text           text not null,
  -- Bumped every time the text changes or the draft is offered again. An
  -- approval names the version it approved, so a tap can never post text the
  -- tapped message did not show.
  version              int not null default 1,
  -- pending    — offered, waiting for a tap
  -- edited     — the founder replied with new text; waiting for a tap on THAT
  -- posting    — a tap won the claim; the Reddit request is in flight
  -- posted     — the comment exists on Reddit, permalink below. TERMINAL.
  -- skipped    — the founder said no. TERMINAL.
  -- failed     — Reddit definitely received the request and refused it
  -- reconcile  — the request may have been received and we do not know;
  --              nothing may be retried until a reconciliation check answers
  status               text not null default 'pending'
                         check (status in ('pending', 'edited', 'posting', 'posted',
                                           'skipped', 'failed', 'reconcile')),
  -- The one-time token the current message's buttons carry. Rotated every
  -- time the draft is offered again, so yesterday's button is inert.
  nonce                text,
  -- Stamped the moment a tap consumes the token. A second delivery of the
  -- same callback finds it non-null and does nothing.
  nonce_used_at        timestamptz,
  -- A button that nobody ever tapped stops being tappable. 72 hours: long
  -- enough for a weekend, short enough that a leaked callback goes stale.
  expires_at           timestamptz not null default now() + interval '72 hours',
  -- Absolute URL of the posted comment. Null until posted.
  permalink            text,
  posted_at            timestamptz,
  -- Which version of the text actually went out, for the record.
  posted_version       int,
  -- Why it did not post, in OUR words. Never Reddit's response body — see the
  -- redaction map in packages/monitor/src/index.ts.
  error                text,
  -- The Telegram message carrying this draft's live buttons. Bigint because
  -- message ids are not bounded by int4 and a wrapped id would address someone
  -- else's draft. A tap must come from THIS message or it is stale.
  telegram_message_id  bigint,
  meta                 jsonb
);

-- Columns added after the first cut of this file. Written as ALTERs so a
-- database that already has the original table gets them too.
alter table public.radar_drafts add column if not exists version int not null default 1;
alter table public.radar_drafts add column if not exists nonce text;
alter table public.radar_drafts add column if not exists nonce_used_at timestamptz;
alter table public.radar_drafts add column if not exists expires_at timestamptz
  not null default now() + interval '72 hours';
alter table public.radar_drafts add column if not exists posted_version int;

alter table public.radar_drafts drop constraint if exists radar_drafts_status_check;
alter table public.radar_drafts add constraint radar_drafts_status_check
  check (status in ('pending', 'edited', 'posting', 'posted', 'skipped', 'failed', 'reconcile'));

comment on table public.radar_drafts is
  'One row per drafted reply offered to the founder in Telegram with Post as me / Skip buttons. Holds the text a one-time callback token points at; nothing here posts on its own.';
comment on column public.radar_drafts.thing_id is
  'Reddit fullname of the parent THREAD (t3_ + base-36 id). Deduplication of posting lives in radar_post_reservations, not here.';
comment on column public.radar_drafts.nonce is
  'One-time token carried by the current message''s buttons. Rotated on every re-offer, consumed on the first tap, so a replayed or stale callback does nothing.';
comment on column public.radar_drafts.version is
  'Bumped whenever the text changes or the draft is re-offered. A tap names the version it approved, so an approval can never post text its message did not show.';
comment on column public.radar_drafts.status is
  'pending/edited = awaiting a tap; posting = a claim won and Reddit is being called; posted and skipped are TERMINAL (a trigger refuses to leave them); failed = Reddit received and refused; reconcile = the outcome is unknown and must be checked before anything is retried.';
comment on column public.radar_drafts.telegram_message_id is
  'The message carrying the live buttons. A tap from any other message is stale and is refused.';

-- The first cut guarded threads with a partial unique index on
-- (thing_id) where status='posted'. radar_post_reservations replaces it, and
-- the old index was actively harmful: the failure path released it. Dropped
-- here so a database that ran the earlier file ends up in the same shape.
drop index if exists public.uq_radar_drafts_posted_thing;
drop index if exists public.idx_radar_drafts_posted_at;

-- One live token at a time, globally. A nonce is a bearer credential for
-- posting as the founder, so two rows may never share one.
create unique index if not exists uq_radar_drafts_nonce
  on public.radar_drafts (nonce)
  where nonce is not null;

-- A Telegram reply arrives with a message id and the handler has to find the
-- draft it belongs to.
create index if not exists idx_radar_drafts_message_id
  on public.radar_drafts (telegram_message_id);

-- ------------------------------------------------------------
-- posted and skipped are one-way doors.
--
-- The worker's transitions are all conditional, but "the code always uses the
-- right filter" is a promise, not a guarantee. Sol's review found the case
-- that breaks the promise: a Skip arriving while a post is in flight rewrote
-- status unconditionally, unclaiming a draft Reddit was already being asked
-- about. This trigger is the guarantee. Everything else stays mutable —
-- failed and reconcile are explicitly retryable, and filling in a permalink on
-- an already-posted row is not a status change.
-- ------------------------------------------------------------
create or replace function public.radar_drafts_no_reopen()
returns trigger language plpgsql as $$
begin
  if old.status in ('posted', 'skipped') and new.status is distinct from old.status then
    raise exception 'radar_drafts %: % is terminal, refusing to move it to %',
      old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_radar_drafts_no_reopen on public.radar_drafts;
create trigger trg_radar_drafts_no_reopen
  before update on public.radar_drafts
  for each row execute function public.radar_drafts_no_reopen();

-- ------------------------------------------------------------
-- The reservation table: what makes the two limits real.
--
-- One append-only row per thread, written BEFORE the Reddit request leaves
-- the worker and never removed. Its existence means "a comment on this thread
-- may already have been sent", which is the only honest thing to record when
-- an HTTP request has been made and its answer has not arrived. The old design
-- used status='posted' for this and released it on failure, which meant a
-- comment Reddit accepted but never acknowledged left the thread open to be
-- commented on again.
--
-- It is also the daily cap's ledger. Counting reservations rather than
-- successes is the conservative direction: a request we are unsure about still
-- spends one of the five.
--
-- draft_id is on the row so the draft that owns a reservation can retry after
-- reconciliation, while every OTHER draft for that thread is refused. Without
-- that, an ambiguous outcome would lock the thread away from the one draft
-- entitled to finish it.
-- ------------------------------------------------------------
create table if not exists public.radar_post_reservations (
  thing_id    text primary key,
  draft_id    uuid not null,
  created_at  timestamptz not null default now()
);

comment on table public.radar_post_reservations is
  'Append-only. One row per Reddit thread this account may already have commented on, written before the request is sent and never removed. Also the ledger the daily cap counts.';
comment on column public.radar_post_reservations.draft_id is
  'The draft that holds the reservation. Only that draft may retry the thread; every other draft is refused.';

-- Append-only means append-only. The service role bypasses RLS but not a
-- trigger, so this is the one guard that holds against every writer.
create or replace function public.radar_post_reservations_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'radar_post_reservations is append-only (attempted % on %)',
    tg_op, coalesce(old.thing_id, new.thing_id)
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_radar_post_reservations_immutable on public.radar_post_reservations;
create trigger trg_radar_post_reservations_immutable
  before update or delete on public.radar_post_reservations
  for each row execute function public.radar_post_reservations_immutable();

create index if not exists idx_radar_post_reservations_created_at
  on public.radar_post_reservations (created_at desc);

-- ------------------------------------------------------------
-- reserve_radar_post — the cap and the thread guard, atomically.
--
-- The worker used to count posts, then claim, in two round trips. Two taps a
-- second apart could both see four and both proceed, and the sixth comment of
-- the day went out. Both checks now happen inside one function under one lock,
-- so concurrency cannot see a stale count.
--
-- ponytail: one global advisory lock for the whole feature rather than a lock
-- per thread. At five posts a day the contention is nil, and a single lock is
-- the only shape that can also make the CAP atomic — a per-thread lock would
-- serialise threads against themselves while leaving the count racy. If this
-- ever posts often enough to matter, the upgrade is a serialisable transaction
-- around the count rather than more locks.
--
-- Returns one of three words, never an exception, because the caller has to
-- put the answer into a Telegram message:
--   'ok'            reserved (or already reserved by this same draft)
--   'thread_taken'  another draft already reserved this thread
--   'cap_reached'   five reservations already in the last 24 hours
-- ------------------------------------------------------------
create or replace function public.reserve_radar_post(
  p_draft_id uuid,
  p_thing_id text,
  p_cap int default 5,
  p_window interval default interval '24 hours'
)
returns text
language plpgsql
as $$
declare
  v_owner uuid;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('reserve_radar_post'));

  select draft_id into v_owner
    from public.radar_post_reservations
   where thing_id = p_thing_id;

  if v_owner is not null then
    -- The owning draft may finish what it started; nobody else may start.
    return case when v_owner = p_draft_id then 'ok' else 'thread_taken' end;
  end if;

  select count(*) into v_count
    from public.radar_post_reservations
   where created_at > now() - p_window;

  if v_count >= p_cap then
    return 'cap_reached';
  end if;

  insert into public.radar_post_reservations (thing_id, draft_id)
  values (p_thing_id, p_draft_id);
  return 'ok';
end $$;

comment on function public.reserve_radar_post(uuid, text, int, interval) is
  'Atomically claims one Reddit thread and one slot of the daily cap. Returns ok, thread_taken or cap_reached. The cap default of 5 lives here, not in the worker: the worker''s own check is a pre-flight for a friendlier message.';

-- ------------------------------------------------------------
-- RLS — deny all
--
-- RLS on with no policies means anon and authenticated see nothing and can
-- write nothing through PostgREST. The revokes drop the table-level privilege
-- too, so a policy added by accident in a later migration still grants nothing
-- on its own. The function's EXECUTE is revoked from the customer roles for
-- the same reason: it writes, and only the worker may call it.
-- ------------------------------------------------------------
alter table public.radar_drafts enable row level security;
alter table public.radar_post_reservations enable row level security;

revoke all on public.radar_drafts from anon, authenticated;
revoke all on public.radar_post_reservations from anon, authenticated;
revoke all on function public.reserve_radar_post(uuid, text, int, interval) from public, anon, authenticated;

-- Make the new tables and the function visible to PostgREST at once.
notify pgrst, 'reload schema';
