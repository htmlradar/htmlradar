// htmlradar-monitor — minimal cron worker that pages the founder when
// prod looks broken. Runs every 5 min. Stupid simple by design.
//
// Two checks:
//   1. notifications_log has any status='failed' rows in the last 30
//      min. This catches the migration-013 class of bug where a
//      backend regression silently drops customer-facing emails.
//   2. The four critical user-facing routes (/, /pricing, /docs,
//      /sign-in) return HTTP 200. Catches deploy-broken-prod cases.
//
// When EITHER check trips, sends ONE consolidated alert email to
// ALERT_TO via Resend. De-dup is handled implicitly by the 5-min
// cadence: if the same issue persists, the founder gets one email
// per 5 min until it clears.
//
// Not in scope (deliberately): tracker bundle version, R2 health,
// section_events capture rate, PostHog ingest, payment webhooks.
// Those are real signals but the bar here is "the simplest thing
// that would have caught the email regression before the founder
// noticed it manually."

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  ALERT_TO: string;
}

const ROUTES = ['/', '/pricing', '/docs', '/sign-in'];

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const alerts: string[] = [];

    // Check 1: notification-email failures
    try {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const url =
        `${env.SUPABASE_URL}/rest/v1/notifications_log` +
        `?status=eq.failed&created_at=gte.${encodeURIComponent(since)}&select=count`;
      const res = await fetch(url, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact',
        },
      });
      // PostgREST puts the count in Content-Range; "0-0/N" form.
      const range = res.headers.get('content-range') ?? '0-0/0';
      const failed = parseInt(range.split('/')[1] ?? '0', 10);
      if (failed > 0) {
        alerts.push(
          `${failed} notification email(s) FAILED in the last 30 min. Check notifications_log.`,
        );
      }
    } catch (err) {
      alerts.push(`Couldn't read notifications_log: ${(err as Error).message}`);
    }

    // Check 2: critical routes return 200
    for (const path of ROUTES) {
      try {
        const res = await fetch(`https://htmlradar.com${path}`, { redirect: 'follow' });
        if (res.status !== 200) {
          alerts.push(`${path} returned HTTP ${res.status} (expected 200)`);
        }
      } catch (err) {
        alerts.push(`${path} fetch threw: ${(err as Error).message}`);
      }
    }

    if (alerts.length === 0) return;

    // Single consolidated alert. Plain text — no template to break.
    const body = [
      'HTMLRadar prod looks unhealthy.',
      '',
      'Checks tripped:',
      ...alerts.map((a) => `  • ${a}`),
      '',
      `Run at: ${new Date().toISOString()}`,
      'Dashboards: https://htmlradar.com/docs · https://dash.cloudflare.com',
    ].join('\n');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [env.ALERT_TO],
        subject: `[HTMLRadar] ${alerts.length} prod check${alerts.length === 1 ? '' : 's'} failing`,
        text: body,
      }),
    });
  },
};
