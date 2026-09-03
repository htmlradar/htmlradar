# Self-hosting

HTMLRadar runs on two vendors. Both offer free tiers that comfortably cover personal use.

| Service    | What it does                                                                    | Free tier               |
| ---------- | ------------------------------------------------------------------------------- | ----------------------- |
| Supabase   | Postgres database, auth, vault for secrets                                      | 500 MB DB, 50 K MAU     |
| Cloudflare | Workers (proxy, monitor cron, MCP connector), R2 (storage), Pages (Next.js app) | 100 K req/day, 10 GB R2 |

You also need a domain (any) and a [Resend](https://resend.com) account (free 100 emails/day) for view notifications. Email notifications are optional — without Resend the `notify_on_first_open` trigger writes a `skipped` row to `notifications_log` and everything else works.

## 1. Supabase

1. Create a project. Note the region — pick one close to your users.
2. From `Project Settings → API`, copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — never put in client code)
3. From `Project Settings → Database`, note your DB password.
4. In `SQL Editor`, run every numbered file directly under `schema/`, in ascending numeric order, starting at `001` — and nothing in `schema/tests/`. There is deliberately no last file named here. The folder grows with the product, and a number written into this page goes stale the next time it does; the rule is "everything in the folder, in order", and it stays true. As of this commit the chain runs `001_init.sql` to `047_radar_drafts.sql`, forty-seven files. Order matters: several migrations alter what an earlier one created, and `045_connect_handles.sql` in particular has to run after `040_api_key_scopes.sql`. Every migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DO $$ ... IF NOT EXISTS ... $$`), so re-running one, or the whole chain, is safe — this is verified by applying all forty-seven twice against an empty database.

   The files in `schema/tests/` are destructive test programs for a scratch database and must never run against a real install.

   One file wants editing before you run it: `032_comped_accounts.sql` carries a placeholder list of internal addresses that are never billed and are exempt from the expiry sweep. Put your own addresses in it, or leave it empty.

   The five most recent migrations, so you can see where the chain currently ends:
   - `043_trust_layer_foundation.sql` — per-customer handles, the permanent registry of claimed names behind them, the per-share hostname the proxy routes on, and the private `share_lookup` view the proxy reads instead of three separate tables.
   - `044_notification_reconciler.sql` — `reconcile_notification_sends()`, which moves a notification row off `queued` by joining it against `pg_net`'s own response table.
   - `045_connect_handles.sql` — the short-lived, single-use handoff from the signed-in consent page to the remote MCP connector; only a hash of the handle is stored.
   - `046_connector_grants.sql` — what the application knows about each remote-connector connection and what became of it.
   - `047_radar_drafts.sql` — the drafted-reply queue and the reservation ledger behind "one comment per thread, five a day".

5. Extensions. Two are required and both exist on every Supabase tier, so there is nothing to install:
   - `pgcrypto` — `gen_random_uuid`, `digest` and `hmac`, used throughout.
   - `pg_net` — the asynchronous HTTP call the notification triggers make.

   `001_init.sql` runs `create extension if not exists` for both, so a Supabase project needs no preparation. A third extension, `pg_cron`, is **optional**: `044_notification_reconciler.sql` uses it to run the notification reconciler every ten minutes and `045_connect_handles.sql` uses it to sweep unclaimed consent handles every five. Where `pg_cron` is absent — a plain self-hosted Postgres, a scratch test database — both migrations log a notice, skip the scheduling and carry on. Nothing fails, and both functions stay callable by hand or from any scheduler you already run. If you skip `pg_cron`, schedule `reconcile_notification_sends()` and `purge_connect_handles()` yourself, or accept that notification rows stay at `queued` and unclaimed handles expire without being deleted.

6. Resend secrets via Supabase Vault (not `ALTER DATABASE SET` — that needs superuser, which Supabase free doesn't grant). In `SQL Editor`:
   ```sql
   select vault.create_secret('re_your_resend_api_key', 'resend_api_key');
   select vault.create_secret('hello@yourdomain.com',  'resend_from');
   ```
   Vault is a native Supabase feature (built on pgsodium) available on every tier. `notify_on_first_open` reads decrypted secrets at trigger time.
7. Session auth uses per-session bearer tokens stored on the `sessions.token` column — no app-level secret needed for the session layer. The proxy gate (email + password cookies) does use an HMAC secret; set it as a worker secret in step 3 below.
8. In `Authentication → Providers`, enable **Google** (use your own OAuth credentials) or rely on the magic-link fallback. The site URL must include your domain plus `http://localhost:3000` if you also want local dev to authenticate.

