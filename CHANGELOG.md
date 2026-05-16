# Changelog

Notable changes between releases. Following [Keep a Changelog](https://keepachangelog.com/) loosely.

---

## v1.1 — 2026-05-16

A feedback-driven iteration after the v1.0 launch. Two themes: a meaningfully more polished recipient experience, and a real data-room workflow for senders who need to send supporting files alongside the HTML deck.

### Added

- **Supporting materials.** Attach PDFs, Office docs, images, CSVs, and ZIPs to a document. Per-share `Allow downloads` toggle (default off) controls whether the recipient sees the materials panel at all. When off, the recipient sees no signal that attachments exist. Every download is tracked with recipient email, timestamp, and CF-detected country.
  - Free tier: 20 attachments per doc · 25 MB each · 100 MB total
  - Pro tier: 50 attachments per doc · 100 MB each · 1 GB total
- **Per-email allow-list** alongside the existing domain allow-list. Union semantics: a recipient passes the gate if their address matches either list.
- **Edit share settings** without revoke + recreate. Change recipient label, password, expiry, allow-lists, download permission — all on a live share, analytics preserved.
- **Preview document as the sender.** New "Preview document" button on the doc detail page opens the raw uploaded HTML via the proxy with an HMAC-signed token. No gate, no tracker. Lets the sender verify their upload before creating any share.
- **"Preview as you"** on a share — same idea, but bound to a specific share so the sender can see exactly what the recipient sees, gates bypassed.
- **Consolidated SharesTable** on `/docs/[id]` — every share for the document with status, viewers, sessions, avg active, max scroll, last open. At-a-glance summary above the share manager.

### Changed

- **Recipient gate redesign.** Every gate state (email, password, revoked, expired, not-found, source-unreachable) re-skinned in the editorial cream-paper + Fraunces serif + oxblood palette of the marketing site. Mobile-first, generous whitespace, OG meta tags for clean link-unfurls in Slack and iMessage.
- **Email gate fix (P0).** Proxy now hard-gates on `require_email` directly instead of delegating to the tracker's Shadow DOM gate. The old behaviour incorrectly let a recipient who'd entered their email on share A bypass share B's gate from the same browser — even when the two shares were meant for different recipients. The proxy-issued email cookie has always been HMAC-scoped per slug, so the fix was a one-line predicate change; the previous code path is unreachable now.
- **ACTIVE/Revoked toggle UX.** The label now says "Revoked" (not "Off"), a transient "Reactivated · saved" / "Revoked · saved" caption appears after the action settles, and a `title` attribute explains what flips. Backend was already correct; the issue was visibility of the change.
- **Delete-document warning** is explicit that analytics for past reads will stop being visible. Soft-delete behaviour unchanged.
- **Pricing model.** Pro tier ($15/mo) is now defined by what's actually built — unlimited documents, 10× attachment headroom, no recipient chrome, priority support. The "coming soon" features that were inside the Pro tier on the v1.0 pricing page moved to a separate Roadmap section linked to public GitHub issues.

### Security

- New `verifyOwnerDocPreviewToken` HMAC verifier on the proxy; share-preview tokens and doc-preview tokens use different message prefixes so capture of one cannot be replayed as the other.
- Attachment downloads cascade through the same gate sequence as the document itself (revoked / expired / password / email / allow-list), AND require that the attachment's `document_id` matches the share's `document_id`. No cross-doc enumeration.
- Attachment uploads use a server-side extension allowlist (PDF, Office, images, CSV, MD, RTF, TXT, ZIP). `Content-Type` at serve time is derived from the extension map server-side; the user-provided MIME is never trusted. `.html`, `.js`, `.svg`, and executables are intentionally rejected.
- Filenames sanitised on upload: path separators, control characters, and non-ASCII bytes are stripped. Output is safe to embed in `Content-Disposition: attachment; filename="..."` headers.

### Tests

- 23 proxy tests (up from 18 in v1.0): added 5 around the new owner-doc-preview verifier including replay-prefix isolation.
- 20 new app-side unit tests for the attachment sanitiser + validator (path-traversal, script-extension rejection, MIME spoofing, size cap, allowlist hits).
- All 17 tracker tests still pass unchanged.

### Migrations required for self-hosters

Three new files; apply in order via the Supabase SQL editor. Each is idempotent.

- `schema/007_share_edit.sql` — `update_share` RPC
- `schema/008_email_allowlist.sql` — `allowed_emails text[]` column + recreated `create_share` / `update_share` signatures
- `schema/009_attachments.sql` — `document_attachments` table, `attachment_downloads` table, `document_shares.allow_download` column, `set_share_allow_download` RPC

### Ops note

- `SESSION_SECRET` env var must be present on both the app deploy (Cloudflare Pages) AND the proxy worker (`wrangler.toml`). Required by the new sender-preview HMAC tokens. If the two diverge, preview tokens silently fall through to the email gate — no error, just no bypass.

---

## v1.0 — 2026-05-13

Initial public launch. Section-level dwell tracking for HTML documents on Cloudflare + Supabase. AGPL-3.0.

Architecture: three packages (tracker, proxy, app). One Cloudflare Worker handles the recipient-side flow at `/r/{slug}`. The tracker is a 14 KB browser IIFE built against PostgREST directly (no `@supabase/supabase-js` runtime). Two vendors, free tier covers personal use end-to-end.

Engineering deep-dive: [htmlradar.com/blog/how-we-built-htmlradar](https://htmlradar.com/blog/how-we-built-htmlradar)
