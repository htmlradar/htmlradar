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
wrangler secret put TELEGRAM_BOT_TOKEN          # optional, daily thread scan
wrangler secret put TELEGRAM_CHAT_ID            # optional, daily thread scan
```

Then `pnpm deploy` (which runs `wrangler deploy`).
