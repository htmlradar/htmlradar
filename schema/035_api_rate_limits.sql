-- 035_api_rate_limits.sql
-- ------------------------------------------------------------
-- Rate limits for the public API (POST /api/v1/shares,
-- GET /api/v1/shares/{id}/activity, GET /api/v1/me) and a daily ceiling on
-- API-key creation.
--
-- The 2026-08-30 API/MCP security audit called the missing API rate limits a
-- blocker: the free lifetime quota caps successful shares for one account and
-- nothing else — not rejected uploads, not authentication writes, not activity
-- reads, not key-creation attempts, and not many-account abuse.
--
-- WHY THERE IS NO NEW COUNTER TABLE
--
-- `rate_limits` (schema/001) and `check_rate_limit` (schema/002) already are
-- the fixed-window counter this project uses; the anon-facing RPCs have run on
-- them since launch. The only thing missing was the answer to "how long until
-- I may try again?", because a boolean cannot carry it and a 429 without a
-- Retry-After makes every client guess. So this file adds one function that
-- returns the wait in seconds, and rewrites check_rate_limit as a thin call to
-- it — one implementation, two shapes of answer, one table.
--
-- WHY THE KEY-CREATION LIMIT IS NOT IN THAT TABLE
--
-- api_keys rows are never deleted (034: revoking sets revoked_at), so
-- "how many keys did this account create today?" is already a question the
-- table itself answers exactly. A counter would be a second copy of a fact the
-- data already holds.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create-or-replace throughout; the trigger at the bottom is created only
-- when it is missing, so a second run takes no lock on api_keys).
--
-- ORDERING: run this AFTER 002 (check_rate_limit, rate_limits) and AFTER 034
-- (api_keys and its insert trigger).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The counter, with the wait as its answer
--
-- Returns 0 when this request is inside the limit, otherwise the number of
-- seconds until the current window ends. Every call counts, including the
-- refused ones — a caller cannot spend its way past a limit by ignoring the
-- 429, and the window only ends when it ends.
--
-- Empty search_path, every object written out in full: a SECURITY DEFINER
-- function resolves through the search path on its owner's behalf, so a role
-- holding CREATE on any schema the path names could plant a shadow
-- `rate_limits` and have it written as the owner. The old definition used
-- `set search_path = public`, which is that risk written down.
-- ------------------------------------------------------------
create or replace function public.rate_limit_retry_after(
  p_key             text,
  p_window_seconds  int,
  p_max_count       int
)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_count     int;
  v_window_at timestamptz;
begin
  -- Garbage collect old entries (rough, low frequency), same as the original.
  delete from public.rate_limits where window_at < pg_catalog.now() - interval '1 hour';

  insert into public.rate_limits (key, window_at, count)
  values (p_key, pg_catalog.now(), 1)
  on conflict (key) do update set
    -- `rate_limits.` here is the conflicting row's alias, not a schema lookup,
    -- so the empty search_path does not apply to it.
    count = case
      when rate_limits.window_at
             < pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds) then 1
      else rate_limits.count + 1
    end,
    window_at = case
      when rate_limits.window_at
             < pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds) then pg_catalog.now()
      else rate_limits.window_at
    end
  returning count, window_at into v_count, v_window_at;

  if v_count <= p_max_count then
    return 0;
  end if;

  -- At least one second: a caller told to retry after zero seconds retries
  -- immediately, which is the behaviour the limit exists to stop.
  -- greatest/ceil/extract are pg_catalog constructs, which an empty
  -- search_path still resolves implicitly and nothing can shadow.
  return greatest(
    1,
    ceil(
      extract(
        epoch from (v_window_at + pg_catalog.make_interval(secs => p_window_seconds))
                   - pg_catalog.now()
      )
    )::int
  );
end;
$$;

revoke all on function public.rate_limit_retry_after(text, int, int) from public, anon, authenticated;

-- The public API runs on the service role, on the server, and is the only
-- caller that needs to reach this from outside the database.
grant execute on function public.rate_limit_retry_after(text, int, int) to service_role;

-- ------------------------------------------------------------
-- 2. check_rate_limit, unchanged on the outside
--
-- Same name, same arguments, same boolean. The anon-facing RPCs in 002 call
-- it and are not touched. It is now one line, so the two limiters can never
-- disagree about when a window rolls over.
-- ------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_key             text,
  p_window_seconds  int,
  p_max_count       int
)
returns boolean language sql security definer set search_path = '' as $$
  select public.rate_limit_retry_after(p_key, p_window_seconds, p_max_count) = 0;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Twenty new API keys per account per day
--
-- Alongside 034's ten-live-keys cap, in the same trigger function, because the
-- two answer the same question ("may this account have another key?") and a
-- second trigger would be a second place to look when the answer is no.
--
-- The live cap alone is not enough: revoking makes room instantly, so a script
-- can create-and-revoke without limit, and every one of those rows is a
-- credential that existed. This counts creations rather than survivors.
--
-- It lives here rather than only in the settings server action because the
-- api_keys insert policy (034) lets a signed-in session write key rows
-- straight through PostgREST — an application check alone is one anybody can
-- walk around with curl. The action turns the exception into a sentence.
--
-- WHY THE ADVISORY LOCK
--
-- Counting rows and then deciding is a read followed by a write, and READ
-- COMMITTED gives each concurrent transaction its own snapshot for the read.
-- Ten sessions inserting at once therefore all see nine live keys, all decide
-- there is room, and all commit — twenty keys past a cap of ten, with no
-- constraint violated. The lock is taken on the account, before either count,
-- so the sequence runs one account at a time. It is transaction-scoped, so it
-- is released at COMMIT or ROLLBACK with nothing to unlock by hand, and it
-- serialises only inserts for the same user_id: two customers creating keys at
-- the same moment never wait on each other.
-- ------------------------------------------------------------
create or replace function public.api_keys_enforce_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('api_keys:' || new.user_id::text)
  );

  if (select count(*) from public.api_keys
       where user_id = new.user_id and revoked_at is null) >= 10 then
    raise exception 'api_key_limit' using errcode = 'P0038';
  end if;
  if (select count(*) from public.api_keys
       where user_id = new.user_id
         and created_at > pg_catalog.now() - interval '1 day') >= 20 then
    raise exception 'api_key_daily_limit' using errcode = 'P0038';
  end if;
  return new;
end;
$$;

-- The trigger itself is 034's and is already attached; created here only if it
-- is missing, so this file is still complete on a fresh database.
--
-- Not `drop trigger if exists` + `create trigger`: the drop takes an ACCESS
-- EXCLUSIVE lock on api_keys and the create blocks concurrent writes, so a
-- re-run of this migration — a retried deployment, say — would interrupt live
-- key creation for no reason. Replacing the function above is what actually
-- changes behaviour, and that needs no lock on the table at all. Checking
-- first means a second run does nothing and locks nothing.
--
-- `create or replace trigger` would also work (PostgreSQL 14 and up, and the
-- scratch harness these files are tested on is 15), but it still takes the
-- table lock every run, which is the thing worth avoiding.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'trg_api_keys_enforce_limit'
      and tgrelid = 'public.api_keys'::regclass
      and not tgisinternal
  ) then
    create trigger trg_api_keys_enforce_limit
      before insert on public.api_keys
      for each row execute function public.api_keys_enforce_limit();
  end if;
end;
$$;
