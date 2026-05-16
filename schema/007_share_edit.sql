-- 007_share_edit.sql
-- ------------------------------------------------------------
-- Add update_share RPC so senders can edit existing shares
-- (recipient label, gates, password, allowlist, expiry) without
-- having to revoke + recreate. Mirrors create_share's signature
-- so the client passes the same shape.
--
-- Why an RPC and not direct table UPDATE from the client:
--   - Password hashing has to happen server-side (we never want
--     the plaintext password leaving the server boundary)
--   - Length validation must match create_share (8+ chars)
--   - SECURITY DEFINER lets us enforce owner_id ownership in one
--     atomic check instead of trusting client-side filters
--
-- Re-running this file is safe (CREATE OR REPLACE FUNCTION).
-- ------------------------------------------------------------

create or replace function update_share(
  p_share_id             uuid,
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
  v_user_id uuid := auth.uid();
  v_share   document_shares%rowtype;
  v_hash    text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Confirm ownership before touching the row. The where-clause here
  -- is the only authorization gate; do not relax it.
  select * into v_share from document_shares
   where id = p_share_id and owner_id = v_user_id;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0024';
  end if;

  -- Password hash handling:
  --   - If require_password flipped ON and a new password was supplied,
  --     hash it (same 8-char minimum as create_share).
  --   - If require_password flipped OFF, clear the hash.
  --   - If require_password stayed ON and password_plain is blank,
  --     preserve the existing hash (editing other fields shouldn't
  --     force re-entering the password).
  if coalesce(p_require_password, false) then
    if p_password_plain is not null and length(p_password_plain) > 0 then
      if length(p_password_plain) < 8 then
        raise exception 'password_too_short' using errcode = 'P0022';
      end if;
      v_hash := crypt(p_password_plain, gen_salt('bf', 10));
    else
      v_hash := v_share.password_hash; -- unchanged
    end if;
  else
    v_hash := null;
  end if;

  update document_shares
     set recipient_label       = p_recipient_label,
         require_email         = coalesce(p_require_email, require_email),
         require_password      = coalesce(p_require_password, false),
         password_hash         = v_hash,
         allowed_email_domains = p_allowed_email_domains,
         expires_at            = p_expires_at
   where id = p_share_id
  returning * into v_share;

  return v_share;
end;
$$;

revoke all on function update_share(uuid, text, boolean, boolean, text, text[], timestamptz) from public, anon;
grant execute on function update_share(uuid, text, boolean, boolean, text, text[], timestamptz) to authenticated;
