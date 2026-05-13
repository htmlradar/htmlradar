# Self-hosting

HTMLRadar runs on three services. All offer free tiers that comfortably cover personal use.

| Service    | What it does                               | Free tier               |
| ---------- | ------------------------------------------ | ----------------------- |
| Supabase   | Postgres database, auth, storage           | 500 MB DB, 50 K MAU     |
| Cloudflare | Workers (proxy), R2 (storage), Pages (CDN) | 100 K req/day, 10 GB R2 |
| Vercel     | Next.js web app                            | Hobby plan              |

You also need a domain (any) and a [Resend](https://resend.com) account (free 100 emails/day) for view notifications.

## 1. Supabase

1. Create a project. Note the region — pick one close to your users.
2. From `Project Settings → API`, copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — never put in client code)
3. From `Project Settings → Database`, note your DB password.
4. In `SQL Editor`, run, in order:
   ```sql
   -- Copy/paste the contents of:
   --   schema/001_init.sql
   --   schema/002_rpcs.sql
   --   schema/003_triggers.sql
   ```
5. In `SQL Editor`, set the database settings:
   ```sql
   alter database postgres set app.session_secret = 'your-32-byte-hex';   -- openssl rand -hex 32
   alter database postgres set app.resend_api_key = 're_your_key';
   alter database postgres set app.resend_from    = 'hello@yourdomain.com';
   ```
6. In `Authentication → Providers`, enable **Google** (use your own OAuth credentials) or rely on the magic-link fallback.

## 2. Cloudflare

1. Create an R2 bucket called `htmlradar-docs` (or change the name in `wrangler.toml` and `.env.local`).
2. From `Manage R2 API tokens`, create a token with read+write on this bucket. Copy the access key ID + secret.
3. Create an API token from `My Profile → API Tokens → Custom Token` with these permissions (account-scoped + zone-scoped):
   - Account: Workers Scripts (Edit), Workers R2 Storage (Edit), Cloudflare Pages (Edit), Account Settings (Read)
   - Zone: Zone (Read), DNS (Edit), Cache Purge (Purge), Zone Settings (Edit)
4. Note your `Account ID` (top-right of any Cloudflare dashboard page).

## 3. Deploy

```bash
# Worker (proxy)
cd packages/proxy
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SESSION_SECRET
wrangler deploy

# Tracker (CDN)
cd ../tracker
pnpm build
# Deploy dist/tracker.js to a static host. Cloudflare Pages or any CDN works.

# Web app
cd ../app
# Push to Vercel and add all env vars from .env.example in the Vercel dashboard.
```

## DNS

Point the relevant CNAMEs at the deployed targets:

- `htmlradar.com` and `www.htmlradar.com` → Vercel (web app)
- `htmlradar.com/r/*` route on the proxy worker
- `cdn.htmlradar.com` → wherever you host `tracker.js`

(For your own domain, substitute `htmlradar.com` with yours and update `NEXT_PUBLIC_APP_URL`.)

## Verifying the install

A working install passes this checklist:

- Sign in works (Google or magic link)
- Uploading an HTML file shows up at `/docs`
- Creating a share returns a `/r/{slug}` URL
- Opening that URL prompts the email gate, shows the document, and starts a session
- After ~15 seconds of reading, your dashboard shows the session with section dwell

If any step fails, check the Worker logs in Cloudflare and the Supabase auth logs.
