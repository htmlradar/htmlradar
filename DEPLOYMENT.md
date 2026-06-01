# Deployment

## TL;DR

**To deploy: commit your work and `git push origin main`. That's it.**
CI builds it, smoke-tests it on a preview URL, and promotes to production
only if the smoke test passes. **Never deploy by hand.**

---

## The one rule: never `wrangler pages deploy` from your laptop

Production is deployed **only** by GitHub Actions, from **committed** code on
`main`.

A manual `wrangler pages deploy` ships your _uncommitted working tree_ — a
"dirty" deploy. The next push-triggered CI deploy builds only **committed**
code and **silently overwrites** your manual deploy, reverting anything you
never committed.

> This is exactly the regression on 2026-06-01: the tabbed `/docs/[id]`
> redesign was live via dirty manual deploys but never committed, so a clean
> CI deploy reverted it. Fix was to commit everything and deploy through CI.

**Tell:** in the Cloudflare Pages deployment list, production should always be
`dirty=false`. If you see `dirty=true`, someone hand-deployed uncommitted work.

---

## How a deploy actually runs (`.github/workflows/`)

1. **Push to `main`** → `CI` workflow:
   - **Secret scan** (gitleaks)
   - **Format check** (prettier) · **type-check** (tsc) · **unit tests** (vitest)
2. CI passes → `Deploy` workflow runs automatically:
   - Builds the tracker, then `next-on-pages` for the app
   - Deploys to a **preview** URL (not prod)
   - **Smoke-tests the preview**: `/`, `/pricing`, `/sign-in`, `/docs`,
     `/feedback`, `/v1/tracker.js`, `/sitemap.xml`, `/robots.txt`
   - **Only if smoke passes** → promotes the _same_ build to **production**
   - Deploys the proxy + monitor workers (`packages/proxy`, `packages/monitor`)
   - Purges the Cloudflare edge cache

A broken build stays in preview; prod keeps serving the last good deploy.

---

## Before you push

- **Commit everything.** `git status` must be clean. Uncommitted work does **not**
  deploy — CI builds committed code only.
- **Schema first.** If a change needs a new table/column, apply the migration
  (`schema/NNN_*.sql`) to the **Supabase prod DB before (or with) the deploy**,
  or the live code breaks on missing schema.
- **No real secrets in code.** `.env*` is gitignored. Test fixtures that _look_
  like secrets (e.g. a fake `whsec_…`) must be allowlisted in `.gitleaks.toml`,
  or CI's secret scan blocks the deploy.
- Commit hooks run automatically: **gitleaks** (secrets) + **lint-staged**
  (eslint --fix / prettier --write on staged files).

---

## Check what's live / roll back

- **What's deployed:** Cloudflare dashboard → Pages → `htmlradar` → Deployments.
  Each entry shows the commit hash and `dirty` flag. Prod should be `dirty=false`.
- **Roll back:** in that list, "Rollback to this deployment" on the last good
  entry — instant, no rebuild. (Note: this reverts code only, not DB migrations.)

---

## Required GitHub repo secrets (Settings → Secrets and variables → Actions)

- `CLOUDFLARE_API_TOKEN` — Pages:Edit + Workers Scripts:Edit
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` (inlined at build)
- `CLOUDFLARE_ZONE_ID` _(optional — enables edge cache purge)_

---

## Architecture note: two deploy targets

- **App** (`packages/app`, Next.js) → Cloudflare **Pages** (static marketing
  pages are prerendered assets; authed/dynamic routes use `runtime = 'edge'`).
- **Proxy** (`packages/proxy`) → a separate **Worker** serving `htmlradar.com/r/*`
  (recipient view + tracker injection). The Deploy workflow ships it too — a
  proxy change isn't live until that step runs.
