-- 045_connect_handles.sql
-- ------------------------------------------------------------
-- Short-lived, single-use handoff from the signed-in consent page to the MCP
-- connector. The browser receives the random handle; this table stores only
-- its SHA-256 hash. The API key normally disappears in the same
-- DELETE ... RETURNING statement that the exchange uses to reveal it; a row
-- that is never exchanged (closed browser, Worker down, lost callback) is
-- swept by purge_connect_handles() on a 5-minute cron below.
--
-- ORDERING: run this AFTER 040 (api_keys.scope).
-- ------------------------------------------------------------

create table if not exists public.connect_handles (
  id          uuid primary key default gen_random_uuid(),
  tx          text not null unique check (tx ~ '^[0-9a-f]{32}$'),
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  api_key_id  uuid not null references public.api_keys(id) on delete cascade,
  api_key     text not null check (api_key ~ '^hr_live_[0-9a-f]{40}$'),
  scope       text not null check (scope in ('shares:read', 'shares:write', 'shares:read shares:write')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

comment on column public.connect_handles.api_key is
  'Plaintext connector key. Deleted atomically at exchange; purged at most 5 minutes after expiry otherwise, by purge_connect_handles() below.';

alter table public.connect_handles enable row level security;

drop policy if exists "connect_handles_owner_insert" on public.connect_handles;
create policy "connect_handles_owner_insert" on public.connect_handles
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.api_keys as k
      where k.id = connect_handles.api_key_id
        and k.user_id = auth.uid()
        and k.revoked_at is null
    )
  );

revoke all on public.connect_handles from public, anon, authenticated;
grant insert on public.connect_handles to authenticated;
grant select, delete on public.connect_handles to service_role;

-- ------------------------------------------------------------
-- Purge expired handles. A row that is allowed but never exchanged (closed
-- browser, Worker down, lost callback) would otherwise sit holding a live
-- plaintext api_key indefinitely.
-- ------------------------------------------------------------
create or replace function public.purge_connect_handles()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.connect_handles where expires_at < now();
$$;

comment on function public.purge_connect_handles() is
  'Deletes expired connect_handles rows so an unexchanged handle does not keep its plaintext api_key around indefinitely. Scheduled every 5 minutes via pg_cron below; also callable by hand as service_role.';

revoke all on function public.purge_connect_handles() from public, anon, authenticated;
grant execute on function public.purge_connect_handles() to service_role;

-- ------------------------------------------------------------
-- Schedule it every 5 minutes.
--
-- Two separate guarded blocks: the extension may already be installed (or
-- may fail to install, e.g. a self-hosted Postgres without it built), and
-- the schedule call should only run once the extension is actually there.
-- Neither failure aborts the rest of this migration.
-- ------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable (%): purge_connect_handles() must be scheduled externally, every 5 minutes.', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge_connect_handles') then
      perform cron.unschedule('purge_connect_handles');
    end if;
    perform cron.schedule(
      'purge_connect_handles',
      '*/5 * * * *',
      'select public.purge_connect_handles();'
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
