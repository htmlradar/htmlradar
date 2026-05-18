-- 019_document_versions_rls_insert.sql
-- ------------------------------------------------------------
-- Add the missing INSERT (+ UPDATE) policy on document_versions so
-- server actions running as the authenticated user can actually write
-- new version rows. Without this, migration 018's `enable row level
-- security` + only-SELECT policy silently rejected every history
-- insert from /new/actions.ts and replaceDocumentAction.
--
-- Found by the static-audit pass on 2026-05-19 — would have shipped
-- broken (popover showing "No versions recorded yet" on every fresh
-- upload).
--
-- Mirrors the pattern in schema/009_attachments.sql for
-- document_attachments: owner-only writes, gated by a join through
-- documents.owner_id.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

drop policy if exists "document_versions_owner_insert" on document_versions;
create policy "document_versions_owner_insert" on document_versions
  for insert with check (
    exists (
      select 1 from documents d
      where d.id = document_versions.document_id and d.owner_id = auth.uid()
    )
  );

drop policy if exists "document_versions_owner_update" on document_versions;
create policy "document_versions_owner_update" on document_versions
  for update using (
    exists (
      select 1 from documents d
      where d.id = document_versions.document_id and d.owner_id = auth.uid()
    )
  );

-- Grants — the `authenticated` role needs INSERT (the SELECT grant
-- came along with the SELECT policy in migration 018, but Supabase
-- doesn't auto-grant INSERT just from a policy existing).
grant insert, update on document_versions to authenticated;
