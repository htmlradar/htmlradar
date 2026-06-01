-- 017_doc_last_viewed.sql
-- ------------------------------------------------------------
-- Adds documents.last_viewed_by_owner_at so the /docs list can show
-- a "new activity since last visit" dot.
--
-- Semantics:
--   - Default: now() at row creation (avoids dot on freshly-created docs)
--   - Updated whenever the owner visits /docs/[id]
--   - Dot renders if any session.started_at > last_viewed_by_owner_at
--
-- Per-user-per-document so the dot is owner-scoped (multi-owner is a
-- future concern, not v1).
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'documents' and column_name = 'last_viewed_by_owner_at'
  ) then
    alter table documents
      add column last_viewed_by_owner_at timestamptz not null default now();
  end if;
end$$;
