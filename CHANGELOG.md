# Changelog

Notable changes between releases. Following [Keep a Changelog](https://keepachangelog.com/) loosely. The latest published Git tag is v1.1.2; v1.2 below is documented but was not tagged.

---

## Unreleased

### Added

- **`/about`, one canonical definition, and an answer-engine pass.** The site had no page saying what HTMLRadar is, who builds it, under what licence and where the code lives, so `/about` now carries eight checkable facts, each linked to its source, and is reachable from the footer. One sentence — "HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link, and seeing who opened it, which sections they read, and for how long" — now appears word for word in the first hundred words of the homepage, `/mcp`, the README, `llms.txt` and both JSON-LD types, replacing five paraphrases (and taking "html tracker", an excluded intent, out of the homepage lede). The research article gained five question-shaped headings with 43-to-49-word answers and `FAQPage` markup; both blog posts now carry `dateModified` and show a visible "Updated" only when it differs from the publication date. `Organization` gained Smithery in `sameAs` (the open follow-up from the 31 August decision), a real founding date, the contact address and the `-or-later` licence identifier, and lost Trustpilot, whose listing misdescribes us. `llms-full.txt` ships, generated from the live pages by `pnpm gen:llms` rather than hand-written, because a hand-maintained copy drifts. Reviewed by Sol (`docs/workstreams/seo-and-indexing/SOL-GEO-REVIEW-2026-09-04.md`), which raised two blockers — the Trustpilot entry, and an FAQ answer claiming all seven tested products send a view event when the captures were of ungated links and Stacktree's established none — both fixed before landing, along with seven smaller accuracy corrections. The evidence audit behind it (`GEO-2026-09-04.md`) records that structured data and llms.txt have measured evidence of _no_ citation effect, and that the real lever for a site with no backlinks is off-site presence, not more markup.

- **`/use-case/client-report-tracking`** — an answer page for the recurring client report ("How do I send a client report and know if they read it?"). Built because three independent Reddit threads inside a fortnight ask it and both autocomplete engines return "how to share html report", while no existing page owned the intent. A second commissioned page on Jupyter/Quarto reports was dropped: ninety days of Search Console show zero impressions for any notebook query, autocomplete for those tools returns sharing intent only, and the ICP places that audience in the bucket with no accounts behind it. Reviewed by Sol (`docs/workstreams/seo-and-indexing/SOL-ANSWER-PAGES-REVIEW-2026-09-05.md`), which upheld the one-page decision and caught four claims that overstated what the tracker does — the five-second wait applies to ungated links only, a gated reader starts a session at the gate, section time follows the half-visible-for-one-second rule rather than the three-second read threshold, and the notification subject carries the reader's gate address, not their first name. All corrected before landing. `ShareStack` and `EmailNotificationMock` gained optional props so the existing drawings could carry client-report labels instead of investor ones.

- **Paid-conversion analytics events.** The Polar webhook now emits `payment.received`, `subscription.activated`, `subscription.canceled`, and `subscription.revoked` to `app_events` — the tier flip is no longer invisible to analytics. Signup/signin events also carry the user's email so people are recognizable in dashboards.
- **app_events → PostHog replay** in the monitor worker (the "PostHog-shaped, replay later" plan from `schema/006`). Server-side only — no browser tracker, the `/privacy` promise is unchanged. Cursor table in `schema/029_analytics_replay_cursor.sql`; QA-bot traffic is filtered out.
- **UTM tags on shared-doc surfaces** — the "Powered by HTMLRadar" badge, gate page, and error-page links now carry `utm_source`, so recipient→visitor conversion is attributable.

### Changed

- **www.htmlradar.com now 301s to the apex** (via middleware) and every marketing page carries a canonical URL — Search Console was indexing both hosts as separate pages and splitting ranking signal.
- **New marketing pages**: `/for/claude-artifacts`, `/for/reveal-js` (the own-HTML wedge nobody else can rank for), `/use-case/proposal-tracking` (an agency-friendly proposal workflow), and `/compare/docsend-vs-papermark` (third-party comparison). All linked from the homepage footer and sitemapped.
- **Removed `/compare/pitch`** (301 → `/use-case/track-html-deck`): its core instruction — "export Pitch to HTML" — described a feature Pitch.com doesn't have (they export PDF/PPTX only). The same false claim family ("Gamma exports are HTML") was scrubbed from `/use-case/track-html-deck`; Gamma exports PDF/PNG/PPTX only.

- **Free tier is now 2 tracked links (lifetime), not 10 documents.** Documents are uncapped; the tracked link (share) is the metered unit. Revoked and expired links still count, so slots can't be rotated by deleting and re-creating. Enforced server-side by `enforce_share_cap` (`schema/027_free_tier_share_cap.sql`, replacing the old `enforce_doc_cap`); Free users at the cap are routed to `/upgrade?reason=share_quota`. Pro ($15/mo) is unlimited tracked links.

### Added

- **Commercial license** (`COMMERCIAL-LICENSE.md`) alongside AGPL-3.0 — a dual-license path for closed-source or hosted-SaaS use that AGPL's copyleft doesn't permit. AGPL-3.0 remains the public license; self-hosting as-is needs no commercial license.

### Fixed

- **Share expiry timezone** — the live share form now converts the `datetime-local` value to ISO in the browser before submit, so an expiry set as local time is stored at the intended instant.
- **Copy-link button** — falls back to a hidden-textarea copy when the async clipboard API is unavailable, instead of silently doing nothing.
- **Flaky connector rate-limit tests** — `packages/connector/tests/ratelimit.test.ts` now freezes the clock with `vi.setSystemTime` so a slow CI runner can't carry a test across a 60-second window boundary, and the three heavy-iteration cases get a 20s timeout instead of vitest's 5s default.

---

## v1.2 — 2026-05-19

A QA and ownership pass and a Phase 2 micro-interaction polish. The doc-detail page got a hard rewrite (identity hierarchy, deduplicated analytics, capped lists with elegant expand), the attachments model was fixed, a version-history feature shipped, and the landing copy stopped trash-talking PDF.

### Added

- **Document version history** (`document_versions` table; hero `v{n}` chip becomes a popover). Every upload and replace logs the original local filename, file size, timestamp, and who replaced it. Existing share links automatically serve the current version; earlier versions are kept for reference only. Italic "Filename not captured" affordance on rows that pre-date the feature.
- **Lifetime quota counter** on `/new`, `/settings`, and `/upgrade`. Live "X of 10 uploads used" with progress bar, tone-shifts to alert at cap. Contextual headline on `/upgrade?reason=quota` ("Ten uploads in. Pro removes the ceiling.").
- **Permanent Delete share** in a Danger zone in Edit settings, separate from the reversible Revoke pause. Opens a typed-DELETE confirmation modal. Hard-deletes the share row + cascades to sessions/viewers/section_events. URL returns Not Found after.
- **Recipient corner-pill attachments UI** — small oxblood pill in the top-right of the recipient view opens a side drawer listing the attached files. Always available when present; never hidden behind a deck-lock toggle. Per-viewer download tracking writes viewer_id + session_id + filename + size_bytes per download.
- **Preview opens in a new tab** — both "Preview document" (hero) and "Preview as you" (per-share). Dashboard tab stays put.
- **Cloudflare cache purge on every deploy** (`.github/workflows/deploy.yml`). After Pages + worker uploads, hits the zone purge_cache endpoint. `continue-on-error: true` so a narrower token doesn't fail the deploy; requires `CLOUDFLARE_ZONE_ID` secret.
- **Phase 2 design polish**: site-wide button `:focus-visible` ring (WCAG AA contrast) + `:active` press; `/docs` row hover lift; `/docs` activity-dot ambient halo; stat-strip soft fade-in; landing workflow packet pause-on-hover; landing GitHub-icon rotate-on-hover; `/pricing` Tier card hover lift; `/sign-in` "Opening Google…" busy state; `/sign-in` sent-confirmation card fade-in.
- **Playwright auth helper** (`packages/app/e2e/auth-setup.spec.ts`) — mints a qa-bot session via Supabase password REST, writes a storageState file. Unblocks future authed-surface e2e tests.

### Changed

- **Recipient identity hierarchy rewritten.** The sender's `recipient_label` is now always primary; viewer email is secondary. Share rail, viewer table, share table, and SharePane heading all read consistently — "Investor list" stays "Investor list" on every surface instead of demoting to "viewer2@... +5". 10 new test cases cover the rule.
- **Doc-detail layout** simplified to a single-column stack (Shares above, Analytics below). The earlier outer 2-col layout collapsed the SharePane at every laptop width — grid items without `min-w-0` let the analytics column overflow into the shares column.
- **Sessions list capped at 5** with "Show N more" expand on `/dashboard/[slug]`. The SharePane on `/docs/[id]` suppresses both the stat row and the sessions list entirely — `ViewerInsights` below is the one canonical analytics view.
- **Viewer table capped at top 5** with "Show N more viewers / Show top 5" expand below.
- **Hero title shrunk** from 44/64/72px to 26/32/36px with `truncate` and tooltip — no more long titles ellipsised to "Long Pitch De...".
- **`First seen` + `Last seen` columns** symmetric: both use hybrid relative/absolute formatting (recent = "12h ago", older = "May 17"), full timestamp on hover.
- **Recipient error pages rewritten** (`notFound` / `revoked` / `expired` / `sourceUnreachable`). No HTTP codes mentioned in any visible body. Each ends with "Reply to the person who sent this to you" + "What is HTMLRadar?" link. 26 regression tests lock in the copy + cache headers.
- **Lock-the-deck semantic flipped** — `document_shares.allow_download` renamed to `lock_deck`. One toggle "Lock the deck" governs the deck's save/print/screenshot posture; attachments are no longer gated by this flag.
- **Share access changes apply retroactively.** Email allowlist is re-checked against the current share state on every proxy request (both doc-serve and attachment routes). Previously an email cookie issued before the allowlist tightened stayed valid.
- **`/docs` activity dot is static**, derived from `documents.last_viewed_by_owner_at`. Visible until the owner opens the doc.
- **Landing copy rewritten** — "The shift" leads with what HTML enables instead of trash-talking PDF. Trust row adds "Diligence packets" alongside investor decks / sales reports / design specs / proposals. Workflow "Share" step positions attachments as "The whole packet under one tracked link".
- **`/compare/papermark` and `/why`** now export proper `metadata` (title + description). Both were falling back to the default app title — SEO regression caught by the pre-deploy QA pass.
- **Middleware preserves querystring on unauth redirect** so `/upgrade?reason=quota` survives the sign-in bounce.
- **Hero "Delete" → "Delete document"**, "Live · 30s" → "Live" / "Paused", `Recipient` column on viewer table → `Viewer`, "1 link" → "1 share", several stale "returns 403" hints rewritten in human terms.

### Fixed

- **Missing `INSERT`/`UPDATE` RLS policies on `document_versions`** (schema 019). Migration 018 enabled RLS with a `SELECT`-only policy; every history insert from server actions was silently rejected as the authenticated role. Caught by the static-audit agent before deploy.
- **Three fire-and-forget Supabase writes** on Edge runtime were being dropped by the worker terminating after redirect. Awaited explicitly (version-history v1 seed for both URL + upload, version-history append on replace, `last_viewed_by_owner_at` update on doc visit).
- **Delete-share modal case mismatch.** Client `canDestroy` was case-insensitive ("delete" enabled the button); server required exact uppercase "DELETE". Normalized server-side.
- **Inline `boxShadow` on pricing Tier** was winning over the CSS `:hover` shadow by specificity, so the card lifted on hover without a deepening shadow. Moved rest shadow into CSS rule with `[data-accent='true']` variant.
- **Hero stat strip duplicated `ViewerInsights` glance grid** with conflicting framings (avg-scroll top, max-scroll bottom). Removed.
- **`SharesTable` viewer count** now dedupes by email + drops internal viewers so it reconciles with `ViewerInsights`' "Viewers" glance card.

### Migrations

- `schema/015_lock_deck_rename.sql` — renames `document_shares.allow_download` to `lock_deck`, flips the semantic
- `schema/016_attachment_downloads.sql` — adds viewer_id, session_id, filename, size_bytes columns
- `schema/017_doc_last_viewed.sql` — adds `documents.last_viewed_by_owner_at`
- `schema/018_document_versions.sql` — new `document_versions` table + backfill v1 for existing docs
- `schema/019_document_versions_rls_insert.sql` — INSERT/UPDATE RLS policies + grants on `document_versions`

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
