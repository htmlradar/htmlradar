-- 050_document_creation_id.sql
-- Owner-scoped idempotency for browser uploads after sign-in. A lost response
-- can be retried with the same client identifier without creating another row.
-- The completion flag prevents an overlapping request from returning success
-- before the first request has stored the HTML.
-- Apply before deploying the converter. This migration has NOT been applied.

alter table documents
  add column if not exists client_creation_id uuid,
  add column if not exists client_upload_complete boolean not null default false;

create unique index if not exists documents_owner_client_creation_id
  on documents (owner_id, client_creation_id)
  where client_creation_id is not null;

-- Existing owner-scoped row policies remain in force. No anonymous creation
-- or cross-owner lookup is introduced.
