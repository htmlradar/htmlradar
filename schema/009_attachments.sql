-- 009_attachments.sql
-- ------------------------------------------------------------
-- Supporting materials ("data room"): senders attach files to a
-- document; per-share `allow_download` controls whether the recipient
-- can download those files. Every download is tracked.
--
-- Architectural choices:
--   - HTMLRadar tracks reads on HTML. Attachments are stored & served
--     as-is. We do NOT render or page-track PDFs or any other format.
--     That keeps the HTML thesis intact: the deck is the primary
--     tracked artefact; attachments are supplementary downloads.
--   - Attachments belong to a document (not a share). One upload, many
--     shares. The download permission is per-share.
--   - R2 keys are namespaced under `attachments/{owner}/{doc}/{att}-{name}`
--     to keep them entirely separate from the existing `docs/...` keys
--     so a bug here cannot touch already-uploaded HTML payloads.
--   - allow_download defaults to FALSE. Privacy-by-default: the sender
--     opts in to downloads per share. Recipients on a share where it's
--     false never even see the materials panel — they have no signal
--     that attachments exist.
--   - Downloads are tracked in a dedicated table (NOT in app_events) so
--     the per-share analytics view can query a single index cheaply.
--
-- Re-running this file is safe (CREATE TABLE IF NOT EXISTS / ADD COLUMN
-- IF NOT EXISTS / CREATE POLICY IF NOT EXISTS not portable — we DROP
-- POLICY then recreate to make policy edits idempotent).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- document_attachments — what the sender uploaded
-- ------------------------------------------------------------
create table if not exists document_attachments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  -- denormalised owner so the RLS policy doesn't have to join documents.
  -- documents.owner_id is the source of truth — the upload action MUST
  -- set this to documents.owner_id; we don't synthesise it server-side.
  owner_id     uuid not null,
  filename     text not null,          -- sanitised, ASCII-safe, no path separators
  mime_type    text not null,          -- server-derived from extension, never user-provided
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 26214400),  -- 25 MB cap
  r2_key       text not null unique,   -- attachments/{owner}/{doc}/{att_id}-{name}
  created_at   timestamptz not null default now()
);

create index if not exists document_attachments_document_id_idx
  on document_attachments(document_id);

alter table document_attachments enable row level security;

-- Owners can read/insert/delete their own attachments. No update policy =
-- no updates possible (immutable once uploaded — replace by delete + re-upload).
drop policy if exists "owner reads own attachments" on document_attachments;
create policy "owner reads own attachments"
  on document_attachments for select
  using (owner_id = auth.uid());

drop policy if exists "owner inserts own attachments" on document_attachments;
create policy "owner inserts own attachments"
  on document_attachments for insert
  with check (owner_id = auth.uid());

drop policy if exists "owner deletes own attachments" on document_attachments;
create policy "owner deletes own attachments"
  on document_attachments for delete
  using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- document_shares.allow_download
-- ------------------------------------------------------------
-- Privacy-by-default: false. The sender flips this per share when they
-- want a recipient to be able to grab the materials. When false the
-- proxy returns 404 for the download route (don't even leak the
-- existence of attachments to that recipient).
alter table document_shares
  add column if not exists allow_download boolean not null default false;

-- ------------------------------------------------------------
-- set_share_allow_download — surgical toggle, called from server actions
-- ------------------------------------------------------------
-- Surgical RPC for flipping the boolean WITHOUT touching the more-complex
-- create_share / update_share signatures (which already manage password
-- hashing, slug generation, and allowlist arrays). Keeps the column
-- additive — no migration cascade on those RPCs every time we add a
-- per-share toggle.
create or replace function set_share_allow_download(
  p_share_id       uuid,
  p_allow_download boolean
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;
  update document_shares
     set allow_download = coalesce(p_allow_download, false)
   where id = p_share_id and owner_id = auth.uid();
  if not found then
    raise exception 'share_not_found' using errcode = 'P0024';
  end if;
end;
$$;

revoke all on function set_share_allow_download(uuid, boolean) from public, anon;
grant execute on function set_share_allow_download(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- attachment_downloads — recipient action log
-- ------------------------------------------------------------
-- One row per successful download. We bind to both the attachment and
-- the share so analytics can answer "who downloaded what for share X."
-- recipient_email is captured from the proxy's email gate cookie at
-- download time (the same email the recipient typed at the gate). If
-- the share isn't email-gated, recipient_email is null and the row
-- still serves as a "someone downloaded" signal.
create table if not exists attachment_downloads (
  id              uuid primary key default gen_random_uuid(),
  attachment_id   uuid not null references document_attachments(id) on delete cascade,
  share_id        uuid not null references document_shares(id) on delete cascade,
  recipient_email text,
  country_code    text,
  device_type     text,
  user_agent      text,
  downloaded_at   timestamptz not null default now()
);

create index if not exists attachment_downloads_share_id_idx
  on attachment_downloads(share_id);
create index if not exists attachment_downloads_attachment_id_idx
  on attachment_downloads(attachment_id);

alter table attachment_downloads enable row level security;

-- Sender-side reads of own download log (joined via attachment → owner).
drop policy if exists "owner reads own download log" on attachment_downloads;
create policy "owner reads own download log"
  on attachment_downloads for select
  using (
    exists (
      select 1
        from document_attachments a
       where a.id = attachment_downloads.attachment_id
         and a.owner_id = auth.uid()
    )
  );

-- No client insert/update/delete policy — proxy writes via service-role
-- which bypasses RLS. Recipients can't write directly.
