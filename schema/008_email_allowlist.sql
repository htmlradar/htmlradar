-- 008_email_allowlist.sql
-- ------------------------------------------------------------
-- Add a specific-email allowlist alongside the existing domain
-- allowlist. Founders often know the exact recipients (3 partners
-- at a fund, 5 colleagues at a portfolio co) — restricting by
-- whole domain over-shares.
--
-- Behaviour at the proxy gate (see packages/proxy/src/index.ts):
--   - No lists set        → anyone with a valid email passes
--   - Email list set      → entered email must appear in it
--   - Domain list set     → entered email's domain must appear in it
--   - Both lists set      → email passes if EITHER matches (union, not
--                            intersection — power-user case is "let
--                            these specific outsiders + everyone at
--                            this domain")
--
-- Function signatures change here: both create_share and update_share
-- gain a new text[] parameter (p_allowed_emails). Old signatures are
-- DROPped first because Postgres won't auto-replace differing-arity
-- overloads. Client code in actions.ts is updated in the same PR.
-- ------------------------------------------------------------

alter table document_shares
  add column if not exists allowed_emails text[];

-- Drop the previous overloaded signatures (introduced in 002 / 004 / 007).
drop function if exists create_share(uuid, text, boolean, boolean, text, text[], timestamptz);
drop function if exists update_share(uuid, text, boolean, boolean, text, text[], timestamptz);

-- ------------------------------------------------------------
-- create_share with both allowlists
-- ------------------------------------------------------------
create or replace function create_share(
  p_document_id           uuid,
  p_recipient_label       text,
  p_require_email         boolean,
  p_require_password      boolean,
  p_password_plain        text,
  p_allowed_email_domains text[],
  p_allowed_emails        text[],
  p_expires_at            timestamptz
)
returns document_shares
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user_id    uuid := auth.uid();
  v_doc        documents%rowtype;
  v_slug       text;
  v_hash       text;
  v_share      document_shares%rowtype;
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
    allowed_email_domains, allowed_emails, expires_at
  )
  values (
    p_document_id, v_user_id, v_slug, p_recipient_label,
    coalesce(p_require_email, true), coalesce(p_require_password, false), v_hash,
    p_allowed_email_domains, p_allowed_emails, p_expires_at
  )
  returning * into v_share;

  return v_share;
end;
$$;

revoke all on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz) from public, anon;
grant execute on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz) to authenticated;

-- ------------------------------------------------------------
-- update_share with both allowlists
-- ------------------------------------------------------------
create or replace function update_share(
  p_share_id              uuid,
  p_recipient_label       text,
  p_require_email         boolean,
  p_require_password      boolean,
  p_password_plain        text,
  p_allowed_email_domains text[],
  p_allowed_emails        text[],
  p_expires_at            timestamptz
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

  select * into v_share from document_shares
   where id = p_share_id and owner_id = v_user_id;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0024';
  end if;

  if coalesce(p_require_password, false) then
    if p_password_plain is not null and length(p_password_plain) > 0 then
      if length(p_password_plain) < 8 then
        raise exception 'password_too_short' using errcode = 'P0022';
      end if;
      v_hash := crypt(p_password_plain, gen_salt('bf', 10));
    else
      v_hash := v_share.password_hash;
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
         allowed_emails        = p_allowed_emails,
         expires_at            = p_expires_at
   where id = p_share_id
  returning * into v_share;

  return v_share;
end;
$$;

revoke all on function update_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz) from public, anon;
grant execute on function update_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz) to authenticated;
