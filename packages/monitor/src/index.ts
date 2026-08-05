// htmlradar-monitor — minimal cron worker that pages the founder when
// prod looks broken. Runs every 5 min. Stupid simple by design.
//
// Four checks:
//   1. notifications_log has any status='failed' rows in the last 30
//      min. This catches the migration-013 class of bug where a
//      backend regression silently drops customer-facing emails.
//   2. The four critical user-facing routes (/, /pricing, /docs,
//      /sign-in) return HTTP 200. Catches deploy-broken-prod cases.
//   3. webhook_events_log has failed-and-unprocessed Polar events
//      (checkWebhookHealth). See its comment block.
//   4. The Pro expiry sweep (expirePro) demoted somebody. Not a
//      failure — a lapse is routine — but money moved, so it rides
//      the same email rather than dying in a log nobody reads.
//      Gated on check 3: while billing is broken the sweep cannot
//      tell a lapsed account from an undelivered renewal, so it
//      stands down rather than risk downgrading a paying customer.
//
// When ANY check trips, sends ONE consolidated alert email to
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
// section_events capture rate. Those are real signals but the bar
// here is "the simplest thing that would have caught the email
// regression before the founder noticed it manually." Payment
// webhooks used to be on that list; 40 days of silently 401-ing
// order webhooks is what took them off it.

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

// ---------------------------------------------------------------------------
// Pro expiry sweep.
//
// Entitlement is read from profiles.tier and nothing else (quota.ts,
// proxy/supabase.ts, schema/027 all branch on tier alone); pro_until is
// display-only. So a lapsed Pro kept full Pro access forever — no code path
// anywhere demoted anyone. This is the backstop: tier follows pro_until every
// 5 min regardless of what the Polar webhook did, didn't do, or got wrong.
// It is deliberately dumb — it reads one column and writes one column, so it
// keeps working when the billing integration is the thing that's broken.
//
// comped=true is the carve-out for internal accounts: Pro with no Polar
// subscription, so their pro_until is meaningless and must never be acted on.
// The filter is on the SQL side, not in a code branch here, so there is no
// version of "the sweep forgot" that downgrades the founder.
//
// Deliberately NOT swept: tier='pro' with pro_until IS NULL. PostgREST's lt.
// filter skips nulls already, and that is the behaviour we want. The webhook
// cannot produce that row — computeTierUpdate only returns tier='pro' on a
// non-null current_period_end — and checkout never writes tier at all, so no
// in-flight upgrade passes through that state. The only realistic source is a
// hand-run grant where someone forgot comped=true, and silently demoting a
// manually granted account is a worse failure than leaving one row on Pro
// until a human looks at it.

interface DowngradedProfile {
  email: string;
}

// Grace period before a lapsed pro_until is acted on. pro_until is only ever
// advanced by the Polar webhook, so "pro_until is in the past" means either the
// customer really lapsed OR the renewal simply hasn't been delivered yet — and
// from inside this worker those are indistinguishable. Downgrading at the exact
// instant would turn any webhook latency into a paying customer losing access.
// Three days is comfortably longer than Polar's delivery-and-retry window and
// far shorter than the open-ended leak this sweep exists to close. It costs
// nothing in the normal case: a genuine cancel or revoke is handled instantly by
// computeTierUpdate, never by this sweep.
const EXPIRY_GRACE_MS = 3 * 24 * 60 * 60_000;

