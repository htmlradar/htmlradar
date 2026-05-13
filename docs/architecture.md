# Architecture

This document explains _why_ HTMLRadar is built the way it is. If you're contributing or auditing, read this first — it's the reasoning behind every non-obvious choice in the code. Inline comments mark fixes from `AUDIT-1` when relevant.

---

## The big picture

Three processes, one database.

```
   recipient browser                                  document owner browser
   ─────────────────                                  ──────────────────────
          │                                                    │
          ▼                                                    ▼
   ┌────────────────────────┐                       ┌──────────────────────┐
   │  Cloudflare Worker     │                       │  Next.js app         │
   │  (packages/proxy)      │  ─── tracker.js ───▶  │  (packages/app)      │
   │  serves /r/{slug}      │                       │  sign-in / upload /  │
   │  password+email gates  │                       │  share mgmt /        │
   │  HTMLRewriter inject   │                       │  dashboard           │
   └─────────┬──────────────┘                       └─────────┬────────────┘
             │                                                │
             ▼                                                ▼
                       ┌────────────────────────┐
                       │  Supabase Postgres     │
                       │  (schema/)             │
                       │  RLS + SECURITY        │
                       │  DEFINER RPCs          │
                       └────────────────────────┘
```

**Why three processes instead of one Next.js app?**
The proxy runs on every recipient view (could be 1000s/sec near a viral share). Next.js cold-start latency on Vercel is ~200–800 ms; Cloudflare Workers cold-start is ~5 ms with global pop coverage. The proxy is on the hottest path; it gets its own process. The Next.js app is on a cooler path (owners managing shares), and benefits from Server Components + React. The tracker is its own bundle because it ships to every recipient browser — must be small (≤14 KB gzipped target).

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

The Supabase `anon` role has **no** direct INSERT/UPDATE/DELETE access to viewer-side tables. All recipient-driven writes go through four RPCs in `schema/002_rpcs.sql`: `start_session`, `update_session`, `create_share` (authenticated), `verify_share_password`. Each RPC is rate-limited, input-validated, and runs as the owner of the function (which has elevated privileges).

**Why?** Direct table access via PostgREST gives the client the ability to compose arbitrary filters, which is hard to lock down with RLS alone. The wedge-of-an-attack would be: get the anon key, write a script that inserts millions of fake viewer rows, exhausting Resend quota and corrupting analytics. SECURITY DEFINER RPCs give us a _narrow_ attack surface — four functions instead of seven tables. Each function explicitly validates its inputs. The audit called this "the strongest layer."

**Trade-off:** RPCs are slightly less ergonomic than direct table access for client code. We accept that because the security posture is non-negotiable.

### 4. Stateless HMAC cookies for the password and email gates

When a recipient enters a password or email at a proxy-side gate, we issue a cookie of the form `{slug}.{payload}.{expiry}.{hmac}`. The HMAC is computed with `SESSION_SECRET` over the same payload. We never store gate sessions in the DB.

**Why?** Stateful gate sessions would require a `gate_sessions` table, an index, a TTL job, and one extra DB round trip per request. Stateless means: cookie either verifies (proceed) or it doesn't (re-prompt). Zero DB load per gate check. Same pattern that JWT auth uses. Constant-time HMAC compare prevents timing attacks (`packages/proxy/src/auth.ts:constantTimeEqual`).

**Trade-off:** Revoking a gate session before its TTL expires requires rotating `SESSION_SECRET` (nukes all gate sessions globally). Acceptable for our threat model — if a recipient passed the gate once, we're fine with them having 24h of access.

### 5. The proxy enforces allow-list, not the tracker

When a share has `allowed_email_domains` set, the proxy renders a server-side email gate _before_ serving any document HTML. Only after the email validates does the proxy issue an email cookie, redirect, and then stream the document.

**Why?** Without this, the HTML reaches the recipient first (via the streamed response), then the tracker's Shadow-DOM gate displays _on top of_ it. A determined recipient could view-source and bypass the gate. For plain email-gated shares (no allow-list), this UX-only gate is acceptable — the trust signal is "you said you were Marc, the sender now expects to see Marc's name in analytics." But for "this document is only for @example-ventures.test," the proxy must enforce server-side. AUDIT-1 P1-2 caught the original mistake; commit `5799d0a` moved enforcement to the proxy.

