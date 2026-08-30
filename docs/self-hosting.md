# Self-hosting

HTMLRadar runs on two vendors. Both offer free tiers that comfortably cover personal use.

| Service    | What it does                                                      | Free tier               |
| ---------- | ----------------------------------------------------------------- | ----------------------- |
| Supabase   | Postgres database, auth, vault for secrets                        | 500 MB DB, 50 K MAU     |
| Cloudflare | Workers (proxy + monitor cron), R2 (storage), Pages (Next.js app) | 100 K req/day, 10 GB R2 |

You also need a domain (any) and a [Resend](https://resend.com) account (free 100 emails/day) for view notifications. Email notifications are optional — without Resend the `notify_on_first_open` trigger writes a `skipped` row to `notifications_log` and everything else works.

## 1. Supabase

1. Create a project. Note the region — pick one close to your users.
2. From `Project Settings → API`, copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — never put in client code)
3. From `Project Settings → Database`, note your DB password.
4. In `SQL Editor`, copy/paste every numbered file directly under `schema/`, in order, `001` through `035` — and nothing in `schema/tests/`. The files in `schema/tests/` are destructive test programs for a scratch database and must never run against a real install. Each migration is idempotent; re-running is safe. The most recent migrations:
   - `030_notification_email_utm.sql` — UTM parameters on the dashboard links inside notification emails.
   - `031_notify_email_tell_a_friend.sql` — one "tell a friend" line in the first-read notification email.
   - `032_comped_accounts.sql` — `profiles.comped` for internal / lifetime-Pro accounts (never billed, exempt from the expiry sweep) plus column-level lockdown of `profiles` updates. Put your own addresses in its placeholder list before running it.
   - `033_custom_share_slug.sql` — Pro customers may choose a tracked link's address; the rules are enforced in the database.
   - `034_api_keys.sql` — `api_keys` table (hash only) and the `create_share_as` RPC for the public API.
   - `035_api_rate_limits.sql` — rate limits for the public API and a daily ceiling on API-key creation.
5. Resend secrets via Supabase Vault (not `ALTER DATABASE SET` — that needs superuser, which Supabase free doesn't grant). In `SQL Editor`:
   ```sql
   select vault.create_secret('re_your_resend_api_key', 'resend_api_key');
   select vault.create_secret('hello@yourdomain.com',  'resend_from');
   ```
   Vault is a native Supabase feature (built on pgsodium) available on every tier. `notify_on_first_open` reads decrypted secrets at trigger time.
6. Session auth uses per-session bearer tokens stored on the `sessions.token` column — no app-level secret needed for the session layer. The proxy gate (email + password cookies) does use an HMAC secret; set it as a worker secret in step 3 below.
7. In `Authentication → Providers`, enable **Google** (use your own OAuth credentials) or rely on the magic-link fallback. The site URL must include your domain plus `http://localhost:3000` if you also want local dev to authenticate.

## 2. Cloudflare

1. Create an R2 bucket called `htmlradar-docs` (or change the name in `wrangler.toml` and `.env.local`).
2. From `Manage R2 API tokens`, create a token with read+write on this bucket. Copy the access key ID + secret.
3. Create an API token from `My Profile → API Tokens → Custom Token` with these permissions (account-scoped + zone-scoped):
   - Account: Workers Scripts (Edit), Workers R2 Storage (Edit), Cloudflare Pages (Edit), Account Settings (Read)
   - Zone: Zone (Read), DNS (Edit), Cache Purge (Purge), Zone Settings (Edit)
4. Note your `Account ID` (top-right of any Cloudflare dashboard page).

## 3. Deploy

The reference deploy is fully automated by `.github/workflows/deploy.yml` (preview → smoke → prod, plus proxy + monitor workers, plus a cache purge). If you want to deploy from your laptop, the manual sequence is:

```bash
# Tracker bundle — proxy injects this on every recipient view.
cd packages/tracker && pnpm build
cp dist/tracker.js ../app/public/v1/tracker.js

# Proxy worker
cd ../proxy
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SESSION_SECRET             # openssl rand -hex 32
wrangler secret put CLOUDFLARE_R2_ACCESS_KEY_ID
wrangler secret put CLOUDFLARE_R2_SECRET_ACCESS_KEY
wrangler deploy

# Monitor cron worker (full list of secrets in packages/monitor/README.md)
cd ../monitor
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put POSTHOG_PROJECT_KEY        # optional: app_events replay into PostHog
wrangler secret put QA_BOT_USER_ID             # optional: QA account excluded from the replay
wrangler deploy

# Web app (Cloudflare Pages — NOT Vercel)
cd ../app
pnpm exec next-on-pages
wrangler pages deploy .vercel/output/static --project-name=htmlradar --branch=main
```

Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and any other public env vars in `.env.production` (written at build time — the workflow does this from GitHub secrets). NEVER commit `.env.production` itself; only `.env.example`.

## DNS

Point the relevant routes at Cloudflare:

- `htmlradar.com` and `www.htmlradar.com` → Cloudflare Pages project (`htmlradar`)
- `htmlradar.com/r/*` → proxy worker (set via worker route in `packages/proxy/wrangler.toml`)
- `htmlradar.com/v1/tracker.js` → served by the Pages app from `public/v1/tracker.js` (copied at build time)

For your own domain, substitute `htmlradar.com` with yours throughout — including the hardcoded site URL in `packages/app/src/app/sitemap.ts`, `robots.ts`, and `lib/seo.ts` (the app deliberately does not read `NEXT_PUBLIC_APP_URL` for these; see the comment in `sitemap.ts`).

## Verifying the install

A working install passes this checklist:

- Sign in works (Google or magic link)
- Uploading an HTML file shows up at `/docs`
- Creating a share returns a `/r/{slug}` URL
- Opening that URL prompts the email gate, shows the document, and starts a session
- Within 30 seconds of active reading (idle watchdog gates after 5s without scroll/keydown/touch), the dashboard shows the session with section dwell

If any step fails, check the Worker logs in Cloudflare and the Supabase auth + `error_log` table.
