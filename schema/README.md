# Schema

Apply every numbered file directly in this folder, in order, `001` through `035`, via the Supabase SQL Editor (or `psql`). Never apply anything in `tests/` — those are destructive test programs for a scratch database only. The chain at v1.2:

1. `001_init.sql` — tables, indexes, RLS, REVOKEs
2. `002_rpcs.sql` — SECURITY DEFINER RPCs (`start_session`, `update_session`, `create_share`, `verify_share_password`)
3. `003_triggers.sql` — doc cap enforcement + first-open email notification + notifications_log
4. `004_password_security.sql` — per-slug rate limit on password verify + minimum length bump
5. `005_security_followup.sql` — disposable-email blocklist + error obfuscation
6. `006_observability.sql` — `app_events` / `error_log` / `feedback` tables + `share.first_view` event + `notify_on_feedback` + `recent_events` view
7. `007_share_edit.sql` — `update_share` RPC (edit gates/expiry without re-creating)
8. `008_email_allowlist.sql` — `allowed_email_domains` + `allowed_emails` columns + validation
9. `009_attachments.sql` — `document_attachments` table + `set_share_allow_download` RPC (later superseded by 015)
10. `010_email_template.sql` — branded first-open email body
11. `011_section_events_cleanup.sql` — meta-pattern section title filter
12. `012_viewer_is_internal.sql` — `viewers.is_internal` + `toggle_viewer_internal` RPC + skip-internal notification gate
13. `013_internal_viewer_no_notify.sql` — followup hardening on (12)
14. `014_fix_notify_status.sql` — repair status enum for `notify_on_first_open`
15. `015_lock_deck_rename.sql` — rename `allow_download` → `lock_deck`, flip semantic; new `set_share_lock_deck` RPC
16. `016_attachment_downloads.sql` — `attachment_downloads` columns: viewer_id, session_id, filename, size_bytes
17. `017_doc_last_viewed.sql` — `documents.last_viewed_by_owner_at` for /docs activity dot
18. `018_document_versions.sql` — version history table + v1 backfill for existing docs
19. `019_document_versions_rls_insert.sql` — missing INSERT/UPDATE policies on `document_versions`

Every migration uses `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DO $$ ... IF NOT EXISTS ... $$`, etc., so re-running any of them is safe.

## Secrets via Supabase Vault (works on free tier)

Resend uses Supabase Vault for the API key and the sender address. Set once in SQL Editor:

```sql
select vault.create_secret('re_your_resend_api_key', 'resend_api_key');
select vault.create_secret('hello@htmlradar.com',     'resend_from');
```

(Vault is a native Supabase feature — built on pgsodium, available on every tier.)

If the Vault secrets are missing, `notify_on_first_open` writes a row to `notifications_log` with status `skipped` and the rest of the product still works — only the email notifications no-op.

## Why no `ALTER DATABASE SET app.*` GUCs?

Earlier drafts used `current_setting('app.session_secret')` and `ALTER DATABASE postgres SET app.* = ...` to inject configuration. Supabase free (and Pro without Custom Postgres Config) **doesn't grant superuser**, so `ALTER DATABASE SET` fails with `42501: permission denied`. We switched to:

- **Session bearer tokens** stored on the `sessions.token` column (replaces the HMAC-with-shared-secret scheme entirely — no app secret needed).
- **Vault** for Resend secrets (decrypted at trigger execution time).

## Tables (15)

- `profiles` — mirrors `auth.users`, adds `tier` (`free` | `pro`).
- `documents` — uploaded HTML or pasted URL; `current_version`, `r2_key`, and `last_viewed_by_owner_at`.
- `document_versions` (018) — one row per upload or replace, capturing original local filename + bytes + R2 key.
- `document_shares` — per-recipient tracked links; password / expiry / revoke / `allowed_email_domains` / `allowed_emails` / `lock_deck` per share.
- `document_attachments` (009) — file metadata per share (PDF / Office / image / ZIP), bytes in R2.
- `attachment_downloads` (016) — per-viewer download log keyed on viewer_id + session_id + filename + size_bytes.
- `viewers` — recipient identities (email or anonymous fingerprint), scoped per share; `is_internal` flag (012) hides owner-self test reads.
- `sessions` — one row per page-open; `token` is the per-session bearer credential returned to the tracker. `document_version` records which version this session saw.
- `section_events` — section-level dwell records, deduped via `unique (session_id, section_id)`.
- `notifications_log` (003) — observability for the `notify_on_first_open` trigger; status enum `queued / delivered / failed / skipped`.
- `app_events` (006) — PostHog-shaped product events (`distinct_id`, `event`, `properties`, `user_id`).
- `error_log` (006) — client/server/worker JS error sink.
- `feedback` (006) — user-submitted feedback from `/feedback`.
- `rate_limits` — identity-keyed rate-limit counters for RPCs.
- `waitlist` — legacy pre-launch capture surface, retained but not actively used post-launch.

## RPCs (8)

Recipient-side (anon, SECURITY DEFINER):

- `start_session`, `update_session`, `verify_share_password`

Owner-side (authenticated, SECURITY DEFINER, invoked from server actions):

- `create_share`, `update_share` (007), `set_share_lock_deck` (015), `toggle_viewer_internal` (012)

## RLS posture

- Authenticated users see only their own data via owner-scoped policies.
- Anon has no direct table access (`revoke`d explicitly).
- Anon's only write surface is the three recipient RPCs above, each rate-limited and input-validated.

## Testing

Verify the tables exist:

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
-- Expect 15 rows: app_events, attachment_downloads, document_attachments,
-- document_shares, document_versions, documents, error_log, feedback,
-- notifications_log, profiles, rate_limits, section_events, sessions,
-- viewers, waitlist
```

Manually invoke an RPC:

```sql
select start_session(
  p_share_slug   := 'swift-falcon-a3f2',
  p_email        := 'test@example.com',
  p_fingerprint  := null,
  p_referrer     := 'https://example.com',
  p_user_agent   := 'Mozilla/5.0 ...'
);
```
