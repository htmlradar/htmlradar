# Architecture

This document explains _why_ HTMLRadar is built the way it is. If you're contributing or auditing, read this first — it's the reasoning behind every non-obvious choice in the code.

---

## The big picture

Four processes, two storage backends.

```
   recipient browser                                  document owner browser
   ─────────────────                                  ──────────────────────
          │                                                    │
          ▼                                                    ▼
   ┌────────────────────────┐                       ┌──────────────────────┐
   │  Cloudflare Worker     │                       │  Next.js app         │
   │  packages/proxy        │  ─── tracker.js ───▶  │  packages/app        │
   │  /r/{slug} + /r/{slug} │                       │  sign-in / upload /  │
   │  /attachments/{id}     │                       │  share mgmt /        │
   │  HMAC gates · inject   │                       │  dashboard           │
   └────┬──────────┬────────┘                       └─────────┬────────────┘
        │          │                                          │
        ▼          ▼                                          ▼
  ┌─────────┐  ┌──────────────┐                  ┌────────────────────────┐
  │  R2     │  │  Supabase    │  ◀─── cron ────  │  packages/monitor      │
  │ doc +   │  │  Postgres    │   every 5 min    │  CF cron Worker —      │
  │ attach. │  │  RLS + RPCs  │                  │  alerts on regression  │
  └─────────┘  └──────────────┘                  └────────────────────────┘
```

**Why four processes instead of one Next.js app?**
The proxy runs on every recipient view (could be 1000s/sec near a viral share). Next.js cold-start latency on Vercel is ~200–800 ms; Cloudflare Workers cold-start is ~5 ms with global pop coverage. The proxy is on the hottest path; it gets its own process. The Next.js app is on a cooler path (owners managing shares), and benefits from Server Components + React. The tracker is its own bundle because it ships to every recipient browser — must be small (≤14 KB gzipped target). The monitor cron Worker runs every 5 minutes against Supabase, checking `error_log` and `notifications_log` for regressions and emailing the founder via Resend — no HTTP entry, cron only.

R2 holds two things: the uploaded HTML body (keyed `docs/{owner}/{doc}/v{n}.html`) and the per-share attachment bytes (PDFs, Excels, ZIPs). Supabase holds everything else.

---

## The five decisions that shape everything

### 1. One document, many shares

A `document` is the content. A `document_share` is a tracked link with its own password, expiry, revocation, email-gate config, and recipient label.

**Why not one share per document?** Because the value prop is _"see exactly who viewed."_ A single shared link tells you "someone opened it." Per-recipient links let you say _"Marc at Example Ventures opened it 3 times."_ DocSend's entire pricing structure is built around per-recipient links. Without this, we're not actually competing in the same category.

**Trade-off:** more complex than the v0 prototype (which had one tracker per page). The complexity is contained in `schema/001_init.sql` and `app/(app)/docs/[id]/page.tsx`.

### 2. The document body is never modified

The proxy worker uses `HTMLRewriter.on('head')` and `HTMLRewriter.on('body')` to _append_ tracker scripts and chrome footer — only as the last child of those elements. The document's own content is byte-identical to what the owner uploaded.

**Why?** Two reasons. First, sales/legal/finance teams send proposals they cannot risk altering — a stray DOM edit could break contract numbers, mess with signatures, or change the visible offer. Second, _"Powered by HTMLRadar"_ in the middle of an investor deck kills adoption immediately (this was the explicit signal from research: Tally, Cal.com, Loom, Papermark all brand chrome, never content). The "Shared with HTMLRadar" footer on the free tier is a fixed-position chrome element, on top of the viewer's viewport, never inside the document flow.

### 3. Anon writes only through SECURITY DEFINER RPCs

The Supabase `anon` role has **no** direct INSERT/UPDATE/DELETE access to viewer-side tables. Recipient-driven writes go through three RPCs: `start_session`, `update_session`, `verify_share_password` (`schema/002_rpcs.sql`, hardened in `004_password_security.sql` + `012_viewer_is_internal.sql`). Owner-side mutations go through their own SECURITY DEFINER RPCs invoked from server actions — `create_share`, `update_share` (`007_share_edit.sql`), `set_share_lock_deck` (`015_lock_deck_rename.sql`), `toggle_viewer_internal` (`012`). Each RPC is rate-limited, input-validated, and runs as the function owner.

