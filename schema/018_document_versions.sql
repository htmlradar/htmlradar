-- 018_document_versions.sql
-- ------------------------------------------------------------
-- Document version history. Captures the filename + bytes + r2_key of
-- every upload AND every replace, so the sender can see "what's
-- currently active" + "what came before, when."
--
-- Today the `documents` table has `current_version` (int) that
-- increments on replace, but we throw away the prior filename. User
-- request 2026-05-19: "when I update a particular document, I need a
-- log somewhere of what upload I've actually got. What is the latest
-- version's actual file name."
--
-- Schema:
--   document_id   FK
--   version       integer ladder (1, 2, 3, …); matches documents.current_version
--                 at the latest row
--   filename      original local filename at upload time
--   bytes         size at upload time
--   source_type   'upload' | 'url' (same enum semantics as documents)
--   source_url    if source_type = 'url', the URL we fetched from
--   r2_key        R2 object key (where the bytes live)
--   replaced_by   FK to profiles — who did the upload/replace
--   replaced_at   timestamp of the upload/replace
--
-- The latest row's `version` matches the current documents.current_version;
-- earlier rows have smaller versions. Active version is implied by
-- being the row with max(version) for that document_id.
--
-- UI surface (separate from this migration): /docs/[id] hero's
-- version chip becomes a popover trigger — click to see all versions
-- with timestamps + filenames + active badge.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create table if not exists document_versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references documents(id) on delete cascade,
  version         integer not null,
  filename        text,
  bytes           bigint,
  source_type     text not null check (source_type in ('upload', 'url')),
  source_url      text,
  r2_key          text,
  replaced_by     uuid references auth.users(id),
  replaced_at     timestamptz not null default now(),
  unique (document_id, version)
);

create index if not exists idx_document_versions_doc on document_versions (document_id, version desc);

alter table document_versions enable row level security;

-- Owner-only reads of own document's version history.
drop policy if exists "document_versions_owner_select" on document_versions;
create policy "document_versions_owner_select" on document_versions
  for select using (
    exists (
      select 1 from documents d
      where d.id = document_versions.document_id and d.owner_id = auth.uid()
    )
  );

-- The app's server actions write via service-role (auth-gated in the
-- action code itself, not via RLS). Recipients never touch this table.
revoke all on document_versions from anon;

-- Backfill: for documents already in the system, create a v1 row from
-- the document's current state. This way existing docs aren't blank in
-- the version history. (Only runs once — idempotent via NOT EXISTS.)
insert into document_versions (document_id, version, filename, bytes, source_type, source_url, r2_key, replaced_by, replaced_at)
select
  d.id,
  coalesce(d.current_version, 1),
  d.title,                          -- approximate; we threw away the orig filename
  null,                             -- bytes unknown for legacy rows
  d.source_type,
  d.source_url,
  null,                             -- r2 key unknown for legacy rows
  d.owner_id,
  d.created_at
from documents d
where not exists (
  select 1 from document_versions v where v.document_id = d.id
);
