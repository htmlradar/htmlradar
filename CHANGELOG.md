# Changelog

Notable changes between releases. Following [Keep a Changelog](https://keepachangelog.com/) loosely.

---

## v1.1.2 — 2026-05-16

Post-QA polish round. The product now reads as a working dashboard, not a list. Highlights: per-viewer rollup across every share of a doc, a live-refreshing dashboard, auto-detected sections on any HTML (including plain prose), a properly branded first-open email, and a thorough mobile pass.

### Added

- **Per-viewer dashboard** on the doc detail page (`ViewerInsights`). A stat strip (Total viewers, Sessions, Avg read time, Avg scroll, Viewers today) plus a per-viewer table with email + country + device + referrer, total time, scroll-depth bar, visit count, first-seen and last-seen timestamps. Aggregated across every share of the document — one place to see who's actually engaging.
- **Live dashboard** (`LiveRefresh`). The doc detail page polls every 30 seconds while the tab is in focus, pauses when hidden, and shows a pulsing "Live · 30s" pill near the heading. New viewer rows + updated stats appear without a manual reload.
- **Smart section auto-detection.** The tracker now discovers sections from any HTML — explicit `[id]` anchors → bare `h1/h2/h3` (auto-slugified from text) → slide/page containers (`section`, `article`, `[class*="slide"]`, `[class*="page"]`, `[data-slide]`, `[data-page]`) → paragraph buckets on plain prose. Pure-text docs get up to 8 sections titled by the first sentence of each bucket. Sticky/fixed-positioned elements filtered out.
- **Branded first-open email.** Editorial HTML template — oxblood pill, serif headline with viewer email + doc title in italic, avatar chip with viewer initial, single "See the read →" CTA. Information design is a TEASE, not a report (no country / scroll % / read time in the email — those live in the dashboard).
- **OG card image** for link unfurls (`og-card.png`). 1200×630 brand card replaces the text-only WhatsApp / iMessage preview.
- **5-second session warm-up filter.** When the recipient lands on a share, session creation defers 5 seconds and bails if `document.hidden` becomes true. Filters bots, link-preview crawlers, and accidental taps — no inflated viewer counts, no spurious owner-notification emails. Skipped on the email-gate path (typing an email is already a strong human signal).
- **Referrer surfaced** in the dashboard viewer row and the email viewer chip ("just opened · mail.google.com" or "· Direct link"). Data was already captured in `viewers.referrer`; just never displayed.

### Changed

- **"Attachments" → "Files"** across the doc detail panel, share toggle, and `/new` page subhead. Sender-natural word; the relationship to the HTML deck is spelled out explicitly ("Files ride along with the HTML deck. We track downloads, not reads.").
- **`/docs` list augmentation.** Top stat strip (Documents / Active shares / Reads · 7d / Avg read · 7d), per-row mini-stats (share count + last opened), and a pulsing activity dot on docs with reads in the last 24 hours.
- **Doc-detail declutter for single-share docs.** When a doc has only one share, the redundant `At a glance` table and the duplicate stat-card row inside the share pane are hidden — the per-doc `ViewerInsights` strip is the single canonical surface. Both come back automatically with 2+ shares.
- **Soft section empty state.** Replaces the "splits read time by `<h2 id="…">`" technical jargon with one sentence: "Section dwell will land here on the next read — we auto-detect sections from your HTML at read time. Older reads from before this update won't show here."
- **Share-rail polish** — active share gets an oxblood left border. Delete button restyled to match Preview / Replace family.
- **Recipient gate copy** softened — dropped "The sender will see who opened it" (was surveillance-y). Just "Enter your email to continue." now.

### Fixed

- **iOS Safari zoom-on-focus** killed across every text input — sign-in, recipient gate, /new (title + URL), share-edit form (label / password / domains / emails / expires), feedback. Mobile font is now 16 px on all inputs.
- **Brand pill 44 px tap target** on the gate / 404 / error pages.
- **Pricing 2-col layout** at md+ breakpoint (was stacked at 768 px).
- **Landing notification mock** ("Example Ventures · 2m 41s on §03 The Ask · still active") now wraps cleanly on phones instead of truncating to "still …".
- **404 page CTA** — "What is HTMLRadar? →" return-home link.
- **Email notification delivery** — `resend_from` now points at a verified `@htmlradar.com` address (was the sandbox `onboarding@resend.dev` which Resend's free tier blocks for non-account-owner recipients).

### Tests

- 77 total across the three packages (was 68 in v1.1.1).
- Tracker: 26 (added 9 over v1.1.1: 6 for auto-section discovery + 3 for prose-paragraph bucketing).
- App: 28 (unchanged in v1.1.2; the 8 `resolveRecipientIdentity` tests were added in v1.1.1).
- Proxy: 23 (unchanged).

### Migrations required for self-hosters

- `schema/010_email_template.sql` — replaces the plain-text first-open email body with the new branded HTML template. `create or replace function` makes it idempotent.

### Ops notes

- Domain verification at Resend is now a prerequisite for first-open notifications to reach non-account-owner recipients. Verify your sending domain at `resend.com/domains` and set `resend_from` in `vault.secrets` to an address on that domain.

---

## v1.1.1 — 2026-05-16

Polish + bug-fix round driven by post-launch QA feedback. Sender-side correctness, brand consistency on every recipient surface, viewer identity in dashboards.

### Added

- **Replace HTML** in place via a new sender-side action — bump the document's version and `r2_key`, every existing share link continues to work and serves v2 on the next open.
- **Brand pill** (solid oxblood, top-right) on every gate state, every error state, and the viewed-doc free-tier badge.
- **OG meta image** stub for link unfurls (replaced in v1.1.2 with the real card).

### Changed

- **Sign-in flow.** Server-side session check on `/sign-in` redirects an already-authed user straight to `/docs`. Landing CTAs ("Start free") become "Open dashboard" → `/docs` when authed. Stops the OAuth-callback loop when clicking the CTA while already signed in.
- **Preview document / Preview as you.** Server action returns the proxy URL and the client navigates with `window.location.href` (was: `redirect()` from the action, which Next.js 14 intercepts via the client router and routes through the in-app route tree — `/r/_doc/...` then 404s in `not-found.tsx` instead of hitting the Worker route). Same fix for the share-level "Preview as you" button.
- **Viewer identity in dashboards.** New `resolveRecipientIdentity` helper used by every list view. Primary identity = the actual viewer's email when they entered one → "Viewer N" for anonymous → sender's `recipient_label` only as a last resort. The sender's label survives as a secondary line so context isn't lost.
- **Attachments demoted** below the share manager on the doc detail page — HTML deck stays the primary surface. Empty state is a single inline CTA. The `Allow downloads` toggle is always visible (disabled when zero attachments, with copy pointing to the panel).
- **New-share copy** rewritten — "Create a tracked link. Send it to one person or a whole list…" replaces the old "just for one recipient" phrasing that misled senders into thinking each viewer needed their own share.
- **Dashboard hierarchy.** AT A GLANCE got a real Fraunces section heading + divider; "Preview as you" and "Edit settings" upgraded from ghost links to proper button affordances.
- **Section analytics empty state** — killed the technical `<h2 id="…">` jargon copy.

### Fixed

- **Preview throws "this link didn't resolve"** — root cause was the Next.js Server Action redirect interception described above, not a SESSION_SECRET mismatch (which I initially suspected and rotated; harmless side-quest).
- Misleading `?delete_error=` query param on preview failure renamed to `?preview_error=` with its own banner.

### Security

- HMAC token prefixes (`owner-preview:` vs `owner-doc-preview:`) keep their separation; same-shape tokens cannot replay across the two endpoints.

### Tests

- +8 tests (40 total).
- App: `resolveRecipientIdentity` test suite locks the identity-resolution priority order.

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
