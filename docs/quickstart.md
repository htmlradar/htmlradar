# Quickstart

The hosted version at [htmlradar.com](https://htmlradar.com) is the fastest path. This guide is for developers who want to run HTMLRadar themselves.

## Hosted (no setup)

1. Sign up at [htmlradar.com](https://htmlradar.com) with Google.
2. Upload an HTML file or paste a URL.
3. Click **Create share**. Copy the link.
4. Send.

Free tier: 2 tracked links lifetime, unlimited documents, 20 attachments per doc (25 MB each, 100 MB total).

## Local development

You need Node ≥20 and PNPM ≥10.

```bash
git clone https://github.com/htmlradar/htmlradar.git
cd htmlradar
cp .env.example .env.local  # then fill in keys
pnpm install
pnpm dev                    # all packages, parallel
```

`pnpm dev` runs:

- `packages/tracker` — esbuild watch, emits `dist/tracker.js`
- `packages/proxy` — `wrangler dev`, serves `/r/{slug}`
- `packages/app` — `next dev`, serves the web app at http://localhost:3000

## Required environment

Open `.env.local` and fill in:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=        # same as SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # same as SUPABASE_ANON_KEY
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
RESEND_API_KEY=
SESSION_SECRET=                  # openssl rand -hex 32
STRIPE_PAYMENT_LINK_URL=
```

For a full self-host setup including Supabase schema application and Cloudflare R2 bucket creation, see [`self-hosting.md`](./self-hosting.md).

## First request

1. In the web app at http://localhost:3000, sign in.
2. Create a document.
3. Create a share for it.
4. Open the share URL in an incognito window.
5. Enter an email at the gate.
6. Scroll. Wait 3+ seconds on a section.
7. Return to your dashboard. The session and section dwell will appear.

If sections don't track, the tracker tried six fallback layers before giving up: explicit `[id]` anchored headings → bare `<h1>/<h2>/<h3>` (slugified from text) → slide containers (`section`, `[class*="slide"]`, `[data-slide]`) → article containers → paragraph buckets on plain prose. If none of those match, your doc probably has only one viewport-sized block — there's nothing to split. Adding any `<h2>` headings is the simplest fix; explicit `id` attributes aren't required.
