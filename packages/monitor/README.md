# @htmlradar/monitor

Cloudflare cron Worker. Every five minutes it checks Supabase and the public routes and emails `ALERT_TO` on a regression; once a day it runs the thread scan. It also replays `app_events` rows into PostHog.

## Configuration

Non-sensitive values live in `wrangler.toml` under `[vars]` (`SUPABASE_URL`, `RESEND_FROM`, `ALERT_TO`, `POSTHOG_HOST`).

Everything else is a Worker secret. Set each one once from this directory; the value is stored by Cloudflare and never enters the repository:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # Supabase service-role key
wrangler secret put RESEND_API_KEY              # Resend API key for alert email
wrangler secret put POSTHOG_PROJECT_KEY         # PostHog project key (phc_...) for the app_events replay; unset = replay is a no-op
wrangler secret put QA_BOT_USER_ID              # profile id of the QA smoke-test account; its rows are skipped in the replay
wrangler secret put TELEGRAM_BOT_TOKEN          # optional, daily digest destination
wrangler secret put TELEGRAM_CHAT_ID            # optional, daily digest destination
wrangler secret put ALERT_FEEDS                 # listening-radar Google Alerts RSS feed URLs, newline/comma-separated ('phrase|url' or bare url); secret because a feed URL is readable by anyone holding it; unset = radar reads Hacker News and Reddit only
wrangler secret put RADAR_DRAFTS                # reply-draft feature flag; '1'/'true'/'on' turns on drafted replies in the digest; unset = log-and-mine only
wrangler secret put TELEGRAM_WEBHOOK_SECRET     # shared secret Telegram returns in X-Telegram-Bot-Api-Secret-Token; unset = /telegram/webhook 404s and one-tap posting is off
wrangler secret put TELEGRAM_FOUNDER_USER_ID    # the founder's numeric Telegram user id; every callback and reply must come from it, in TELEGRAM_CHAT_ID, or it is dropped unanswered
wrangler secret put REDDIT_CLIENT_ID            # the 'script' app at reddit.com/prefs/apps
wrangler secret put REDDIT_CLIENT_SECRET        # the same app's secret
wrangler secret put REDDIT_REFRESH_TOKEN        # permanent token from ops/scripts/reddit_auth.py; exchanged for a short-lived access token per post
wrangler secret put REDDIT_USERNAME             # the founder's Reddit handle, for the descriptive User-Agent Reddit asks for
```

Then `pnpm deploy` (which runs `wrangler deploy`).

## The one HTTP path

The Worker is otherwise cron-only, but it answers `POST /telegram/webhook`: this is where Telegram delivers a tap on a draft's **Post as me** / **Skip** buttons, and a reply carrying reworded text. Every request is a 404 unless it is a POST to that exact path carrying `X-Telegram-Bot-Api-Secret-Token` matching `TELEGRAM_WEBHOOK_SECRET` — and a 404 too when that secret is unset, so the endpoint cannot exist before it is protected. Point Telegram at it once with `ops/scripts/telegram_set_webhook.sh <worker url>`. Nothing posts to Reddit except the code path handling a button tap, and a tap counts only when it comes from `TELEGRAM_FOUNDER_USER_ID` in `TELEGRAM_CHAT_ID` and carries a live single-use token bound to the current message, the current version of the text, and a 72-hour expiry. The rails — one comment per thread, five per rolling 24 hours (both enforced atomically by `reserve_radar_post()` in schema/046), terminal states that cannot reopen, and an ambiguous outcome that blocks retries until it is reconciled against the account's own comments — are described in `docs/workstreams/seo-and-indexing/REDDIT-ONETAP-SETUP-2026-09-03.md`.

After `wrangler secret put REDDIT_REFRESH_TOKEN` succeeds, run `python3 ops/scripts/reddit_auth.py --purge-local` to drop the local copy from `code/.env.local`. Until then the credential exists in two places and only one of them is a vault.
