# Schema

Apply every numbered file directly in this folder, in ascending numeric order, starting at `001`, via the Supabase SQL Editor (or `psql`). No last file is named here on purpose — the folder grows, and a number written down goes stale the next time it does. As of this commit it ends at `047_radar_drafts.sql`. Never apply anything in `tests/` — those are destructive test programs for a scratch database only.

Two extensions are required and `001_init.sql` creates both: `pgcrypto` and `pg_net`. A third, `pg_cron`, is optional; `044` and `045` use it for scheduling and skip that step with a notice where it is absent.

The first nineteen files, as an illustration of the shape:

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

## Tables (29)

Twenty of them carry a note below. The other nine are single-purpose and named by their migration:
`analytics_replay_cursor` (029), `app_error_log` (024), `cancellation_feedback` (023),
`webhook_events_log` (022), `connect_handles` (045), `connector_grants` and `connector_events` (046),
`radar_drafts` and `radar_post_reservations` (047).

- `profiles` — mirrors `auth.users`, adds `tier` (`free` | `pro`). `handle` (043) is the account's subdomain label — links are served from `{handle}.htmlradar.page`. Nullable and null on every row until a later lane allocates one; immutable once set; three to twenty-four lowercase letters, digits and hyphens with no two hyphens in a row, which is also what bans a Punycode `xn--` prefix. It is a routing and reputation boundary, **not** an identity claim about the sender.
- `documents` — uploaded HTML or pasted URL; `current_version`, `r2_key`, `last_viewed_by_owner_at`, and the upload-time phishing screen's `screen_score` / `screen_signals` (039; null on every URL-source document and on everything predating the migration).
- `document_versions` (018) — one row per upload or replace, capturing original local filename + bytes + R2 key.
- `document_shares` — per-recipient tracked links; password / expiry / revoke / `allowed_email_domains` / `allowed_emails` / `lock_deck` per share. `host_handle` (043) is the hostname this link was created for: null means it is served on the apex forever, a value means `{host_handle}.htmlradar.page`. Immutable, and a trigger requires it to equal the owner's own handle when set — without that a customer could have their document served on `microsoft.htmlradar.page`. Routing follows this column, never `profiles.handle`, so an already-sent link never moves.
- `document_attachments` (009) — file metadata per share (PDF / Office / image / ZIP), bytes in R2.
- `attachment_downloads` (016) — per-viewer download log keyed on viewer_id + session_id + filename + size_bytes.
- `viewers` — recipient identities (email or anonymous fingerprint), scoped per share; `is_internal` flag (012) hides owner-self test reads — narrowed in `036_internal_viewers_owner_only.sql` to the owner's own address, so colleagues on the sender's own email domain are ordinary, visible recipients.
- `sessions` — one row per page-open; `token` is the per-session bearer credential returned to the tracker. `document_version` records which version this session saw.
- `section_events` — section-level dwell records, deduped via `unique (session_id, section_id)`.
- `notifications_log` (003) — observability for the `notify_on_first_open` trigger; status enum `queued / delivered / failed / skipped / sent / unverified` (the last two added in 044). Nothing used to move a row off `queued` — 044's `reconcile_notification_sends()` closes that: joined against `net._http_response` by `request_id`, a 2xx becomes `sent`, anything else becomes `failed` with the code in `error_message`, and a `queued` row older than 30 minutes with no response row left at all (pg_net's own retention already dropped it) becomes `unverified` rather than a guess either way.
- `app_events` (006) — PostHog-shaped product events (`distinct_id`, `event`, `properties`, `user_id`).
- `error_log` (006) — client/server/worker JS error sink.
- `feedback` (006) — user-submitted feedback from `/feedback`.
- `api_keys` (034) — public-API credentials, one row per key; the key itself is stored only as a SHA-256 hash. `scope` (040) is exactly `full` or `read_only`; a read-only key is refused at the routes that create, revoke or replace, and the check lives in the application because those routes run as the service role. The application's read fails closed: only the exact string `full` grants full access, so an unexpected value is treated as read-only.
- `rate_limits` — identity-keyed rate-limit counters for RPCs.
- `waitlist` — legacy pre-launch capture surface, retained but not actively used post-launch.
- `abuse_reports` (037) — one row per abuse report. A recipient's report names a share; an automated upload-screen flag names a document instead (039), which is why `share_id` is nullable and `document_id` exists. RLS on with no policies, so no customer-facing role can read or write it; the operator reads it with the service role. See `docs/workstreams/security/ABUSE-RUNBOOK.md`.
- `telegram_outbox` (038) — every Telegram message the monitor worker sends, and every thread-scan run whether it sent anything or not. Exists because a Telegram bot cannot read back its own sent history. `kind` also allows `heartbeat` (a maintenance session stamping the register) and `sentinel` (the daily report on the register's machine-checkable duties) as of 041. RLS on with no policies; the worker writes with the service role.
- `radar_items` (042) — every item the listening radar sees on Hacker News, Reddit and Google Alerts, upserted on `source_url` so re-seeing a thread refreshes it rather than duplicating it. RLS on with no policies; the monitor worker reads and writes with the service role.
- `handle_registry` (043) — every subdomain label that is spoken for: 193 reserved names seeded with `claimed_by` null, plus one row per allocated handle. Rows are never deleted, only stamped `released_at` when the holding profile goes, so a retired handle can never be inherited by a new account along with the old one's hostname reputation. `claimed_by` is deliberately **not** a foreign key — a key would cascade the row away on account deletion, which is the failure the table exists to prevent. Its primary key is also what resolves two simultaneous allocations of the same name. RLS on with no policies.

## Views (2)

Both follow the same private-view pattern: `security_invoker` set explicitly, then every grant revoked and re-granted narrowly. Supabase's default privileges hand new objects in `public` to `anon` and `authenticated`, and PostgREST publishes every view in `public`, so the REVOKE is a control rather than tidiness.

- `recent_events` (006) — the last seven days of `app_events` joined to the user's email. `security_invoker = on`; granted to `authenticated` and `service_role`.
- `share_lookup` (043) — everything the proxy needs to answer one recipient request in a single read: the share, its stored `host_handle`, the owner's handle and tier, and the document's R2 key, version and soft-delete state. `security_invoker = off`; **service role only**, because it carries every customer's handle and every document's storage key. The password hash is deliberately absent — password checks go through the rate-limited `verify_share_password` RPC.

## RPCs (11)

Recipient-side (anon, SECURITY DEFINER):

- `start_session`, `update_session`, `verify_share_password`

Owner-side (authenticated, SECURITY DEFINER, invoked from server actions):

- `create_share`, `update_share` (007), `set_share_lock_deck` (015), `toggle_viewer_internal` (012)

Server-side only (service role, SECURITY DEFINER, invoked by the proxy worker and the public API):

- `create_share_as` (034), `notify_disabled_attempt` (028), `report_abuse` (037), `reconcile_notification_sends` (044) — scheduled every 10 minutes via `pg_cron` (`select cron.schedule('reconcile_notification_sends', '*/10 * * * *', ...)`); on a Postgres without `pg_cron` (a self-hosted install, a scratch test database) the migration logs a notice and skips scheduling instead of failing, so the function still exists and can be called by hand or by an external scheduler.

## RLS posture

- Authenticated users see only their own data via owner-scoped policies.
- Anon has no direct table access (`revoke`d explicitly).
- Anon's only write surface is the three recipient RPCs above, each rate-limited and input-validated.

## Testing

Verify the tables exist:

```sql
select count(*) from pg_tables where schemaname = 'public';
-- 29 after the full chain through 047. Applying the chain a second time
-- leaves the count unchanged; that is what "idempotent" is being claimed to
-- mean here, and it is checked rather than asserted.

select tablename from pg_tables where schemaname = 'public' order by tablename;
-- abuse_reports, analytics_replay_cursor, api_keys, app_error_log, app_events,
-- attachment_downloads, cancellation_feedback, connect_handles,
-- connector_events, connector_grants, document_attachments, document_shares,
-- document_versions, documents, error_log, feedback, handle_registry,
-- notifications_log, profiles, radar_drafts, radar_items,
-- radar_post_reservations, rate_limits, section_events, sessions,
-- telegram_outbox, viewers, waitlist, webhook_events_log
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
