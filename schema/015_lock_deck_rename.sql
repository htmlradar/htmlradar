-- 015_lock_deck_rename.sql
-- ------------------------------------------------------------
-- Rename document_shares.allow_download → lock_deck and invert the
-- semantic so the column name matches the user's mental model.
--
-- Per QA3 + 2026-05-19 design discussion:
--   - Sender's only relevant toggle is "Lock the deck" — controls
--     deck save / print / screenshot / watermark behaviour
--   - Attachments are ALWAYS available to recipients when present
--     (no separate toggle — if you don't want a file shared, don't
--      attach it)
--
-- Old semantic                 → New semantic
--   allow_download = false       lock_deck = true   (default)
--   allow_download = true        lock_deck = false
--
-- Default flips too: shares default to lock_deck = true (i.e. the
-- protective mode is the safe default) — same effective default as
-- the old allow_download = false.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent — the
-- final block guards against re-runs.
-- ------------------------------------------------------------

do $$
begin
  -- 1. Add the new column with the safe default.
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'document_shares' and column_name = 'lock_deck'
  ) then
    alter table document_shares add column lock_deck boolean not null default true;
  end if;

  -- 2. Backfill from the existing allow_download values (still present
  --    at this point), inverting the semantic. Only runs if both columns
  --    exist (i.e. on first apply).
  if exists (
    select 1 from information_schema.columns
    where table_name = 'document_shares' and column_name = 'allow_download'
  ) then
    update document_shares set lock_deck = not allow_download;
    -- 3. Drop the now-redundant column.
    alter table document_shares drop column allow_download;
  end if;
end$$;

-- Drop the old surgical-toggle RPC (which still references the dropped
-- allow_download column) and replace with a lock-deck equivalent. The
-- semantic flip is encoded here: setting lock_deck = true LOCKS the
-- deck (opposite of allow_download = true which UNLOCKED it).
drop function if exists set_share_allow_download(uuid, boolean);

create or replace function set_share_lock_deck(
  p_share_id  uuid,
  p_lock_deck boolean
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  update document_shares
     set lock_deck = coalesce(p_lock_deck, true)  -- safe default: locked
   where id = p_share_id and owner_id = auth.uid();
  if not found then
    raise exception 'share_not_found' using errcode = 'P0024';
  end if;
end;
$$;

revoke all on function set_share_lock_deck(uuid, boolean) from public, anon;
grant execute on function set_share_lock_deck(uuid, boolean) to authenticated;