## 2. Cloudflare

1. Create an R2 bucket called `htmlradar-docs` (or change the name in `wrangler.toml` and `.env.local`).
2. From `Manage R2 API tokens`, create a token with read+write on this bucket. Copy the access key ID + secret.
3. Create an API token from `My Profile → API Tokens → Custom Token` with these permissions (account-scoped + zone-scoped):
   - Account: Workers Scripts (Edit), Workers R2 Storage (Edit), Cloudflare Pages (Edit), Account Settings (Read)
   - Zone: Zone (Read), DNS (Edit), Cache Purge (Purge), Zone Settings (Edit), Workers Routes (Edit)
   - Add Account: Workers KV Storage (Edit) only if you are deploying the MCP connector.
   - Workers Routes must be Edit on **both** zones if you run the application and the content domain on two domains: `wrangler deploy` syncs the proxy's route block, and it has an entry on each.
4. Note your `Account ID` (top-right of any Cloudflare dashboard page).
5. Only if you are deploying the MCP connector: create a Workers KV namespace and put its id in `packages/connector/wrangler.toml`. It holds the OAuth clients, grants and tokens, and nothing a person typed.

## 3. Deploy

### What gets deployed where

Four things run on Cloudflare. Two of them are optional and the install works without either.

| Package              | Deployed as   | Address               | Needed?                                                        |
| -------------------- | ------------- | --------------------- | -------------------------------------------------------------- |
| `packages/app`       | Pages project | your application host | Required — the sender's dashboard and the marketing site       |
| `packages/proxy`     | Worker        | your content host     | Required — every recipient link is served by it                |
| `packages/monitor`   | Worker (cron) | a `workers.dev` URL   | Optional — health checks, alert email, analytics replay        |
| `packages/connector` | Worker        | `mcp.<your-domain>`   | Optional — only if you want Claude to connect by pasting a URL |

`packages/tracker` and `packages/mcp` are not deployed. The tracker is a bundle the Pages app serves
and the proxy injects; the MCP server is an npm package people run on their own machines.

The reference deploy is fully automated by `.github/workflows/deploy.yml` — preview, smoke test,
production, then the proxy, monitor and connector Workers, then a cache purge. If you want to deploy
from your laptop, the manual sequence is:

