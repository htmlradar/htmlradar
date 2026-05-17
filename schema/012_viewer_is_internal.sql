-- 012_viewer_is_internal.sql
-- ------------------------------------------------------------
-- "Hide internal viewers" — soft-flag on `viewers` so the dashboard
-- can drop test/staff/owner-self views out of aggregate stats and the
-- main viewer table, without ever deleting data.
--
-- Three pieces:
--   1. New column `viewers.is_internal boolean default false`.
--   2. start_session RPC auto-flags new viewers whose email matches
--      the doc-owner's auth email OR ends with `@htmlradar.com`.
--   3. New RPC `toggle_viewer_internal(viewer_id)` for the per-row
--      hide/show action in the dashboard. Owner-scoped.
--
-- Backfill runs once: existing viewers matching the same auto-flag
-- rules are marked internal so the dashboard cleans up retroactively
-- (Abhinandan's previewing-his-own-deck rows, verify+post-declutter
-- testing rows, etc.).
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

begin;

-- 1. Column + index ----------------------------------------------------
alter table viewers
  add column if not exists is_internal boolean not null default false;

create index if not exists idx_viewers_share_internal
  on viewers (share_id, is_internal);

-- 2. Backfill existing rows --------------------------------------------
-- Mark viewers whose email matches the share-owner's auth email, OR
-- whose email is on the HTMLRadar staff domain. Idempotent: re-running
-- only flips rows that aren't already flagged.
update viewers v
set is_internal = true
from document_shares s, auth.users u
where v.share_id = s.id
  and u.id = s.owner_id
  and v.email is not null
  and v.is_internal = false
  and (
    lower(v.email) = lower(u.email)
    or split_part(lower(v.email), '@', 2) = 'htmlradar.com'
  );

-- 3. start_session — auto-flag on insert -------------------------------
-- Same predicate as the backfill. Lives inside the existing RPC so the
-- check happens once per session (upsert path keeps current value via
-- COALESCE — never un-flags a row that an owner manually marked).
create or replace function start_session(
  p_share_slug    text,
  p_email         text,
  p_fingerprint   text,
  p_referrer      text,
  p_user_agent    text,
  p_country_code  text default null,
  p_city          text default null,
  p_device_type   text default null,
  p_os            text default null,
  p_browser       text default null,
  p_client_ip     text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_share             document_shares%rowtype;
  v_doc               documents%rowtype;
  v_owner_email       text;
  v_viewer_id         uuid;
  v_session           record;
  v_normalized_email  text;
  v_is_internal       boolean := false;
begin
  if not check_rate_limit(
    'start:' || p_share_slug || ':' || coalesce(lower(p_email), p_fingerprint, 'anon'),
    60, 5
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select * into v_share from document_shares where slug = p_share_slug;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'share_revoked' using errcode = 'P0003';
  end if;
  if v_share.expires_at is not null and v_share.expires_at < now() then
    raise exception 'share_expired' using errcode = 'P0004';
  end if;

  if v_share.require_email then
    if p_email is null or trim(p_email) = '' then
      raise exception 'email_required' using errcode = 'P0005';
    end if;
    if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'email_invalid' using errcode = 'P0006';
    end if;
    if v_share.allowed_email_domains is not null and array_length(v_share.allowed_email_domains, 1) > 0 then
      if not (split_part(lower(p_email), '@', 2) = any(v_share.allowed_email_domains)) then
        raise exception 'email_domain_not_allowed' using errcode = 'P0007';
      end if;
    end if;
    v_normalized_email := lower(trim(p_email));
  end if;

  select * into v_doc from documents where id = v_share.document_id;
  if v_doc.deleted_at is not null then
    raise exception 'document_deleted' using errcode = 'P0008';
  end if;

  -- Auto-flag internal viewers: owner-self or HTMLRadar staff.
  -- Look up owner email lazily, only if we have a viewer email.
  if v_normalized_email is not null then
    select email into v_owner_email from auth.users where id = v_share.owner_id;
    if v_owner_email is not null
       and (
         lower(v_owner_email) = v_normalized_email
         or split_part(v_normalized_email, '@', 2) = 'htmlradar.com'
       )
    then
      v_is_internal := true;
    end if;
  end if;

  -- Upsert viewer. The is_internal column is set on first insert; on
  -- subsequent visits we OR it with auto-flag so we never un-flag a
  -- manually-hidden viewer (preserves the owner's hide action across
  -- their later visits).
  if v_normalized_email is not null then
    insert into viewers (share_id, email, referrer, user_agent, country_code, city, device_type, os, browser, is_internal)
    values (v_share.id, v_normalized_email, p_referrer, p_user_agent, p_country_code, p_city, p_device_type, p_os, p_browser, v_is_internal)
    on conflict (share_id, lower(email)) where email is not null do update set
      last_seen = now(),
      visit_count = viewers.visit_count + 1,
      country_code = coalesce(excluded.country_code, viewers.country_code),
      device_type = coalesce(excluded.device_type, viewers.device_type),
      is_internal = viewers.is_internal or excluded.is_internal
    returning id into v_viewer_id;
  else
    if p_fingerprint is null then
      raise exception 'identity_required' using errcode = 'P0009';
    end if;
    insert into viewers (share_id, fingerprint, referrer, user_agent, country_code, city, device_type, os, browser)
    values (v_share.id, p_fingerprint, p_referrer, p_user_agent, p_country_code, p_city, p_device_type, p_os, p_browser)
    on conflict (share_id, fingerprint) where fingerprint is not null do update set
      last_seen = now(),
      visit_count = viewers.visit_count + 1
    returning id into v_viewer_id;
  end if;

  insert into sessions (share_id, viewer_id, document_version)
  values (v_share.id, v_viewer_id, v_doc.current_version)
  returning id, token into v_session;

  return jsonb_build_object(
    'session_id',       v_session.id,
    'token',            v_session.token,
    'document_id',      v_doc.id,
    'document_version', v_doc.current_version
  );
end;
$$;

-- 4. Toggle RPC for the dashboard hide/show action ---------------------
-- Owner-scoped: the calling user must own the document_share that owns
-- this viewer. Flips the boolean and returns the new state for the
-- client to optimistic-update against.
create or replace function toggle_viewer_internal(p_viewer_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_share_owner uuid;
  v_new_value   boolean;
begin
  -- Ownership check: viewer → share → owner_id must match auth.uid().
  select s.owner_id into v_share_owner
  from viewers v
  join document_shares s on s.id = v.share_id
  where v.id = p_viewer_id;

  if v_share_owner is null then
    raise exception 'viewer_not_found' using errcode = 'P0010';
  end if;
  if v_share_owner <> auth.uid() then
    raise exception 'not_owner' using errcode = 'P0011';
  end if;

  update viewers
  set is_internal = not is_internal
  where id = p_viewer_id
  returning is_internal into v_new_value;

  return v_new_value;
end;
$$;

grant execute on function toggle_viewer_internal(uuid) to authenticated;

commit;
