-- 046_connector_grants.sql
-- ------------------------------------------------------------
-- What the application knows about a remote-connector connection, and what
-- happened to it. Contract: docs/workstreams/mcp-product/
-- CONNECTOR-CONTRACT-2026-09-02.md, sections 3b and 5.
--
-- The API key is still the authoritative off switch — every tool call carries
-- it, so setting api_keys.revoked_at ends access on the very next call whatever
-- the OAuth layer believes. These two tables exist for the step *after* that:
-- so an operator can see which connections exist, and so a revocation whose
-- OAuth clean-up failed is a row somebody can find rather than a silence.
--
-- ORDERING: run this AFTER 034 (api_keys) and 040 (api_keys.scope).
--
-- It has no object dependency on 045, but 045 ships in the same connector
-- release and must be applied FIRST all the same: 045 creates connect_handles,
-- which the exchange endpoint reads, and schedules the purge that stops an
-- unexchanged handle sitting on a live plaintext key. Applying 046 alone would
-- leave the connector recording connections it cannot actually complete.
-- ------------------------------------------------------------

create table if not exists public.connector_grants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- One row per minted connector key. The key identifier is what the Worker
  -- resolves a grant by (contract §5 step 2, amended 3 Sep 2026), so it is the
  -- join between the two halves and it is unique here.
  api_key_id        uuid not null unique references public.api_keys(id) on delete cascade,
  client_id         text not null,
  client_host       text not null,
  scope             text not null check (scope in ('shares:read', 'shares:write', 'shares:read shares:write')),
  created_at        timestamptz not null default now(),
  -- Set when the Worker has confirmed the OAuth grant for this key is gone.
  -- Null while the key is live, and null-with-a-revoked-key is exactly the
  -- backlog connector_reconcile_backlog() reports.
  oauth_revoked_at  timestamptz
);

create table if not exists public.connector_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  api_key_id  uuid references public.api_keys(id) on delete set null,
  kind        text not null check (kind in (
                'grant_created', 'grant_revoked', 'reconcile_failed', 'reconciled'
              )),
  -- Never a key, never a token. A client host, an HTTP status, a message.
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists connector_events_user_created_idx
  on public.connector_events (user_id, created_at desc);

comment on table public.connector_grants is
  'One row per remote-connector connection, keyed by the API key it minted. Access is closed by api_keys.revoked_at; this table records that the OAuth grant was tidied afterwards.';
comment on table public.connector_events is
  'Connector lifecycle events. detail holds no key material and no token.';

alter table public.connector_grants enable row level security;
alter table public.connector_events enable row level security;

-- The owner may see their own connections and create one for a live key they
-- own — the same shape as connect_handles (schema/045), for the same reason:
-- the consent page writes as the signed-in customer, not as the service.
drop policy if exists "connector_grants_owner_select" on public.connector_grants;
create policy "connector_grants_owner_select" on public.connector_grants
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "connector_grants_owner_insert" on public.connector_grants;
create policy "connector_grants_owner_insert" on public.connector_grants
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.api_keys as k
      where k.id = connector_grants.api_key_id
        and k.user_id = auth.uid()
        and k.revoked_at is null
    )
  );

-- Recording that a connection was tidied is the owner's own action, and it may
-- only ever move oauth_revoked_at on a row they own.
drop policy if exists "connector_grants_owner_update" on public.connector_grants;
create policy "connector_grants_owner_update" on public.connector_grants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "connector_events_owner_select" on public.connector_events;
create policy "connector_events_owner_select" on public.connector_events
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "connector_events_owner_insert" on public.connector_events;
create policy "connector_events_owner_insert" on public.connector_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- Supabase grants every privilege on a new table to anon and authenticated by
-- default. Undo that, then hand back only what the policies above describe.
revoke all on public.connector_grants from public, anon, authenticated;
revoke all on public.connector_events from public, anon, authenticated;
grant select, insert, update on public.connector_grants to authenticated;
grant select, insert on public.connector_events to authenticated;
grant select, insert, update, delete on public.connector_grants to service_role;
grant select, insert, update, delete on public.connector_events to service_role;

-- ------------------------------------------------------------
-- The sentinel query.
--
-- A connection whose key is revoked but whose OAuth grant was never confirmed
-- gone. Access is already closed for every one of these — the key is dead — so
-- this is a tidy-up backlog, not an incident. It stops being empty when
-- /connect/revoke has been failing, which is the thing worth being told about.
--
-- A function rather than a view, so it is reachable as one PostgREST call from
-- the monitor Worker and so nothing but the service role can run it.
-- ------------------------------------------------------------
create or replace function public.connector_reconcile_backlog(p_min_age_seconds int default 300)
returns table (
  grant_id       uuid,
  user_id        uuid,
  api_key_id     uuid,
  key_revoked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.user_id, g.api_key_id, k.revoked_at
    from public.connector_grants as g
    join public.api_keys as k on k.id = g.api_key_id
   where k.revoked_at is not null
     and g.oauth_revoked_at is null
     and k.revoked_at < now() - make_interval(secs => p_min_age_seconds)
   order by k.revoked_at;
$$;

comment on function public.connector_reconcile_backlog(int) is
  'Connections whose API key is revoked but whose OAuth grant was never confirmed gone. Access is already closed for all of them; a non-empty answer means /connect/revoke has been failing.';

revoke all on function public.connector_reconcile_backlog(int) from public, anon, authenticated;
grant execute on function public.connector_reconcile_backlog(int) to service_role;

notify pgrst, 'reload schema';