```bash
# Tracker bundle — the Pages app serves it and the proxy injects it on every
# recipient view. Build it FIRST: the copy committed at
# packages/app/public/v1/tracker.js is overwritten here, and deploying without
# this step ships whatever that stale file happens to hold.
cd packages/tracker && pnpm build
cp dist/tracker.js ../app/public/v1/tracker.js

# Proxy worker — required
cd ../proxy
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY          # passed to the tracker as data-supabase-anon-key
wrangler secret put SESSION_SECRET             # openssl rand -hex 32
wrangler secret put CLOUDFLARE_R2_ACCESS_KEY_ID
wrangler secret put CLOUDFLARE_R2_SECRET_ACCESS_KEY
wrangler deploy

# Monitor cron worker — optional. Two secrets make it useful; the rest are
# features you may not want. Full list and what each one turns on:
# packages/monitor/README.md.
cd ../monitor
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put RESEND_API_KEY             # alert email
wrangler secret put POSTHOG_PROJECT_KEY        # optional: app_events replay into PostHog
wrangler secret put QA_BOT_USER_ID             # optional: QA account excluded from the replay
wrangler secret put TELEGRAM_BOT_TOKEN         # optional: daily digest destination
wrangler secret put TELEGRAM_CHAT_ID           # optional: daily digest destination
wrangler deploy

# Remote MCP connector worker — optional. Skip the whole block unless you want
# a paste-one-address connector. Set APP_BASE_URL, API_BASE_URL and SERVER_URL
# in packages/connector/wrangler.toml to your own hosts first, and create your
# own KV namespace and put its id there. The same two secrets must also be set
# on the Pages project (below): the two sides share them.
cd ../connector
wrangler secret put CONNECT_SIGNING_SECRET     # openssl rand -hex 32
wrangler secret put CONNECT_EXCHANGE_SECRET    # openssl rand -hex 32, a different value
wrangler deploy

# Web app (Cloudflare Pages — NOT Vercel)
cd ../app
pnpm exec next-on-pages
wrangler pages deploy .vercel/output/static --project-name=htmlradar --branch=main

# Pages secrets, only if you deployed the connector. Same values as above.
wrangler pages secret put CONNECT_SIGNING_SECRET --project-name=htmlradar
wrangler pages secret put CONNECT_EXCHANGE_SECRET --project-name=htmlradar
```

### Environment variables

Every variable is documented inline in [`.env.example`](../.env.example), which is the list of
record; this is the shape of it. Copy it to `.env.local` and fill it in.

Three are read by Next.js **at build time** and are baked into the bundle, so they must be set before
`pnpm build` or `next-on-pages`, not afterwards:

| Variable                        | What it is                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Your project URL. Blank means the build fails while pre-rendering `/`, `/pricing`, `/privacy`, `/terms` and `/why`, with `Your project's URL and Key are required to create a Supabase client!` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon key. Public by design; RLS is what gates writes. Same failure if blank                                                                                                                 |
| `NEXT_PUBLIC_SHARE_BASE`        | The base of every recipient link the app prints. Must be `https://` plus `SHARE_HOST`                                                                                                           |