---

## The schema in 60 seconds

`schema/001_init.sql` defines eight tables. The non-obvious ones:

- **`profiles`** mirrors `auth.users` with `tier` (`free` | `pro`). Set via a trigger on auth.users insert.
- **`documents`** has `current_version` and `r2_key`. Re-uploading bumps the version; the share link doesn't change. This is how "replace the deck after partner feedback" works without invalidating existing links.
- **`document_shares`** carries per-share config: password hash (bcrypt), expiry timestamp, revocation timestamp, allowed email domains array, recipient label. One document, many shares.
- **`viewers`** is scoped per share — the same email viewing two of your shares is two viewer rows. This is intentional: it lets each share have its own analytics narrative, and revoking a share doesn't affect viewer rows on other shares.
- **`sessions`** holds aggregate per-view metrics (active time, max scroll) and the `document_version` they saw — useful when the owner updated the doc mid-fundraise.
- **`section_events`** has `unique (session_id, section_id)` so the tracker's UPSERT-on-flush can never duplicate.
- **`waitlist`** is the v1.1 capture surface (intentionally simple).
- **`rate_limits`** is the only table `revoke all` is applied for both anon and authenticated.

`bounced` is a generated column on `sessions` (`max_scroll_depth < 0.05`) — prevents drift between code and DB definitions of "bounce." Same logic for `notifications_log` status: a CHECK constraint enforces valid values.

---

## Tracker design

Single ESM bundle. ~12 KB gzipped target. Nine TypeScript modules in `packages/tracker/src/`. Each module has one responsibility:

- `config.ts` — read `data-*` attrs + `window.HTMLRadarConfig`, validate, fill defaults
- `transport.ts` — fetch wrapper for the two RPCs, with `keepalive: true` on unload
- `identity.ts` — fingerprint, email, opt-out (localStorage)
- `gate.ts` — Shadow-DOM email gate (only used for email-gated shares without allow-list)
- `session.ts` — visibility + heartbeat + scroll + flush mutex
- `sections.ts` — heading observer + dwell with `minDwellMs: 3000` default
- `api.ts` — `window.HTMLRadar` public surface
- `types.ts` — shared types
- `index.ts` — boot

### Why not @supabase/supabase-js?

The tracker uses ~5% of the supabase-js surface (two RPCs). The SDK is ~25 KB gzipped — twice our entire budget. We hand-rolled the fetch wrapper in `transport.ts` (about 80 lines). Bonus: `fetch + keepalive: true` works directly for the unload path; via supabase-js it requires wrapping the internal client, which is awkward.

### Why 3000 ms minDwell?

This is the audit fix for F-7. The original tracker fired `onSectionRead` every time a heading transitioned into the viewport — including when the user fast-scrolled past 10 sections in one swipe, each crediting ~16 ms. The dashboard showed "every section read" even for a tab that was open for 5 seconds.

3 seconds is the minimum dwell empirically chosen to separate "scanned" from "read." Configurable per deployment via `window.HTMLRadarConfig.sections.minDwellMs`, but the default is the right answer for ~95% of cases.

### Why a closed Shadow DOM gate?

The gate renders on top of the document. The document is recipient-supplied HTML and can contain arbitrary CSS. Without isolation, the host page's `body { color: black; }` would bleed into our `input` styling. A closed Shadow root means the host page's CSS cannot reach into our gate, and our gate's CSS cannot escape into the host page. `attachShadow({ mode: 'closed' })` also blocks the host's JavaScript from inspecting our DOM — a small bonus for not leaking gate state.

### Why a flushing mutex?

When the heartbeat fires while the user is navigating away, `visibilitychange:hidden` _also_ fires. Both call `flush()`. Without a mutex, two concurrent UPSERTs can race; without `unique (session_id, section_id)` on the DB side, two rows can land in `section_events` for the same section. The mutex (`flushing: boolean`) plus the DB unique constraint is belt-and-braces defense for AUDIT F-11.

---

## Rate-limit and identity model

`schema/002_rpcs.sql:check_rate_limit` keys on a caller-supplied string. The two RPCs feed it different keys:

