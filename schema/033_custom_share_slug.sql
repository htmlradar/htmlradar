-- 033_custom_share_slug.sql
-- ------------------------------------------------------------
-- Pro customers may choose the last segment of a tracked link's address:
--   htmlradar.com/r/acme-proposal   instead of
--   htmlradar.com/r/swift-falcon-a3f9c2
-- Optional. Blank still generates one. Set once at creation, never editable.
--
-- WHY THIS IS ENFORCED IN THE DATABASE AND NOT IN TYPESCRIPT
--
-- The RLS policy on document_shares (001) is
--     for all to authenticated using (owner_id = auth.uid())
--                                with check (owner_id = auth.uid())
-- so any signed-in customer can POST straight to
--     /rest/v1/document_shares  {"document_id":..., "slug":"acme-proposal", ...}
-- through PostgREST with the public anon key and never touch a line of our
-- application code. Same shape as the profiles privilege escalation fixed in
-- 032: RLS scopes ROWS, not COLUMNS or VALUES. An entitlement check written
-- only in a server action is therefore not a control. The triggers below are
-- the control; the app checks are UX.
--
-- WHY A CHOSEN ADDRESS CANNOT BE HARD-DELETED
--
-- A chosen address is memorable, so an old email can still be sitting in a
-- recipient's inbox months later. If the address were freed, that recipient
-- would land on a DIFFERENT customer's document. `slug` is already `unique`,
-- and revoking keeps the row, so the only thing that ever frees an address is
-- the hard delete in deleteShareAction. Blocking that delete for chosen
-- addresses is all the protection needed — no side table, no retirement log.
--
-- Generated addresses keep today's behaviour and are still hard-deletable:
-- the 24-bit random suffix makes an accidental collision negligible.
--
-- OPERATIONAL NOTE — CASCADES. document_shares.owner_id and .document_id are
-- both `on delete cascade`. The delete guard below therefore also blocks a
-- cascade: deleting an auth.users row (e.g. a GDPR erasure) or hard-deleting
-- a document that owns a chosen-address share will fail with slug_is_custom.
-- Nothing in the app does either today — documents are soft-deleted via
-- deleted_at, and the one hard delete in new/actions.ts rolls back a
-- brand-new document that cannot have shares yet. For a genuine erasure, run
--     alter table document_shares disable trigger trg_block_custom_slug_delete;
--     -- do the deletion --
--     alter table document_shares enable  trigger trg_block_custom_slug_delete;
-- rather than weakening the guard, so freeing an address stays a deliberate
-- act by a human.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (add-column-if-not-exists + drop-if-exists + create-or-replace).
--
-- ORDERING: run this BEFORE deploying the app code that passes p_slug. The
-- old 8-argument create_share is dropped here, so a deploy that calls the
-- 9-argument form against an un-migrated database would 404 on the RPC.
-- Running the migration first is safe on its own: p_slug defaults to null,
-- which reproduces today's behaviour exactly.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Which addresses were chosen rather than generated
--
-- This column is NEVER trusted from the client. The validation trigger
-- computes it on INSERT and refuses to let it change on UPDATE. Without that,
-- a signed-in customer could PATCH slug_is_custom back to false through
-- PostgREST and then hard-delete the row, freeing the address — the exact
-- column-versus-row RLS gap that 032 was written to close.
-- ------------------------------------------------------------
alter table document_shares
  add column if not exists slug_is_custom boolean not null default false;

comment on column document_shares.slug_is_custom is
  'True when the owner chose this address rather than the generator producing it. Set by the validate_share_slug trigger, immutable afterwards, and blocks hard deletion so the address can never be handed to someone else.';

-- ------------------------------------------------------------
-- 2. Validation, immutability and entitlement
--
-- Reserved words. Two groups:
--   (a) impersonation bait — login, billing, verify, secure, htmlradar…
--       A memorable address on our own domain serving sender-supplied HTML is
--       a better phishing tool than a random one; these are the words that
--       make it worse.
--   (b) route-shaped words — auth, email, m, _doc.
--       For accuracy: auth/email/m are sub-paths that follow a slug in the
--       proxy (/r/{slug}/auth), not top-level collisions, and _doc cannot
--       reach here anyway because the format regex forbids a leading
--       underscore. They are reserved for future route safety and to stop
--       links that read like system URLs, not because they break routing now.
--
-- "Generated or chosen?" is answered by a transaction-local GUC that
-- create_share sets to the exact slug it just generated. A client cannot set
-- it: PostgREST exposes only functions in the public schema, and set_config
-- lives in pg_catalog. Binding it to the value rather than a boolean means a
-- stale setting cannot launder a different slug.
--
-- SECURITY DEFINER so the tier read is the real tier, not whatever the
-- caller's RLS view of profiles happens to allow.
-- ------------------------------------------------------------
create or replace function validate_share_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier      text;
  v_generated text := nullif(current_setting('app.generated_slug', true), '');
  v_reserved  text[] := array[
    'login', 'signin', 'sign-in', 'support', 'verify', 'account', 'accounts',
    'billing', 'payment', 'payments', 'invoice', 'secure', 'admin', 'api',
    'htmlradar', 'www', 'mail', 'auth', 'email', 'm', '_doc'
  ];