**Why?** Direct table access via PostgREST gives the client the ability to compose arbitrary filters, which is hard to lock down with RLS alone. The wedge-of-an-attack would be: get the anon key, write a script that inserts millions of fake viewer rows, exhausting Resend quota and corrupting analytics. SECURITY DEFINER RPCs give us a _narrow_ attack surface — four functions instead of seven tables. Each function explicitly validates its inputs. The audit called this "the strongest layer."

**Trade-off:** RPCs are slightly less ergonomic than direct table access for client code. We accept that because the security posture is non-negotiable.

### 4. Stateless HMAC cookies for the password and email gates

When a recipient enters a password or email at a proxy-side gate, we issue a cookie of the form `{slug}.{payload}.{expiry}.{hmac}`. The HMAC is computed with `SESSION_SECRET` over the same payload. We never store gate sessions in the DB.

**Why?** Stateful gate sessions would require a `gate_sessions` table, an index, a TTL job, and one extra DB round trip per request. Stateless means: cookie either verifies (proceed) or it doesn't (re-prompt). Zero DB load per gate check. Same pattern that JWT auth uses. Constant-time HMAC compare prevents timing attacks (`packages/proxy/src/auth.ts:constantTimeEqual`).

**Trade-off:** Revoking a gate session before its TTL expires requires rotating `SESSION_SECRET` (nukes all gate sessions globally). Acceptable for our threat model — if a recipient passed the gate once, we're fine with them having 24h of access.

### 5. The proxy enforces allow-list, retroactively

When a share has `allowed_email_domains` or `allowed_emails` set, the proxy renders a server-side email gate _before_ serving any document HTML. Only after the email validates does the proxy issue an email cookie, redirect, and then stream the document.

**Critically, the cookie is not trusted on later requests.** Every doc-serve and every attachment-fetch re-runs `isEmailAllowed(share, cookie.email)` against the share's _current_ allowlist (`packages/proxy/src/index.ts`). If the sender tightened the list after a cookie was issued, the stale cookie is rejected and the gate re-prompts. Without it, a recipient who passed the gate once kept access even after being removed.

**Why server-side at all?** Without this, the HTML would reach the recipient via the streamed response and the tracker's Shadow-DOM gate would display _on top of_ it. A determined recipient could view-source and bypass it. For plain email-gated shares (no allow-list), the in-document gate is acceptable; for allow-listed shares it must be the proxy. AUDIT-1 P1-2 caught the original mistake; commit `5799d0a` moved enforcement to the proxy.

---

## The schema in 60 seconds

15 tables across `schema/001_init.sql` and migrations 003–018. The ones worth knowing:

- **`profiles`** mirrors `auth.users` with `tier` (`free` | `pro`). Set via a trigger on auth.users insert.
- **`documents`** has `current_version`, `r2_key`, and `last_viewed_by_owner_at`. Re-uploading bumps `current_version`; the share link doesn't change. `last_viewed_by_owner_at` drives the activity dot on `/docs`.
- **`document_versions`** (migration 018) — one row per upload or replace, capturing the original local filename, byte size, R2 key, and the user who uploaded. Powers the version-history popover on the doc detail page; `documents.current_version` always equals `max(document_versions.version)` for that doc.
- **`document_shares`** carries per-share config: password hash (bcrypt), expiry, revocation, `allowed_email_domains`, `allowed_emails`, `lock_deck` (renamed from `allow_download` in migration 015, semantic flipped — `lock_deck` controls deck save/print only; attachments are always available regardless), recipient label. One document, many shares.
- **`document_attachments`** (009) + **`attachment_downloads`** (016) — files riding alongside a share, plus a per-viewer download log keyed on `viewer_id` + `session_id` + `filename` + `size_bytes`.
- **`viewers`** is scoped per share — the same email viewing two of your shares is two viewer rows. Lets each share own its analytics narrative; revoking a share doesn't affect viewer rows on other shares.
- **`sessions`** holds aggregate per-view metrics (`active_time_seconds`, `max_scroll_depth`, `last_heartbeat_at`) and the `document_version` they actually saw — useful when the owner updated the deck mid-fundraise.
- **`section_events`** has `unique (session_id, section_id)` so the tracker's UPSERT-on-flush can never duplicate.
- **`notifications_log`** (003) — audit row per first-open email send; status enum (`queued / delivered / failed / skipped`) drives the monitor cron.
- **`app_events`**, **`error_log`**, **`feedback`** (006) — observability layer; `app_events` is PostHog-shaped so we can replay later without vendor lock-in.
- **`rate_limits`** is the only table `revoke all` is applied for both anon and authenticated.
- **`waitlist`** is the legacy pre-launch capture surface, retained but not actively used post-launch.

