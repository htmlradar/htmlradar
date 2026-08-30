-- 034_api_keys.sql
-- ------------------------------------------------------------
-- The public API (POST /api/v1/shares, GET /api/v1/shares/{id}/activity,
-- GET /api/v1/me). Two things are needed in the database:
--
--   1. api_keys — the credential table. Only a SHA-256 hash is stored, so a
--      dump of this table cannot be replayed against the API.
--   2. create_share_as — the service role's way of running create_share ON
--      BEHALF OF a customer, because an API request carries no Supabase
--      session and therefore no auth.uid().
--
-- WHY create_share_as WRAPS create_share RATHER THAN REPEATING IT
--
-- create_share (033) is where the generated-slug bookkeeping lives, and the
-- two triggers on document_shares — enforce_share_cap (027) and
-- validate_share_slug (033) — are the actual controls on who may create a
-- link and what its address may be. A second INSERT path written here would
-- be a second place for those to be got wrong. So create_share_as sets the
-- request GUCs that auth.uid() reads and then calls create_share unchanged.
-- Everything downstream — the free-tier cap, the Pro check on a chosen
-- address, the reserved-word list, the password minimum — applies identically
-- whether the caller came through the browser or through the API.
--
-- WHY SETTING THE GUC IS SAFE
--
-- auth.uid() resolves to
--     coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
--              current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
-- Both are set here, transaction-locally, so they are gone at commit and
-- cannot leak into the next request on a pooled connection. This is the same
-- mechanism 033's test file uses to act as a given user.
--
-- The one thing that must not happen is a customer reaching this function and
-- passing somebody else's p_user_id. Hence the grant at the bottom: execute
-- is revoked from public, anon and authenticated, and given only to
-- service_role. service_role's key never leaves the server.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create-table-if-not-exists + drop-if-exists + create-or-replace).
--
-- ORDERING: run this AFTER 033 — create_share_as calls the 9-argument
-- create_share that 033 installs.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The credential table
--
-- key_hash is the SHA-256 of the whole key including the `hr_live_` prefix,
-- lowercase hex. `unique` both prevents a duplicate row and gives the API's
-- lookup an index to use — that lookup runs on every single API request.
--
-- key_prefix is the first few characters of the key in the clear
-- (`hr_live_1a2b3c`). It exists so the owner can tell two keys apart in the
-- settings list without us ever storing enough to authenticate with.
--
-- No delete: revoking sets revoked_at. A deleted row would take last_used_at
-- with it, and "when did that leaked key last work?" is the first question
-- anyone asks after a leak.
-- ------------------------------------------------------------
create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_hash      text not null unique,
  key_prefix    text not null,
  label         text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

comment on column public.api_keys.key_hash is
  'SHA-256 of the full key, lowercase hex. The key itself is shown once at creation and never stored.';
comment on column public.api_keys.key_prefix is
  'First 14 characters of the key in the clear, so the owner can identify a key in the settings list.';

create index if not exists idx_api_keys_user on public.api_keys (user_id, created_at desc);

-- ------------------------------------------------------------
-- 2. RLS — the owner sees and manages only their own keys
--
-- No delete policy, and delete is revoked outright as well: RLS alone would
-- make a delete a silent no-op (0 rows), and a silent no-op in the one place
-- where "did it go away?" matters is worse than a refusal.
--
-- The owner CAN select their own key_hash. That is not a leak — it is the
-- hash of a key they were already shown once, and it authenticates nothing on
-- its own.
-- ------------------------------------------------------------
alter table public.api_keys enable row level security;

drop policy if exists "api_keys_owner_select" on public.api_keys;
create policy "api_keys_owner_select" on public.api_keys
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "api_keys_owner_insert" on public.api_keys;
create policy "api_keys_owner_insert" on public.api_keys
  for insert to authenticated with check (user_id = auth.uid());

-- using + with check both, so a row cannot be reassigned to another user on
-- the way out (RLS scopes rows, not columns — see 032).
--
-- `revoked_at is not null` in the WITH CHECK is what makes revocation the only
-- update a signed-in browser session can perform. Without it the owner's own
-- PostgREST access is enough to set revoked_at back to null, and a key the
-- customer believes they switched off starts authenticating again — the API
-- refuses revoked keys correctly, so the row is the only thing standing
-- between a leaked key and the account.
drop policy if exists "api_keys_owner_update" on public.api_keys;
create policy "api_keys_owner_update" on public.api_keys
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and revoked_at is not null);

