# Schema

Apply in order via the Supabase SQL Editor (or `psql`):

1. `001_init.sql` — tables, indexes, RLS, REVOKEs
2. `002_rpcs.sql` — SECURITY DEFINER RPCs (`start_session`, `update_session`, `create_share`, `verify_share_password`)
3. `003_triggers.sql` — doc cap enforcement + first-open email notification + notifications_log

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

## Tables

- `profiles` — mirrors `auth.users`, adds `tier` (`free` | `pro`).
- `documents` — uploaded HTML or pasted URL; `current_version` bumps when re-uploaded.
- `document_shares` — per-recipient tracked links; password / expiry / revoke / domain-allowlist per share.
- `viewers` — recipient identities (email or anonymous fingerprint), scoped per share.
- `sessions` — one row per page-open; `token` is the per-session bearer credential returned to the tracker.
- `section_events` — section-level dwell records, deduped via `unique (session_id, section_id)`.
- `notifications_log` — observability for the `notify_on_first_open` trigger.
- `waitlist` — v1.1 paid feature waitlist.
- `rate_limits` — IP/identity-keyed rate-limit counters for RPCs.

## RLS posture

- Authenticated users see only their own data via owner-scoped policies.
- Anon has no direct table access (`revoke`d explicitly).
- Anon's only write surface is the four SECURITY DEFINER RPCs in `002_rpcs.sql`, each rate-limited and input-validated.

## Testing

Verify the tables exist:

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
-- Expect 9 rows: document_shares, documents, notifications_log, profiles,
-- rate_limits, section_events, sessions, viewers, waitlist
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