`bounced` is a generated column on `sessions` (`max_scroll_depth < 0.05`) — prevents drift between code and DB definitions of "bounce." Same approach for `notifications_log.status` and `document_versions.source_type`: CHECK constraints enforce valid values.

---

## Tracker design

Single ESM bundle. ~12 KB gzipped target. Ten TypeScript modules in `packages/tracker/src/`, each with one responsibility:

- `config.ts` — read `data-*` attrs + `window.HTMLRadarConfig`, validate, fill defaults
- `transport.ts` — fetch wrapper for the RPCs, with `keepalive: true` on unload
- `identity.ts` — fingerprint, email, opt-out (localStorage)
- `gate.ts` — Shadow-DOM email gate (only used for email-gated shares without allow-list)
- `session.ts` — visibility + heartbeat + scroll + idle watchdog + flush mutex
- `sections-v2.ts` — IAB-style viewport-coverage section tracker (active)
- `sections-legacy.ts` — pre-v2 heading-observer fallback (retained as one-line rollback target; remove after 7-day v2 stability)
- `api.ts` — `window.HTMLRadar` public surface
- `types.ts` — shared types
- `index.ts` — boot

### Why not @supabase/supabase-js?

The tracker uses ~5% of the supabase-js surface (two recipient RPCs). The SDK is ~25 KB gzipped — twice our entire budget. We hand-rolled the fetch wrapper in `transport.ts` (about 80 lines). Bonus: `fetch + keepalive: true` works directly for the unload path; via supabase-js it requires wrapping the internal client, which is awkward.

### Why a closed Shadow DOM gate?

The gate renders on top of the document. The document is recipient-supplied HTML and can contain arbitrary CSS. Without isolation, the host page's `body { color: black; }` would bleed into our `input` styling. A closed Shadow root means the host page's CSS cannot reach into our gate, and our gate's CSS cannot escape into the host page. `attachShadow({ mode: 'closed' })` also blocks the host's JavaScript from inspecting our DOM — a small bonus for not leaking gate state.

### Why a flushing mutex?

When the heartbeat fires while the user is navigating away, `visibilitychange:hidden` _also_ fires. Both call `flush()`. Without a mutex, two concurrent UPSERTs can race; without `unique (session_id, section_id)` on the DB side, two rows can land in `section_events` for the same section. The mutex (`flushing: boolean`) plus the DB unique constraint is belt-and-braces defense for AUDIT F-11.

---

## Engagement-time methodology

"Reading time" and "section dwell" each need to mean _engaged_ time, not _tab-open_ time. The tracker enforces this at both granularities with the same idle definition.

**The shared definition.** A reader is considered active when ALL of these hold:

1. The tab is visible (`document.visibilityState === 'visible'`).
2. They've fired one of `keydown`, `scroll`, or `touchstart` in the last **5 seconds** (`ACTIVITY_IDLE_MS = 5000` in `sections-v2.ts`; `Session.IDLE_THRESHOLD_MS = 5000` in `session.ts`). Mousemove is deliberately excluded — too noisy, doesn't reliably imply attention. This matches the IAB / Chartbeat / Parse.ly engagement-time methodology.

**At the section level** (`sections-v2.ts`). The tracker samples every 250 ms via `requestAnimationFrame`. For each visible section, it credits time weighted by what fraction of the viewport that section occupies. A section needs ≥50% of its own height in the viewport (`MIN_COVERAGE = 0.5`, IAB Viewable Impression Standard) and ≥1 second of continuous visibility (`QUALIFIED_DWELL_MS = 1000`) before its credited time counts toward `qualifiedMs`. Time accumulated before qualification is discarded. The dashboard surfaces qualified time only.

**At the session level** (`session.ts`). `tickActive` caps the credited window at `lastActivityMs + 5000`. If the reader walked away with the tab open, active_time stops accumulating after the 5s grace; when they interact again, accumulation resumes from that moment. A 30-second heartbeat or `visibilitychange:hidden` triggers the tick, so writes to `sessions.active_time_seconds` always reflect the engaged total, never tab-open time.

