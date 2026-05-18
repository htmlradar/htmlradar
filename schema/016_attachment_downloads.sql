-- 016_attachment_downloads.sql
-- ------------------------------------------------------------
-- Strengthen per-viewer attribution on attachment_downloads.
--
-- Migration 009 created the attachment_downloads table with
-- recipient_email + country_code + device_type + user_agent — enough
-- for "someone with email X downloaded" but NOT enough to attribute
-- to a specific viewer row when the recipient hits the same share
-- across multiple sessions, devices, or anonymous reads.
--
-- This migration adds three columns:
--   viewer_id   FK to viewers — the canonical per-recipient identity
--   session_id  FK to sessions — links the download to the read that
--               produced it (so dashboards can show "Marc downloaded
--               financials.pdf during his 4m read at 14:32")
--   filename    snapshot at download time — survives a future rename
--               of the document_attachments row
--   size_bytes  snapshot at download time — same reason
--
-- All four are nullable so the existing rows (without these fields)
-- aren't disturbed and the proxy can backfill them at write time when
-- it has the info, leaving null when it doesn't (truly anonymous
-- download from an anonymous share).
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'attachment_downloads' and column_name = 'viewer_id'
  ) then
    alter table attachment_downloads
      add column viewer_id uuid references viewers(id) on delete set null;
    create index if not exists idx_attachment_downloads_viewer
      on attachment_downloads (viewer_id) where viewer_id is not null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'attachment_downloads' and column_name = 'session_id'
  ) then
    alter table attachment_downloads
      add column session_id uuid references sessions(id) on delete set null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'attachment_downloads' and column_name = 'filename'
  ) then
    alter table attachment_downloads add column filename text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'attachment_downloads' and column_name = 'size_bytes'
  ) then
    alter table attachment_downloads add column size_bytes bigint;
  end if;
end$$;

-- Useful query index for the dashboard's "downloads on this share,
-- newest first" surfacing.
create index if not exists idx_attachment_downloads_share_recent
  on attachment_downloads (share_id, downloaded_at desc);
