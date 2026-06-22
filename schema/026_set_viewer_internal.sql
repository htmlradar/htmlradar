-- 026_set_viewer_internal.sql
-- ------------------------------------------------------------
-- Set (not toggle) a viewer's is_internal flag, owner-scoped.
--
-- The dashboard "hide/unhide" action operates on a MERGED viewer group —
-- one person's email can back several viewer rows (same email across two
-- shares). toggle_viewer_internal (012) flips one row, so:
--   - hiding a merged group only changed one backing row (looked like a
--     no-op), and
--   - looping toggle across the rows would un-hide rows that were already
--     internal (e.g. a previously-hidden person opens a new share — the
--     group is now mixed, and toggle-all flips the hidden rows back).
-- A definite target state applied to every backing row fixes both. Same
-- ownership check as toggle_viewer_internal.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create or replace). The app falls back to toggle_viewer_internal until
-- this is applied, so deploy order doesn't matter — but hide/unhide of
-- merged multi-share viewers is only fully correct once this exists.
-- ------------------------------------------------------------

create or replace function set_viewer_internal(p_viewer_id uuid, p_internal boolean)
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
  set is_internal = p_internal
  where id = p_viewer_id
  returning is_internal into v_new_value;

  return v_new_value;
end;
$$;

grant execute on function set_viewer_internal(uuid, boolean) to authenticated;