**Why 5 seconds and not 30?** Engagement reads as continuous activity, not as one action followed by minutes of dwell. Five seconds is the value Chartbeat settled on after a decade of A/B testing; we adopted it directly. Configurable per deployment but the default is the right answer for ~95% of cases.

**Why two counters at all?** Section dwell is per-section detail (which slide held attention). Session active_time is the aggregate signal (was this a real read or a scroll-by). They use the same idle gate so they agree on what "engaged" means — the per-section bars sum to ~the session's active_time, modulo sampling and rounding.

**One pre-existing limitation.** Sessions written before commit `e3d4bc2` have inflated `active_time_seconds` because the session-level watchdog didn't exist yet. We don't back-fill; the legacy numbers stay as they are.

---

## Rate-limit and recipient identity

`schema/002_rpcs.sql:check_rate_limit` keys on a caller-supplied string. The two recipient-side RPCs feed it different keys:

- `start_session`: key = `start:{slug}:{lower(email) or fingerprint or 'anon'}`. Cap = 5 calls per 60 s.
- `update_session`: key = `update:{session_id}`. Cap = 30 calls per 60 s (tracker heartbeats ~4/min, generous headroom).

**Why not key on client IP?** Because the tracker calls Supabase directly from the recipient's browser — the IP isn't surfaced as `request.cf.connecting_ip` to PostgREST. The original RPC accepted `p_client_ip` but it was always null. The audit caught this in P1-1 (commit 5799d0a).

**Identity on the dashboard side.** Three views (`/docs/[id]` rail, `/docs/[id]` viewer table, `/dashboard/[slug]`) all surface the same share or viewer; without a single resolver they drift. `packages/app/src/lib/recipient-identity.ts` is the single source of truth. The rule: the sender-supplied `recipient_label` is always primary when present (a group label like "Investor list" or a person label like "Marc at Example Ventures" beats first-viewer-email for at-a-glance identification); viewer emails demote to secondary. Without a label, viewer email (or `Viewer N` fallback) takes primary. Tested in `recipient-identity.test.ts`.

If we later move RPC calls server-side (via the proxy), we can re-add IP-based limits as defense-in-depth.

---

## App-layer surfaces worth knowing

A few owner-side features have non-obvious shapes worth pinning down here so contributors don't reinvent them.

**Attachments** (`schema/009_attachments.sql` + `016_attachment_downloads.sql`, surfaced via `inject.ts` corner pill on the recipient side, `AttachmentsPanel.tsx` on the owner side). Files (PDF / Office / image / ZIP) ride alongside the deck on every share. They're stored in R2 keyed by attachment id. The proxy lists them on every recipient view and the corner pill opens a side drawer. **They are always available when present** — never gated by `lock_deck` (that flag only controls deck save/print). Each download writes one row to `attachment_downloads` keyed on `viewer_id` + `session_id` + `filename` + `size_bytes`, so the dashboard shows per-recipient download counts without joining against the file bytes themselves.

**Version history** (`schema/018_document_versions.sql` + `019_document_versions_rls_insert.sql`). Every initial upload and every replace appends a row to `document_versions` capturing the original local filename (from `formData.get('file').name`), byte size, R2 key, source type, and who replaced it. `documents.current_version` always equals `max(document_versions.version)` for that doc. Share links don't change on replace; recipients get the new version on next open, and `sessions.document_version` records which version each session actually saw — useful when you audit reads across deck revisions. Versions written before this schema shipped have no captured filename; the popover renders an italic "Filename not captured" affordance for those rows.

**Lifetime quota** (`schema/003_triggers.sql:enforce_doc_cap` + `packages/app/src/lib/quota.ts`). Free tier caps at 10 lifetime documents — deleted docs count, so a user can't rotate slots by deleting and re-uploading. The Postgres trigger raises before insert #11; the UI counter on `/new`, `/settings`, and `/upgrade` reads `readQuota()`. Both code paths count `documents WHERE owner_id = ...` with no `deleted_at` filter so they agree. The cap is the trigger that routes Free users to `/upgrade?reason=quota` with a contextual headline.

**Recipient error pages** (`packages/proxy/src/responses.ts`). Four states — link doesn't exist, sender revoked, link expired, source unreachable — all rendered as branded shells. Cache headers set `private, no-store, max-age=0` so extending an expiry doesn't get masked by a cached error page. No HTTP code is mentioned in the visible body; the recipient sees warm copy plus a "Reply to the person who sent this" footer. 26 regression tests in `packages/proxy/tests/responses.test.ts` lock the contract.