The rest are runtime configuration for the app and the Workers, grouped the way `.env.example` groups
them: core self-hosting (`SUPABASE_*`, `CLOUDFLARE_*`, `SESSION_SECRET`, `SHARE_HOST`,
`LEGACY_HOSTS`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAILS`); optional billing through Polar
(`POLAR_*`), which you can leave blank entirely if you are not selling hosting; the monitor Worker's
own settings (`ALERT_TO`, `POSTHOG_*`, `TELEGRAM_*`); the Playwright smoke tests (`PLAYWRIGHT_*`,
`QA_*`, `HR_FIXTURE_DIR`, `PROXY_BASE`); and publishing (`INDEXNOW_KEY`, `HTMLRADAR_API_KEY`,
`HTMLRADAR_API_URL`, `CONNECT_SIGNING_SECRET`, `CONNECT_EXCHANGE_SECRET`,
`NEXT_PUBLIC_CONNECTOR_ORIGIN`).

In production none of the secret values live in a file. Worker secrets are set with
`wrangler secret put`, Pages secrets with `wrangler pages secret put`, and the deploy workflow reads
both from GitHub repository secrets. `.env.production` is written at build time by the workflow and
holds only four values — the three above plus `NEXT_PUBLIC_TRUST_HANDLES`, which the workflow reads
out of `packages/proxy/wrangler.toml` so the Worker and the application cannot disagree about it.
Never commit `.env.production`. `.env.example` is the only environment file that belongs in git.

## Two domains, and why

Recipient documents are served from a domain of their own, separate from the one that runs the application. HTMLRadar uses `htmlradar.page` for documents and `htmlradar.com` for everything else.

The reason is that a recipient document is HTML somebody else wrote. Serving it on the application's domain puts a stranger's markup on the same origin as a signed-in session, and lets anyone who uploads a convincing fake sign-in page have it served under the application's own certificate and reputation. A second registrable domain removes both: the document's origin holds no application cookies, and if the content domain ever earns a place on a phishing blocklist, the application domain is not on it.

You can run both roles on one domain if you are self-hosting for a team that only ever sends its own documents. Set `SHARE_HOST` to that domain and leave `LEGACY_HOSTS` empty. You are choosing to keep the exposure above; nothing else changes.

Three settings carry the split, and they have to agree:

| Setting                  | Where                                      | What it does                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHARE_HOST`             | `[vars]` in `packages/proxy/wrangler.toml` | The host the worker serves documents on. Anything on it that is not a share is a 404, and `/robots.txt` there disallows everything. Default `htmlradar.page`.                                                               |
| `LEGACY_HOSTS`           | `[vars]` in `packages/proxy/wrangler.toml` | Comma-separated hosts that used to serve `/r/` and now only redirect to `SHARE_HOST`. Empty in the shipped file, which means no host redirects and every host serves documents in place. Leave it empty if you never moved. |
| `NEXT_PUBLIC_SHARE_BASE` | build-time env for `packages/app`          | The base the app puts in every link it creates or prints, scheme included. Default `https://htmlradar.page`. Must be `https://` + `SHARE_HOST`.                                                                             |

Links created before a move are not rewritten in the database. A `GET` or `HEAD` on a legacy host is answered with a `301` to the same path and query on `SHARE_HOST`, so old links keep opening. A `POST` is served where it was sent instead, because a `301` would turn it into a `GET` and drop the body — that keeps the password gate, the email gate and the opt-out confirmation working in tabs that were already open when the switch happened. Serving `POST` in place only matters for about thirty days after a move; after that the redirect can cover every method.

The read-tracking opt-out cookie is scoped to `Path=/r/` on whichever host served the document, so opt-outs recorded on a legacy host do not carry over to `SHARE_HOST`. A recipient who had turned tracking off before a move is asked again the first time they open a link afterwards.

## DNS

Point the relevant routes at Cloudflare:

- `htmlradar.com` and `www.htmlradar.com` → Cloudflare Pages project (`htmlradar`)
- `htmlradar.page/*` → proxy worker (whole zone; set via worker route in `packages/proxy/wrangler.toml`)
- `htmlradar.com/r/*` → proxy worker as well, where it only redirects to `htmlradar.page`
- `htmlradar.page/v1/tracker.js` → served by the proxy worker, which fetches it from `TRACKER_URL` so the tracker is first-party to the document that loads it
- `htmlradar.com/v1/tracker.js` → served by the Pages app from `public/v1/tracker.js` (copied at build time); this is what `TRACKER_URL` points at

The content domain needs a DNS record for the worker route to attach to. A proxied placeholder `AAAA` record for `@` pointing at `100::` is the usual one — the worker answers before anything reaches it. SSL/TLS mode on both zones must be Full or Full (strict).

Deploying the proxy syncs both `[[routes]]` entries, so the Cloudflare API token needs **Workers Routes: Edit on both zones**, not just one.

For your own domains, substitute `htmlradar.com` and `htmlradar.page` with yours throughout — including the hardcoded site URL in `packages/app/src/app/sitemap.ts`, `robots.ts`, and `lib/seo.ts` (the app deliberately does not read `NEXT_PUBLIC_APP_URL` for these; see the comment in `sitemap.ts`).

## Verifying the install

A working install passes this checklist:

- Sign in works (Google or magic link)
- Uploading an HTML file shows up at `/docs`
- Creating a share returns a `{SHARE_HOST}/r/{slug}` URL
- Opening the same path on a legacy host answers `301` to `SHARE_HOST`
- Opening that URL prompts the email gate, shows the document, and starts a session
- Within 30 seconds of active reading (idle watchdog gates after 5s without scroll/keydown/touch), the dashboard shows the session with section dwell

If any step fails, check the Worker logs in Cloudflare and the Supabase auth + `error_log` table.
