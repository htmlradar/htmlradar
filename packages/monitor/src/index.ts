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
// Plus one non-alerting job: replay new app_events rows into PostHog
// (see replayAppEvents below). This is the "PostHog-shaped, replay
// later" plan from schema/006_observability.sql — events stay
// first-party in the browser (no third-party tracker, per /privacy);
// PostHog only ever sees them server-side, as a dashboard over data
// we already own. Replay failures log to console, never email — a
// lagging dashboard is not pageable.
//
// Not in scope (deliberately): tracker bundle version, R2 health,
// section_events capture rate, payment webhooks. Those are real
// signals but the bar here is "the simplest thing that would have
// caught the email regression before the founder noticed it manually."

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  ALERT_TO: string;
  POSTHOG_HOST: string;
  POSTHOG_PROJECT_KEY: string;
  QA_BOT_USER_ID: string;
}

const ROUTES = ['/', '/pricing', '/docs', '/sign-in'];

// ---------------------------------------------------------------------------
// app_events → PostHog replay.
//
// Cursor lives in analytics_replay_cursor (schema/029). Each run reads
// rows with id > cursor in batches, maps them to PostHog's /batch shape,
// POSTs, then advances the cursor. If PostHog or Supabase is down the
// cursor simply doesn't move and the next run retries — at-least-once
// delivery, with a deterministic per-row uuid so PostHog dedupes the
// rare double-send after a cursor write failure.

interface AppEventRow {
  id: number;
  distinct_id: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  user_id: string | null;
}

// Deterministic uuid from the bigserial id — same row always maps to the
// same uuid, so re-sent batches are idempotent on the PostHog side.
function rowUuid(id: number): string {
  const hex = id.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function toPostHogEvent(row: AppEventRow): Record<string, unknown> {
  const props: Record<string, unknown> = { ...row.properties };
  let event = row.event;
  if (event === 'page.viewed') {
    // Map to PostHog's native pageview so path/referrer breakdowns and
    // default insights work out of the box.
    event = '$pageview';
    const path = typeof props['path'] === 'string' ? (props['path'] as string) : '/';
    props['$current_url'] = `https://htmlradar.com${path}`;
    props['$pathname'] = path;
    if (props['referrer']) props['$referrer'] = props['referrer'];
  } else if (event === '$identify' && props['alias_fingerprint']) {
    // Merge the pre-signup anon fingerprint person into the user person.
    props['$anon_distinct_id'] = props['alias_fingerprint'];
  }
  // Signup/signin carry email (auth/callback) — set it as a person
  // property so people are recognizable in the PostHog UI.
  if ((event === 'user.signed_up' || event === 'user.signed_in') && props['email']) {
    props['$set'] = { email: props['email'] };
  }
  return {
    event,
    distinct_id: row.distinct_id,
    timestamp: row.timestamp,
    uuid: rowUuid(row.id),
    properties: props,
  };
}

async function replayAppEvents(env: Env): Promise<void> {
  // No PostHog project wired yet → replay is a no-op. The cursor stays
  // put, so the full history backfills the moment a key is configured.
  if (!env.POSTHOG_PROJECT_KEY) return;
  const sbHeaders = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  const cursorRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/analytics_replay_cursor?id=eq.1&select=last_event_id`,
    { headers: sbHeaders },
  );
  if (!cursorRes.ok) throw new Error(`cursor read HTTP ${cursorRes.status}`);
  const cursorRows = (await cursorRes.json()) as { last_event_id: number }[];
  let cursor = cursorRows[0]?.last_event_id ?? 0;

  // Bounded batches per run; the 5-min cadence absorbs any backlog.
  for (let i = 0; i < 5; i++) {
    const rowsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/app_events` +
        `?id=gt.${cursor}&order=id.asc&limit=500` +
        `&select=id,distinct_id,event,properties,timestamp,user_id`,
      { headers: sbHeaders },
    );
    if (!rowsRes.ok) throw new Error(`events read HTTP ${rowsRes.status}`);
    const rows = (await rowsRes.json()) as AppEventRow[];
    if (rows.length === 0) return;

    // QA bot smoke-test traffic would poison funnels — skip its rows
    // (cursor still advances past them).
    const batch = rows
      .filter((r) => r.distinct_id !== env.QA_BOT_USER_ID && r.user_id !== env.QA_BOT_USER_ID)
      .map(toPostHogEvent);

    if (batch.length > 0) {
      const phRes = await fetch(`${env.POSTHOG_HOST}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: env.POSTHOG_PROJECT_KEY, batch }),
      });
      if (!phRes.ok) throw new Error(`posthog batch HTTP ${phRes.status}`);
    }

    cursor = rows[rows.length - 1]!.id;
    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/analytics_replay_cursor?id=eq.1`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ last_event_id: cursor, updated_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) throw new Error(`cursor write HTTP ${patchRes.status}`);
    if (rows.length < 500) return;
  }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Analytics replay runs alongside the health checks; failures log
    // only (cursor doesn't advance, next run retries).
    ctx.waitUntil(
      replayAppEvents(env).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[replay] failed:', (err as Error).message);
      }),
    );

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