---

## Performance budget

| Surface                    | Target                         | Why                                                                                                                 |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `dist/tracker.js`          | ≤14 KB gzipped                 | First-party script on every recipient page-load. Pages with a 30 KB doc should not double in size.                  |
| Proxy worker p50 latency   | <50 ms                         | Recipients click and expect a render. CF Workers globally pop = ~5 ms cold start; the budget is for DB round-trips. |
| `start_session` round-trip | <250 ms p95                    | Gate dismisses on resolve; longer = visible UX hitch.                                                               |
| Heartbeat flush            | 15 s interval, 1 RPC per flush | One UPSERT for active_time + max_scroll, one batched UPSERT for section events.                                     |
| Dashboard query            | <500 ms p95                    | Owner is on their own machine, latency-tolerant, but >500 ms feels slow.                                            |

If a budget slips, we either fix code or escalate to the user with a measurement, not a vibe.

---

## Format scope: HTML only

This is the most important strategic decision in the project, codified here so it's not relitigated in every issue thread.

**v1.0 supports HTML only.** No PDF, no PowerPoint, no Word, no Markdown. The position is intentional and tightly coupled to the architecture.

### Why this is a strategy decision, not just a feature decision

1. **Differentiation.** DocSend, Papermark, Pitch, Brevo Docs — every existing player is built around PDF. Our reason to exist is _"PDF tools don't work for the HTML decks AI-native founders are increasingly writing."_ The moment we ship PDF, we become a worse Papermark and lose the only thing that makes us interesting.
2. **Technical fit.** The tracker tracks `<h1>/<h2>/<h3>[id]` dwell. The dashboard rolls up by `section_id`. The proxy injects via `HTMLRewriter`. None of this exists for PDF. Supporting PDF means a parallel architecture, not an extension.
3. **Capacity.** A solo founder maintaining two rendering paths means each path is mediocre. HTML-only at 9/10 beats HTML+PDF at 6/10 — reviewers and beta users will hammer a half-built second format.
4. **Speed.** HTML-only launches in ~4 weeks. HTML+PDF launches in ~12 weeks. The Thariq "HTML is the new markdown" attention window is ~6 months. Speed > breadth on this curve.

### The escape hatch

