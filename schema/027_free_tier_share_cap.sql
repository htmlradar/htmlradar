-- 027_free_tier_share_cap.sql
-- ------------------------------------------------------------
-- Pricing v4: the free-tier lever moves from DOCUMENTS to SHARES.
--
-- Free tier = 2 tracked links (document_shares), LIFETIME. Documents are no
-- longer capped — a document with no share does nothing, so the share is the
-- value + conversion unit. LIFETIME means revoked/expired/old shares still
-- count, so free users can't rotate links forever (same intent the old doc
-- cap had). Pro = unlimited.
--
-- This retires enforce_doc_cap (003) and replaces it with enforce_share_cap.
-- The shape mirrors the doc-cap trigger exactly: tier check → advisory lock →
-- lifetime count → raise. document_shares already carries owner_id, so no join.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (drop-if-exists + create-or-replace). The app also enforces 2 on its own, so
-- deploy order can't break anything.
-- ------------------------------------------------------------

-- 1. Retire the document cap — shares are the lever now.
drop trigger if exists trg_enforce_doc_cap on documents;
drop function if exists enforce_doc_cap();

-- 2. Enforce the share cap at the DB (authoritative, race-safe). Pro exempt.
create or replace function enforce_share_cap()
returns trigger language plpgsql as $$
declare
  v_tier  text;
  v_count int;
  v_cap   int := 2;            -- free tier: 2 tracked links, lifetime
begin
  select tier into v_tier from profiles where id = new.owner_id;
  if v_tier = 'pro' then
    return new;
  end if;

  -- Serialise concurrent share creates per owner so two simultaneous inserts
  -- can't both slip past the cap. Lock releases at transaction end.
  perform pg_advisory_xact_lock(hashtext('share_cap:' || new.owner_id::text));

  -- Lifetime count: every share this owner ever created (revoked/expired
  -- included) — no slot rotation.
  select count(*) into v_count
  from document_shares
  where owner_id = new.owner_id;

  if v_count >= v_cap then
    raise exception 'free_tier_share_cap_reached'
      using errcode = 'P0031',
            hint = format(
              'Free tier is %s tracked links, lifetime. Upgrade to Pro for unlimited.',
              v_cap
            );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_share_cap on document_shares;
create trigger trg_enforce_share_cap
  before insert on document_shares
  for each row execute function enforce_share_cap();