- `start_session`: key = `start:{slug}:{lower(email) or fingerprint or 'anon'}`. Cap = 5 calls per 60 s.
- `update_session`: key = `update:{session_id}`. Cap = 30 calls per 60 s (tracker heartbeats ~4/min, generous headroom).

**Why not key on client IP?** Because the tracker calls Supabase directly from the recipient's browser — the IP isn't surfaced as `request.cf.connecting_ip` to PostgREST. The original RPC accepted `p_client_ip` but it was always null. The audit caught this in P1-1 (commit 5799d0a).

If we later move RPC calls server-side (via the proxy), we can re-add IP-based limits as defense-in-depth.

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

A free, no-sign-in tool that takes Markdown / DOCX / TXT input and outputs a branded HTML file the user can download. Ships **week 2 post-launch**, not earlier. Held until then so the launch narrative stays sharp: HTMLRadar tracks HTML; the converter is the on-ramp for users who don't already have HTML.

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

The original Example Co prototype shipped `Reckless-Light.woff2`. **Reckless is a commercial font from MCKL**, not redistributable. Any version of the converter going into the AGPL repo or hosted at htmlradar.com must use only Google Fonts (free / open license) or self-licensed open fonts (Fraunces, Instrument Serif, etc.). This is a hard rule, not a recommendation.

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

| Not built                               | Why not                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Self-signup with custom auth            | Supabase Auth (Google OAuth + magic link) covers it. Building our own = three weeks of work to get to feature parity, plus a real liability if we get the password hashing wrong.                                              |
| Real-time websockets for analytics      | A 15 s heartbeat is fine. Websockets would be ~3× the worker cost for marginal UX gain. v1.1 maybe.                                                                                                                            |
| Custom state management (Redux/Zustand) | Server Components handle most state. The few interactive surfaces (sign-in, upload) use plain React hooks. Anything more is premature.                                                                                         |
| Full Stripe billing integration in v1.0 | A Payment Link + manual tier flip is the Wizard-of-Oz pattern. We invest in real billing infra when ≥5 customers prove demand.                                                                                                 |
| Watermark on the document body          | Researched competitor strategies — none of Tally, Cal.com, Loom, Papermark, Formbricks watermark the user-generated artifact. They all brand chrome. Doing otherwise would kill adoption in the high-stakes B2B sender market. |
| In-product email composer               | Senders use their own mail client. We give them a URL.                                                                                                                                                                         |
| AI doc chat / "ask the deck a question" | Differentiator candidate for v1.2 if signal warrants. Not v1.0.                                                                                                                                                                |
| Folder organization / data rooms        | DocSend Advanced ($250/mo) gates these. We start without; add when paid users ask.                                                                                                                                             |

---

## License model

AGPL-3.0-or-later. Why not MIT?

Plausible learned this the hard way — they shipped under MIT, were forked by competing SaaS operators who didn't contribute back. They re-licensed to AGPL after that incident and explicitly cite it in their blog. Papermark, Cal.com, Posthog all use AGPL for the same reason.

The practical effect: a fork running a competing hosted SaaS must also open-source their changes. Big-co legal teams won't touch AGPL code inside commercial products. The hosted product moat becomes brand + reliability + ongoing development, not code secrecy.

The 5% of users who self-host are not our paying customers regardless. The 95% who use the hosted version don't care about the license — they want the product to work.

---

## Where to start as a contributor

- **Schema change?** Edit `schema/001_init.sql` or add a new migration file. Test the RLS policies by hand in the SQL editor. Update this doc if the table model changes.
- **Tracker change?** `packages/tracker/src/`. Add a Vitest test for any new branch. Re-verify `dist/tracker.js` size stays under budget.
- **Proxy change?** `packages/proxy/src/`. Worker handler in `index.ts`; security logic (cookies, allow-list) in `auth.ts` + `index.ts`.
- **App change?** `packages/app/src/app/`. App Router + Server Actions for mutations.

Every PR runs CI (lint, typecheck, vitest, gitleaks, DCO). Every commit must be signed off (`git commit -s`).

If a decision in this doc seems wrong now, write the contrary opinion as a PR comment — we'll either update the doc or push back with the original reasoning.