Users with PDFs can paste a URL pointing at any PDF viewer (Google Drive's `/view` URL, their own hosted PDF.js viewer). We track open + total time + bounce. Section dwell only works if the URL renders to HTML with heading anchors — which we tell users plainly in `docs/quickstart.md`. This is graceful degradation, not a feature.

### Roadmap

| When                         | Add                                | Trigger                                                                                                                                      |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0                         | HTML only                          | —                                                                                                                                            |
| v1.5 (~3 months post-launch) | Markdown auto-rendered to HTML     | If ≥10% of feedback asks for it. Same tracker pipeline, no new rendering.                                                                    |
| v2.0 (~12 months)            | PDF page-level tracking            | Only if ≥30% of feedback asks. Markets as "PDF support — for HTML you still get section-level analytics." Keeps HTML the premium experience. |
| Never                        | Native PowerPoint / Word rendering | Wrong product. Tell users to convert to PDF or HTML.                                                                                         |

### How to respond when someone asks "do you support PDF?"

> "Not yet — HTMLRadar focuses on HTML decks specifically. For PDFs, Papermark and DocSend are both great. If you want HTML-quality analytics, our paste-URL feature works for any URL with `<h2>` anchors. If you'd like PDF support, drop a 👍 on [issue link] and we'll prioritize based on signal."

That answer keeps the brand sharp, sends wrong-fit users away cleanly, and gives the right-fit user a path to engage.

---

## The v1.1 lead magnet: `htmlradar.com/convert`

A free, no-sign-in tool that takes Markdown / DOCX / TXT input and outputs a branded HTML file the user can download. Ships **~10 days post-launch**, not earlier. Held until then so the launch narrative stays sharp: HTMLRadar tracks HTML; the converter is the on-ramp for users who don't already have HTML.

### Why it exists

Two real problems it solves:

1. **The non-AI-native user has no HTML to upload.** Founders writing in Notion / Docs / Markdown can't enter the HTMLRadar funnel without a converter step. Today they'd Google "markdown to html," land on a generic tool, get unstyled HTML, give up. We close that gap.
2. **It's a free distribution channel we can't get from social media.** The founder is off all social platforms; SEO and free utility tools are two of the few growth surfaces available. `htmlradar.com/convert` ranks for "markdown to html," "docx to html," "branded html generator" — high-intent queries from exactly the audience who's about to share a document.

### The product principle

**Plug-and-play in three steps. No account. No setup. No reading documentation.**

```
1. Drop your logo →  We extract your brand colors automatically.
2. Paste your text →  See it rendered live, branded, ready to download.
3. Click Download →  You get a single self-contained HTML file.
```

The magical moment is step 1: drop a PNG/SVG logo and the page extracts a usable 4-color palette in under a second. No one expects this from a free converter; everyone shares the link after they see it.

### The UX in detail

**Landing state.** Big drop zone, instructional copy ("Drop your logo to start"), small "skip" link for users who don't have one yet (they get a sensible default palette).

**Logo drop.** Accept PNG, JPG, SVG. Render in a logo-preview chip. Run client-side color quantization (k-means on a downsampled raster — ~50 lines of canvas code, no dependency). Output four colors: `accent` (dominant non-neutral), `ink` (darkest), `paper` (lightest), `signal` (secondary non-neutral). Render each as an editable swatch — clicking any swatch opens a native `<input type="color">` for fine-tuning.

**Font picker.** A curated dropdown of 6–8 Google Fonts (Inter, Fraunces, Söhne stand-ins, JetBrains Mono, etc.) — no paid fonts. Why curated? Because picking from all of Google Fonts is paralyzing; picking from six tasteful ones is liberating.

**Content drop.** Paste Markdown / drop a .md / .docx / .txt file. Live preview renders on the right with the chosen brand applied. We use marked.js for Markdown and Mammoth.js for DOCX, both via CDN — same pattern as the existing prototype.

**Brand persistence.** Save the brand state to `localStorage` keyed on a user-set name ("Acme Inc"). Next visit auto-loads it. Optionally encode brand state in the URL hash (`#brand=base64(json)`) so it's shareable across a team or saveable as a bookmark — no login needed for either path.

**Download.** Single self-contained HTML file with all CSS inlined, fonts pulled from Google's CDN, no external dependencies that could break. The HTML includes a quiet `<!-- Generated by htmlradar.com/convert -->` comment so attribution is preserved even after handoff.

**The conversion to HTMLRadar.** After download, a single line appears below the button:

> Want to know who reads this? Sign in to HTMLRadar →

One link. Not a banner, not a popup, not a pricing table. The whole point is a tasteful nudge to the user who's about to send the document anyway.

### Technical shape

- **One file:** `tools/markdown-to-html/index.html` in the same OSS repo. No build step. No new package.
- **Hosted at:** `htmlradar.com/convert` via Cloudflare Pages (or as a static route in the Next.js app — whichever ships faster).
- **Zero backend:** everything client-side. Color extraction, Markdown rendering, file download — all in the browser. The converter itself never touches our Supabase. (The CTA at the end is just a link to `/sign-in` on the main app.)
- **AGPL-3.0:** part of the same repo, same license, same DCO requirements for contributions.

### Brand-config type, scaffolded pre-launch

Even though `/convert` ships in week 2, a `BrandConfig` type lives in the codebase from day 1 (`packages/app/src/lib/types.ts`). This keeps the converter's brand model aligned with HTMLRadar's eventual Pro-tier custom-branding feature, so week-2 work is purely additive — no refactor required.

```ts
export interface BrandConfig {
  name?: string;
  logoUrl?: string; // data: URL or remote
  accentColor: string; // hex
  signalColor: string; // hex
  inkColor: string; // hex
  paperColor: string; // hex
  bodyFont: string; // Google Fonts family name
  headingFont: string; // Google Fonts family name (often same as body)
}
```

### Legal: font licensing

The original prototype shipped `Reckless-Light.woff2`. **Reckless is a commercial font from MCKL**, not redistributable. Any version of the converter going into the AGPL repo or hosted at htmlradar.com must use only Google Fonts (free / open license) or self-licensed open fonts (Fraunces, Instrument Serif, etc.). This is a hard rule, not a recommendation.

### What we don't build in v1.1

- Account-saved brand presets (use localStorage + URL hash).
- Multi-brand workspaces.
- A Figma-import button.
- AI logo generation.

Each of these is a v1.2+ candidate if `/convert` shows real traction. Until then, lead magnet stays narrow.

### How we measure success

- **Month-1 target:** 50 unique visitors/day from organic search to `/convert`, 10% of whom land on `/sign-in` via the post-download link.
- **Pivot up signal:** ≥3% conversion to actual HTMLRadar signups in month 2. If we see this, promote `/convert` to a nav item, expand the brand-config surface, build the "Convert & Track" one-click flow.
- **Pivot down signal:** Traffic but zero signups in month 1. Keep the tool live for SEO juice, remove the CTA, stop investing time.

---

## Things we deliberately did not build

| Not built                                      | Why not                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Self-signup with custom auth                   | Supabase Auth (Google OAuth + magic link) covers it. Building our own = three weeks of work to get to feature parity, plus a real liability if we get the password hashing wrong.                                                                                                                                                    |
| Real-time websockets for analytics             | A 15 s heartbeat is fine. Websockets would be ~3× the worker cost for marginal UX gain. v1.1 maybe.                                                                                                                                                                                                                                  |
| Custom state management (Redux/Zustand)        | Server Components handle most state. The few interactive surfaces (sign-in, upload) use plain React hooks. Anything more is premature.                                                                                                                                                                                               |
| Full billing webhook + customer portal in v1.0 | A Polar Payment Link + manual `profiles.tier` flip is the Wizard-of-Oz pattern. The checkout URL already appends `customer_external_id` + `customer_email` so the eventual webhook handler can auto-flip; KYC + payouts are plumbed, we just don't run the webhook yet. Invest in real billing infra when ≥5 customers prove demand. |
| Watermark on the document body                 | Researched competitor strategies — none of Tally, Cal.com, Loom, Papermark, Formbricks watermark the user-generated artifact. They all brand chrome. Doing otherwise would kill adoption in the high-stakes B2B sender market.                                                                                                       |
| In-product email composer                      | Senders use their own mail client. We give them a URL.                                                                                                                                                                                                                                                                               |
| AI doc chat / "ask the deck a question"        | Differentiator candidate for v1.2 if signal warrants. Not v1.0.                                                                                                                                                                                                                                                                      |
| Folder organization / multi-doc data rooms     | Per-share attachments already ship the "send the whole packet under one tracked link" UX without folders (PDFs, cap tables, ZIPs alongside the deck). Real DocSend-style folders + per-folder permissions are a v1.2+ candidate if paid users ask.                                                                                   |

---

## License model

AGPL-3.0-or-later. Why not MIT?

Plausible learned this the hard way — they shipped under MIT, were forked by competing SaaS operators who didn't contribute back. They re-licensed to AGPL after that incident and explicitly cite it in their blog. Papermark, Cal.com, Posthog all use AGPL for the same reason.

The practical effect: a fork running a competing hosted SaaS must also open-source their changes. Big-co legal teams won't touch AGPL code inside commercial products. The hosted product moat becomes brand + reliability + ongoing development, not code secrecy.

The 5% of users who self-host are not our paying customers regardless. The 95% who use the hosted version don't care about the license — they want the product to work.

---

## Where to start as a contributor

- **Schema change?** Add a new migration file under `schema/` — don't edit existing ones. Test RLS policies by hand in the Supabase SQL editor. Update this doc if the table model changes.
- **Tracker change?** `packages/tracker/src/`. Add a Vitest test for any new branch. Re-verify `dist/tracker.js` size stays under budget.
- **Proxy change?** `packages/proxy/src/`. Worker handler in `index.ts`; security logic (cookies, allow-list) in `auth.ts` + `index.ts`; recipient shells in `responses.ts`.
- **App change?** `packages/app/src/app/`. App Router + Server Actions for mutations. New surfaces should flow through `lib/recipient-identity.ts` for any share/viewer naming.
- **Deploy infra?** `.github/workflows/deploy.yml`. The pipeline builds tracker, builds Pages app, deploys preview, smoke-tests, promotes to prod, deploys proxy + monitor workers, then runs a Cloudflare zone cache purge.

Every PR runs CI (lint, typecheck, vitest, gitleaks, DCO). Every commit must be signed off (`git commit -s`).

If a decision in this doc seems wrong now, write the contrary opinion as a PR comment — we'll either update the doc or push back with the original reasoning.
