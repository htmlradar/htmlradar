-- 004_password_security.sql — pre-launch hardening
--
-- Two changes, both audit findings:
--   1. verify_share_password gains a rate limit (5 attempts per slug per 60s).
--      Without it, an attacker could brute-force a 4-digit password from one IP
--      in seconds. Rate-limiting on slug means a legitimate viewer who fat-fingers
--      five times still has to wait a minute, which is the right tradeoff.
--   2. create_share raises the password minimum from 4 to 8 characters.
--      Four characters is roughly 50 bits of entropy in the average pick-an-easy-
--      password case; eight is closer to 25-30 with mixed input and stops the
--      most casual brute force entirely.
--
-- Both functions are SECURITY DEFINER and re-defined here in full via
-- create-or-replace, so applying this migration is idempotent.

-- ------------------------------------------------------------
-- verify_share_password: add per-slug rate limit
-- ------------------------------------------------------------
create or replace function verify_share_password(p_slug text, p_password_plain text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  if not check_rate_limit('pwd:' || p_slug, 60, 5) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select password_hash into v_hash from document_shares where slug = p_slug and require_password = true;
  if not found or v_hash is null then
    return false;
  end if;
  return v_hash = crypt(p_password_plain, v_hash);
end;
$$;

revoke all on function verify_share_password(text, text) from public;
grant execute on function verify_share_password(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- create_share: raise minimum password length from 4 to 8
-- ------------------------------------------------------------
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

  select * into v_doc from documents where id = p_document_id and owner_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0021';
  end if;

  loop
    v_slug := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
           || '-' || v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int]
           || '-' || encode(gen_random_bytes(3), 'hex');
    exit when not exists (select 1 from document_shares where slug = v_slug);
  end loop;

  if p_require_password then
    if p_password_plain is null or length(p_password_plain) < 8 then
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
