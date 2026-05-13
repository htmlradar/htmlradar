-- HTMLRadar — SECURITY DEFINER RPCs
-- Anon's only write surface. Each RPC validates inputs, enforces rate limits, returns minimal data.
-- Apply AFTER 001_init.sql.

-- ============================================================
-- Helper: rate limit check
-- key = e.g. 'ip:1.2.3.4:start_session'
-- Returns true if allowed, false if exceeded.
-- ============================================================
create or replace function check_rate_limit(p_key text, p_window_seconds int, p_max_count int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_window_at timestamptz;
  v_count int;
begin
  -- Garbage collect old entries (rough, low frequency)
  delete from rate_limits where window_at < now() - interval '1 hour';

  insert into rate_limits (key, window_at, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case
      when rate_limits.window_at < now() - make_interval(secs => p_window_seconds) then 1
      else rate_limits.count + 1
    end,
    window_at = case
      when rate_limits.window_at < now() - make_interval(secs => p_window_seconds) then now()
      else rate_limits.window_at
    end
  returning count into v_count;

  return v_count <= p_max_count;
end;
$$;

revoke all on function check_rate_limit(text, int, int) from public, anon, authenticated;

-- ============================================================
-- start_session
-- Called by the tracker when a new view begins.
-- Validates the share, upserts the viewer, creates a session, returns a signed token.
-- Anonymous mode: pass null email + a fingerprint.
-- ============================================================
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
  v_session      record;
  v_normalized_email text;
begin
  -- Rate-limit by (slug + identity). An IP-based limit would be dead since
  -- the tracker cannot send IP from the browser; identity-based forces
  -- attackers to fabricate distinct identities per request.
  if not check_rate_limit(
    'start:' || p_share_slug || ':' || coalesce(lower(p_email), p_fingerprint, 'anon'),
    60, 5
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Load share
  select * into v_share from document_shares where slug = p_share_slug;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  -- Check revoked / expired
  if v_share.revoked_at is not null then
    raise exception 'share_revoked' using errcode = 'P0003';
  end if;
  if v_share.expires_at is not null and v_share.expires_at < now() then
    raise exception 'share_expired' using errcode = 'P0004';
  end if;

  -- Validate identity requirements
  if v_share.require_email then
    if p_email is null or trim(p_email) = '' then
      raise exception 'email_required' using errcode = 'P0005';
    end if;
    if p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'email_invalid' using errcode = 'P0006';
    end if;

    -- Domain allowlist
    if v_share.allowed_email_domains is not null and array_length(v_share.allowed_email_domains, 1) > 0 then
      if not (split_part(lower(p_email), '@', 2) = any(v_share.allowed_email_domains)) then
        raise exception 'email_domain_not_allowed' using errcode = 'P0007';
      end if;
    end if;

    v_normalized_email := lower(trim(p_email));
  end if;

  -- Load document for current_version
  select * into v_doc from documents where id = v_share.document_id;
  if v_doc.deleted_at is not null then
    raise exception 'document_deleted' using errcode = 'P0008';
  end if;

  -- Upsert viewer
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

  -- Insert session. The `token` column has a default of 32 random bytes (hex),
  -- so we don't pass one — pgcrypto generates it server-side, the tracker
  -- only ever sees the value via this RETURNING clause.
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

-- ============================================================
-- update_session
-- Called periodically by the tracker (heartbeat) and on page-unload.
-- Verifies token, updates session totals + section events in one round-trip.
-- ============================================================
create or replace function update_session(
  p_session_id      uuid,
  p_token           text,
  p_active_seconds  integer,
  p_max_scroll      real,
  p_sections        jsonb                       -- [{section_id, section_title, depth, ordinal, time_seconds}, ...]
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_stored_token text;
  v_section      jsonb;
begin
  -- Rate-limit per session to stop a token-holder from flooding section
  -- events. Cap is 30 updates per 60s per session; tracker heartbeats every
  -- 15s, so ~4/min is the legitimate worst case.
  if not check_rate_limit('update:' || p_session_id::text, 60, 30) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Look up the per-session bearer token stored at start_session time.
  -- An attacker without the original token cannot forge updates; an attacker
  -- WITH it can only modify the session they were issued (still rate-limited).
  select token into v_stored_token from sessions where id = p_session_id;
  if v_stored_token is null then
    raise exception 'session_not_found' using errcode = 'P0011';
  end if;

  -- Compare lengths first so a length-mismatch short-circuits without
  -- timing-revealing the per-byte comparison. Both tokens are fixed-length
  -- 64-char hex.
  if p_token is null
     or length(p_token) <> length(v_stored_token)
     or p_token <> v_stored_token then
    raise exception 'invalid_token' using errcode = 'P0010';
  end if;

  -- Clamp values defensively
  p_active_seconds := greatest(0, least(86400, coalesce(p_active_seconds, 0)));
  p_max_scroll := greatest(0::real, least(1::real, coalesce(p_max_scroll, 0::real)));

  -- Update session totals (only grow, never shrink)
  update sessions set
    active_time_seconds = greatest(active_time_seconds, p_active_seconds),
    max_scroll_depth = greatest(max_scroll_depth, p_max_scroll),
    last_heartbeat_at = now()
  where id = p_session_id;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0011';
  end if;

  -- Upsert section events
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

-- ============================================================
-- create_share
-- Owner creates a per-recipient share with all settings.
-- Returns the new share row (slug included).
-- ============================================================
create or replace function create_share(
  p_document_id          uuid,
  p_recipient_label      text,
  p_require_email        boolean,
  p_require_password     boolean,
  p_password_plain       text,
  p_allowed_email_domains text[],
  p_expires_at           timestamptz
)
returns document_shares
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user_id   uuid := auth.uid();
  v_doc       documents%rowtype;
  v_slug      text;
  v_hash      text;
  v_share     document_shares%rowtype;
  v_adjectives text[] := array['swift','silent','bright','golden','crisp','steady','quick','noble','vivid','calm'];
  v_nouns      text[] := array['falcon','river','meadow','signal','beacon','compass','glass','harbor','prism','ember'];
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Ownership check
  select * into v_doc from documents where id = p_document_id and owner_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0021';
  end if;

  -- Generate unique slug. Suffix is gen_random_bytes (24 bits, ~16M values)
  -- rather than md5(random()), which is not cryptographically random.
  loop
    v_slug := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
           || '-' || v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int]
           || '-' || encode(gen_random_bytes(3), 'hex');
    exit when not exists (select 1 from document_shares where slug = v_slug);
  end loop;

  -- Hash password if required
  if p_require_password then
    if p_password_plain is null or length(p_password_plain) < 4 then
      raise exception 'password_too_short' using errcode = 'P0022';
    end if;
    v_hash := crypt(p_password_plain, gen_salt('bf', 10));
  end if;

  insert into document_shares (
    document_id, owner_id, slug, recipient_label,
    require_email, require_password, password_hash,
    allowed_email_domains, expires_at
  )
  values (
    p_document_id, v_user_id, v_slug, p_recipient_label,
    coalesce(p_require_email, true), coalesce(p_require_password, false), v_hash,
    p_allowed_email_domains, p_expires_at
  )
  returning * into v_share;

  return v_share;
end;
$$;

revoke all on function create_share(uuid, text, boolean, boolean, text, text[], timestamptz) from public, anon;
grant execute on function create_share(uuid, text, boolean, boolean, text, text[], timestamptz) to authenticated;

-- ============================================================
-- verify_share_password
-- Called by proxy worker when a share requires password.
-- Returns true if password matches.
-- ============================================================
create or replace function verify_share_password(p_slug text, p_password_plain text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  select password_hash into v_hash from document_shares where slug = p_slug and require_password = true;
  if not found or v_hash is null then
    return false;
  end if;
  return v_hash = crypt(p_password_plain, v_hash);
end;
$$;

revoke all on function verify_share_password(text, text) from public;
grant execute on function verify_share_password(text, text) to anon, authenticated;
