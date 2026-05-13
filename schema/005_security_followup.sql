-- 005_security_followup.sql — three audit follow-ups
--
--   1. update_session: collapse session-not-found and invalid-token into a
--      single error code so a token holder cannot probe session_id UUIDs
--      and learn which exist. UUIDs are 128-bit so brute-force enumeration
--      is impractical, but distinguishing the two cases is a free side
--      channel worth closing.
--   2. start_session: reject viewers from common disposable-email domains
--      (10minutemail, mailinator, guerrillamail, yopmail, etc.). This is
--      friction-free for legitimate viewers and meaningfully tightens the
--      gate on the casual bypass path. List is static for v1.0 and can
--      move to a maintained source in v1.2.
--   3. Both functions re-defined in full via create-or-replace; migration
--      is idempotent.

-- ------------------------------------------------------------
-- update_session: one error code for token-or-session-invalid
-- ------------------------------------------------------------
create or replace function update_session(
  p_session_id      uuid,
  p_token           text,
  p_active_seconds  integer,
  p_max_scroll      real,
  p_sections        jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_stored_token text;
  v_section      jsonb;
begin
  if not check_rate_limit('update:' || p_session_id::text, 60, 30) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select token into v_stored_token from sessions where id = p_session_id;
  if v_stored_token is null
     or p_token is null
     or length(p_token) <> length(v_stored_token)
     or p_token <> v_stored_token then
    raise exception 'invalid_token' using errcode = 'P0010';
  end if;

  p_active_seconds := greatest(0, least(86400, coalesce(p_active_seconds, 0)));
  p_max_scroll := greatest(0::real, least(1::real, coalesce(p_max_scroll, 0::real)));

  update sessions set
    active_time_seconds = greatest(active_time_seconds, p_active_seconds),
    max_scroll_depth = greatest(max_scroll_depth, p_max_scroll),
    last_heartbeat_at = now()
  where id = p_session_id;

  if p_sections is not null and jsonb_typeof(p_sections) = 'array' then
    for v_section in select * from jsonb_array_elements(p_sections) loop
      insert into section_events (session_id, section_id, section_title, depth, ordinal, time_seconds)
      values (
        p_session_id,
        (v_section ->> 'section_id'),
        (v_section ->> 'section_title'),
        (v_section ->> 'depth')::int,
        (v_section ->> 'ordinal')::int,
        greatest(0::real, least(86400::real, (v_section ->> 'time_seconds')::real))
      )
      on conflict (session_id, section_id) do update set
        time_seconds = greatest(section_events.time_seconds, excluded.time_seconds),
        section_title = coalesce(excluded.section_title, section_events.section_title);
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function update_session(uuid, text, integer, real, jsonb) from public;
grant execute on function update_session(uuid, text, integer, real, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- start_session: add disposable-email domain blocklist
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
  v_share         document_shares%rowtype;
  v_doc           documents%rowtype;
  v_viewer_id     uuid;
  v_session       record;
  v_normalized_email text;
  v_email_domain  text;
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

    v_email_domain := split_part(lower(p_email), '@', 2);

    -- Disposable-email blocklist. Static for v1.0; covers the 30 most
    -- common throwaway services. Move to a maintained source in v1.2.
    if v_email_domain = any(array[
      '10minutemail.com', '20minutemail.com', 'discardmail.com',
      'dispostable.com', 'emailondeck.com', 'fakeinbox.com',
      'getairmail.com', 'getnada.com', 'guerrillamail.biz',
      'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
      'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
      'mail-temporaire.fr', 'maildrop.cc', 'mailcatch.com',
      'mailinator.com', 'mailnesia.com', 'mailtemp.info', 'mintemail.com',
      'mohmal.com', 'sharklasers.com', 'spam4.me', 'tempinbox.com',
      'tempmail.io', 'temp-mail.org', 'temp-mail.us', 'throwawaymail.com',
      'trashmail.com', 'trashmail.net', 'trbvm.com', 'yopmail.com',
      'yopmail.fr', 'yopmail.net'
    ]) then
      raise exception 'email_disposable' using errcode = 'P0023';
    end if;

    if v_share.allowed_email_domains is not null and array_length(v_share.allowed_email_domains, 1) > 0 then
      if not (v_email_domain = any(v_share.allowed_email_domains)) then
        raise exception 'email_domain_not_allowed' using errcode = 'P0007';
      end if;
    end if;

    v_normalized_email := lower(trim(p_email));
  end if;

  select * into v_doc from documents where id = v_share.document_id;
  if v_doc.deleted_at is not null then
    raise exception 'document_deleted' using errcode = 'P0008';
  end if;

  if v_normalized_email is not null then
    insert into viewers (share_id, email, referrer, user_agent, country_code, city, device_type, os, browser)
    values (v_share.id, v_normalized_email, p_referrer, p_user_agent, p_country_code, p_city, p_device_type, p_os, p_browser)
    on conflict (share_id, lower(email)) where email is not null do update set
      last_seen = now(),
      visit_count = viewers.visit_count + 1,
      country_code = coalesce(excluded.country_code, viewers.country_code),
      device_type = coalesce(excluded.device_type, viewers.device_type)
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

revoke all on function start_session(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function start_session(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
