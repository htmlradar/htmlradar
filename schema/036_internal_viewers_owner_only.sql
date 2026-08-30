-- 036_internal_viewers_owner_only.sql
-- ------------------------------------------------------------
-- Narrow the automatic "internal viewer" flag to the link owner's own
-- address. Drop the rule that flagged every address on the htmlradar.com
-- domain.
--
-- WHY
--
-- start_session (012) flagged a viewer as internal when their address was the
-- link owner's OR when its domain was htmlradar.com. The activity endpoint and
-- the dashboard both hide internal viewers by design, so that an owner opening
-- their own link does not pollute their own numbers. Together the two rules
-- meant that a read by ANYONE at HTMLRadar was captured in full and reported
-- as nothing at all: the 2026-08-30 flight check read a gated link three times
-- from hello@htmlradar.com, and get_share_activity answered "Nobody has viewed
-- this link" over three complete sessions, 111 seconds of active time, full
-- scroll depth and every section timed. The same flag also suppresses the
-- "your document was opened" email, so no notification was sent either.
--
-- Nobody at HTMLRadar could send a tracked document to a colleague and see the
-- result, which is to say the company could not use its own product on itself;
-- and a demonstration to a prospect given an htmlradar.com address looks
-- broken. Colleagues at the company are ordinary recipients and must be
-- visible to the sender. The owner's own reads are the only ones that are
-- genuinely the sender's own noise, so that is the only rule left.
--
-- Nothing else changes. The body below is 012's verbatim, with the predicate
-- narrowed; the signature, the SECURITY DEFINER setting, the search_path, the
-- rate limit, the gate checks and both upsert paths are untouched.
--
-- NO BACKFILL ON PURPOSE. viewers.is_internal carries two things that cannot
-- be told apart after the fact: this automatic flag, and the owner's own
-- "hide this viewer" action from the dashboard (012, 026). Clearing every
-- flagged htmlradar.com row would silently un-hide people an owner chose to
-- hide. Rows already flagged stay flagged and can be unhidden one at a time
-- from the per-link dashboard page; only reads from here on are affected.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create or replace) — re-running changes nothing.
-- ------------------------------------------------------------

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

  -- Auto-flag internal viewers: the link's own owner, and nobody else.
  -- Look up owner email lazily, only if we have a viewer email.
  if v_normalized_email is not null then
    select email into v_owner_email from auth.users where id = v_share.owner_id;
    if v_owner_email is not null and lower(v_owner_email) = v_normalized_email then
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