async function expirePro(env: Env): Promise<DowngradedProfile[]> {
  const cutoff = new Date(Date.now() - EXPIRY_GRACE_MS).toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles` +
      `?tier=eq.pro&comped=is.false&pro_until=lt.${encodeURIComponent(cutoff)}` +
      `&select=email`,
    {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        // return=representation so a downgrade is nameable in the alert
        // email — "3 accounts" with no emails is not actionable.
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ tier: 'free' }),
    },
  );
  // Fails closed: if the comped column is missing (migration not applied yet)
  // PostgREST 400s the whole statement rather than downgrading anyone without
  // the carve-out, and the caller turns that into an alert.
  if (!res.ok) throw new Error(`expire PATCH HTTP ${res.status}`);
  return (await res.json()) as DowngradedProfile[];
}

// ---------------------------------------------------------------------------
// Polar webhook silent-failure alarm.
//
// The reason this file grew: an expired POLAR_API_KEY made every order.created
// / order.paid webhook 401 for 40 days. Each failure wrote its message into
// webhook_events_log.error and left processed_at null, so the evidence sat in
// the table the whole time with nobody reading it. It was invisible from the
// product side too — renewals stopped extending pro_until, but since nothing
// demoted anyone, nobody complained. Silence looked exactly like health.
//
// Deliberately NO time window on this query. The obvious version looks back an
// hour, and it would have stayed silent through the very outage that prompted
// it: Polar exhausts its retries within a few hours, after which the failed rows
// stop being recent and a windowed alarm goes quiet while the breakage is still
// total. A row that is errored AND unprocessed does not heal on its own — it
// means a real payment event was never applied and a human has to act — so it
// should keep paging until someone resolves it. Resolution is deliberate: fix
// the cause, then stamp processed_at (or clear error) on the rows.
//
// The cost is that this pages every 5 minutes until acknowledged, which is loud.
// That is the correct direction to be wrong in; the alternative we just lived
// through was 40 days of true negatives.

interface WebhookFailureRow {
  event_type: string;
  error: string;
}

async function checkWebhookHealth(env: Env): Promise<string | null> {
  // Hits the partial index from schema/022 (received_at where processed_at is
  // null). limit=20 keeps the body small during a sustained outage; the exact
  // total comes from the count header, same trick as check 1 below.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/webhook_events_log` +
      `?processed_at=is.null&error=not.is.null` +
      `&select=event_type,error&limit=20`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact',
      },
    },
  );
  if (!res.ok) throw new Error(`webhook_events_log read HTTP ${res.status}`);
  const rows = (await res.json()) as WebhookFailureRow[];
  if (rows.length === 0) return null;
  const range = res.headers.get('content-range') ?? '0-0/0';
  const total = parseInt(range.split('/')[1] ?? '0', 10) || rows.length;
  const types = [...new Set(rows.map((r) => r.event_type))].join(', ');
  // The example error string is the whole point — it's the difference between
  // the founder rotating a key from their phone and opening a SQL client.
  return (
    `${total} Polar webhook event(s) failed and are still unprocessed ` +
    `[${types}]. Example error: "${rows[0]!.error}". ` +
    `Paid upgrades and renewals are NOT being applied while this persists.`
  );
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

    // Check 3: Polar webhooks failing silently. Runs BEFORE the expiry sweep
    // because its result gates the sweep — see check 4.
    let billingBroken = false;
    try {
      const webhookAlert = await checkWebhookHealth(env);
      if (webhookAlert) {
        alerts.push(webhookAlert);
        billingBroken = true;
      }
    } catch (err) {
      // Couldn't read the table, so we cannot claim billing is healthy.
      // Treat unknown as broken and hold the sweep — declining to downgrade is
      // always the recoverable direction.
      alerts.push(`Couldn't read webhook_events_log: ${(err as Error).message}`);
      billingBroken = true;
    }

    // Check 4: expire lapsed Pro accounts. Runs inline (not waitUntil) so a
    // downgrade rides the same consolidated email — a tier flip is money
    // changing hands and should not be console-only.
    //
    // Gated on check 3. The sweep infers "stopped paying" from a stale
    // pro_until, but pro_until only ever advances when the Polar webhook lands.
    // While webhooks are failing, a stale pro_until is exactly what a HEALTHY
    // paying customer looks like, so the sweep's core assumption is false
    // precisely when it would do the most damage. Skip it and say so. The
    // accounts it would have caught are still there once billing recovers;
    // a wrongly downgraded paying customer is a support ticket and a refund.
    if (billingBroken) {
      alerts.push(
        'Pro expiry sweep SKIPPED this run — Polar webhooks are unhealthy, so a ' +
          'stale pro_until cannot be distinguished from an undelivered renewal. ' +
          'It resumes automatically once the webhook failures above clear.',
      );
    } else {
      try {
        const downgraded = await expirePro(env);
        if (downgraded.length > 0) {
          alerts.push(
            `Downgraded ${downgraded.length} lapsed Pro account(s) to free: ` +
              `${downgraded.map((p) => p.email).join(', ')}. Routine after a cancel or a ` +
              `revoke — but if any of these should still be paying, the billing side is wrong.`,
          );
        }
      } catch (err) {
        alerts.push(`Pro expiry sweep failed: ${(err as Error).message}`);
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