begin
  -- The address is permanent. It is already in somebody's inbox. So is the
  -- flag that protects it.
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then
      raise exception 'slug_immutable'
        using errcode = 'P0035',
              hint = 'A link address cannot be changed after the link is created.';
    end if;
    if new.slug_is_custom is distinct from old.slug_is_custom then
      raise exception 'slug_immutable'
        using errcode = 'P0035',
              hint = 'A link address cannot be changed after the link is created.';
    end if;
    return new;
  end if;

  if new.slug !~ '^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$' then
    raise exception 'slug_invalid_format'
      using errcode = 'P0032',
            hint = 'Use 3 to 60 characters: lowercase letters, numbers and hyphens, starting and ending with a letter or number.';
  end if;

  if new.slug = any (v_reserved) then
    raise exception 'slug_reserved'
      using errcode = 'P0033',
            hint = 'That ending is reserved. Please choose another.';
  end if;

  -- Checked here as well as by the unique index so the customer gets one
  -- clear message instead of a raw 23505.
  if exists (select 1 from document_shares where slug = new.slug) then
    raise exception 'slug_unavailable'
      using errcode = 'P0034',
            hint = 'That link ending is not available. Please choose another.';
  end if;

  -- Computed, never taken from the client.
  new.slug_is_custom := (new.slug is distinct from v_generated);

  if new.slug_is_custom then
    select tier into v_tier from profiles where id = new.owner_id;
    if v_tier is distinct from 'pro' then
      raise exception 'slug_requires_pro'
        using errcode = 'P0036',
              hint = 'Choosing your own link ending is a Pro feature. Upgrade to Pro, or leave the ending blank and we will generate one.';
    end if;
  end if;

  return new;
end;
$$;

-- Named to sort AFTER trg_enforce_share_cap (027): BEFORE triggers fire in
-- name order, and a free customer over their link cap should be told about
-- the cap, which is the thing they can act on.
drop trigger if exists trg_validate_share_slug on document_shares;
create trigger trg_validate_share_slug
  before insert or update on document_shares
  for each row execute function validate_share_slug();

-- ------------------------------------------------------------
-- 3. A chosen address can be switched off, never deleted
--
-- Revoke keeps the row, so the unique index keeps holding the address. That
-- is the whole mechanism; this trigger just removes the one escape hatch.
-- ------------------------------------------------------------
create or replace function block_custom_slug_delete()
returns trigger
language plpgsql
as $$
begin
  if old.slug_is_custom then
    raise exception 'slug_is_custom'
      using errcode = 'P0037',
            hint = 'This link''s address was chosen by you and is permanent — the people you sent it to are using it. Revoke the link to switch it off instead.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_block_custom_slug_delete on document_shares;
create trigger trg_block_custom_slug_delete
  before delete on document_shares
  for each row execute function block_custom_slug_delete();

-- ------------------------------------------------------------
-- 4. create_share gains an optional address
--
-- p_slug is LAST and defaults to null so every existing call site keeps
-- working unchanged. The previous 8-argument signature is dropped rather than
-- left in place: two overloads that both accept the old named arguments make
-- the PostgREST call ambiguous.
--
-- Validation is NOT duplicated here. The trigger is the control; this
-- function only normalises (lowercase + trim) and lets the trigger judge.
-- ------------------------------------------------------------
drop function if exists create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz);

create or replace function create_share(
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

  v_slug := nullif(lower(trim(coalesce(p_slug, ''))), '');

  if v_slug is null then
    loop
      v_slug := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
             || '-' || v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int]
             || '-' || encode(gen_random_bytes(3), 'hex');
      exit when not exists (select 1 from document_shares where slug = v_slug);
    end loop;
    -- Tell the validation trigger this exact slug came from us, so it marks
    -- the row generated and skips the Pro check. Transaction-local: gone at
    -- commit.
    perform set_config('app.generated_slug', v_slug, true);
  end if;

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

revoke all on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz, text) from public, anon;
grant execute on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz, text) to authenticated;