revoke all on public.api_keys from anon;
revoke delete on public.api_keys from authenticated;

-- ------------------------------------------------------------
-- 2b. Revocation is permanent, and the rest of the row is immutable
--
-- The policy above only binds `authenticated`. The service role bypasses RLS
-- entirely and is what stamps last_used_at on every API request, so the rule
-- that matters — "a revoked key is revoked forever" — has to live somewhere
-- both roles pass through. A trigger is that place.
--
-- last_used_at is writable because authentication stamps it. label is
-- writable so a rename never has to become a delete. Everything else,
-- including user_id and key_hash, is fixed at creation: a key that could be
-- re-pointed at another account, or have another key's hash written into it,
-- is a takeover rather than an edit.
-- ------------------------------------------------------------
create or replace function public.api_keys_guard_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'api_key_already_revoked' using errcode = 'P0039';
  end if;
  if new.id           is distinct from old.id
  or new.user_id      is distinct from old.user_id
  or new.key_hash     is distinct from old.key_hash
  or new.key_prefix   is distinct from old.key_prefix
  or new.created_at   is distinct from old.created_at then
    raise exception 'api_key_immutable' using errcode = 'P0039';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_api_keys_guard_update on public.api_keys;
create trigger trg_api_keys_guard_update
  before update on public.api_keys
  for each row execute function public.api_keys_guard_update();

-- ------------------------------------------------------------
-- 2c. Ten live keys per account
--
-- The settings server action is not where this can live: the insert policy
-- above lets a signed-in customer write api_keys rows straight through
-- PostgREST, so a limit checked in the application is a limit that can be
-- walked around with curl. Counted on live keys only — revoking is how you
-- make room, and the revoked rows stay for their last_used_at trail.
-- ------------------------------------------------------------
create or replace function public.api_keys_enforce_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.api_keys
       where user_id = new.user_id and revoked_at is null) >= 10 then
    raise exception 'api_key_limit' using errcode = 'P0038';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_api_keys_enforce_limit on public.api_keys;
create trigger trg_api_keys_enforce_limit
  before insert on public.api_keys
  for each row execute function public.api_keys_enforce_limit();

-- ------------------------------------------------------------
-- 3. create_share, run on behalf of a user, for the service role only
--
-- The signature is create_share's with p_user_id prepended. Validation is NOT
-- repeated: this sets the identity and delegates.
-- ------------------------------------------------------------
drop function if exists public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text);

create or replace function public.create_share_as(
  p_user_id               uuid,
  p_document_id           uuid,
  p_recipient_label       text,
  p_require_email         boolean,
  p_require_password      boolean,
  p_password_plain        text,
  p_allowed_email_domains text[],
  p_allowed_emails        text[],
  p_expires_at            timestamptz,
  p_slug                  text default null
)
returns public.document_shares
-- Empty search_path, every object written out in full. A SECURITY DEFINER
-- function runs with the owner's privileges, so anything it resolves through a
-- search path is resolved on the owner's behalf: a role holding CREATE on any
-- schema the path names could plant a shadow `create_share` or
-- `json_build_object` and have it run as the owner. An empty path removes the
-- question. (pg_catalog is implicitly searched regardless, but it is spelled
-- out here so the rule reads as absolute rather than as something with a
-- remembered exception.)
language plpgsql security definer set search_path = '' as $$
declare
  v_share       public.document_shares%rowtype;
  v_prev_sub    text := coalesce(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
  v_prev_claims text := coalesce(pg_catalog.current_setting('request.jwt.claims', true), '');
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Both forms auth.uid() understands, transaction-local.
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );

  v_share := public.create_share(
    p_document_id,
    p_recipient_label,
    p_require_email,
    p_require_password,
    p_password_plain,
    p_allowed_email_domains,
    p_allowed_emails,
    p_expires_at,
    p_slug
  );

  -- Put the connection back as we found it. On an exception the transaction
  -- aborts and the local settings are rolled back anyway, so this only
  -- matters on the success path.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_prev_sub, true);
  perform pg_catalog.set_config('request.jwt.claims', v_prev_claims, true);

  return v_share;
end;
$$;

-- The whole security argument for this function is this grant. A customer who
-- could execute it could pass any p_user_id and create links in anyone's
-- account.
revoke all on function public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text)
  to service_role;
