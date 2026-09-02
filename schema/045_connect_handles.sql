-- 045_connect_handles.sql
-- ------------------------------------------------------------
-- Short-lived, single-use handoff from the signed-in consent page to the MCP
-- connector. The browser receives the random handle; this table stores only
-- its SHA-256 hash. The API key itself lives here for at most 120 seconds and
-- disappears in the same DELETE ... RETURNING statement that reveals it.
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
  scope       text not null check (scope in ('shares:read', 'shares:read shares:write')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

comment on column public.connect_handles.api_key is
  'Plaintext connector key. It is returned and deleted atomically at exchange, at most 120 seconds after creation.';

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
