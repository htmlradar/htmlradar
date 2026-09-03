// htmlradar-monitor — minimal cron worker that pages the founder when
// prod looks broken. Runs every 5 min. Stupid simple by design.
//
// Four checks:
//   1. notifications_log has any status='failed' rows in the last 30
//      min. This catches the migration-013 class of bug where a
//      backend regression silently drops customer-facing emails.
//   2. The four critical user-facing routes (/, /pricing, /docs,
//      /sign-in) return HTTP 200, and the content domain that serves
//      recipient documents answers on both a share path and
//      robots.txt. Retried before paging so a transient edge blip
//      doesn't. Catches deploy-broken-prod cases.
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
// And a second daily job that watches the company rather than the product: the
// maintenance sentinel at 03:30 UTC (see sentinel below), which reports the
// machine-checkable duties in docs/control/MAINTENANCE-REGISTER.md and whether
// any maintenance session has stamped a heartbeat in the last two days.
//
// And one job that isn't monitoring at all: a once-a-day scan of Hacker News
// and Reddit for people asking the question this product answers, Telegrammed
// to the founder so he can reply as himself (see scanThreads). It lives here
// because this worker already has a cron, a fetch, and nothing else to do at
// 04:00 UTC — a second worker for five HTTP calls a day would be silly.
//
// Everything this worker says on Telegram is written to telegram_outbox
// (schema/038) as it is said, because a Telegram bot cannot read back its own
// sent history and the record was otherwise only on the founder's phone. See
// sendTelegram below.
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
  // Worker secrets (`wrangler secret put`), not [vars]. Optional: without a
  // PostHog key the replay no-ops; without a QA id nothing is filtered.
  POSTHOG_PROJECT_KEY?: string;
  QA_BOT_USER_ID?: string;
  // Thread scan / daily digest (see scanThreads, dailyDigest). Optional: absent
  // means the founder-facing digest no-ops rather than the worker failing to
  // boot. Mining still runs — it needs only the Supabase service role.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  // The listening radar's Google Alerts RSS feeds, as a newline- or
  // comma-separated list. Each entry is a feed URL, optionally prefixed with a
  // 'phrase|' label (the phrase the alert watches). Secret, never in the repo:
  // anyone with a feed URL can read it. Absent means the radar reads Hacker
  // News and Reddit only.
  ALERT_FEEDS?: string;
  // Reply-draft feature flag. Truthy ('1'/'true'/'on') turns on the drafted
  // replies inside the daily digest; absent or falsy leaves the radar in
  // log-and-mine-only mode (it still lists worthwhile items, just without a
  // drafted reply). Held off until the draft generation and the disclosure
  // guardrail have been reviewed.
  RADAR_DRAFTS?: string;
  // One-tap Reddit posting (see the section below dailyDigest). All five are
  // optional and all five are needed together: with any of them missing the
  // digest still sends its drafts, just as plain text to copy, and the webhook
  // answers 404 as though it did not exist.
  //
  // The shared secret Telegram puts in X-Telegram-Bot-Api-Secret-Token on
  // every webhook delivery. It is the only thing standing between the open
  // internet and a handler that can post as the founder, so an unset secret
  // disables the endpoint rather than opening it.
  TELEGRAM_WEBHOOK_SECRET?: string;
  // The founder's numeric Telegram user id. A shared webhook secret proves the
  // caller holds a value; only this proves the tap came from him. Every
  // callback and every reply is checked against it and against
  // TELEGRAM_CHAT_ID, and anything else is dropped without an answer.
  TELEGRAM_FOUNDER_USER_ID?: string;
  // The "script" app's credentials from reddit.com/prefs/apps, plus the
  // permanent refresh token ops/scripts/reddit_auth.py obtains once.
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REDDIT_REFRESH_TOKEN?: string;
  // The founder's Reddit username, for the descriptive User-Agent Reddit's API
  // rules ask for. A secret rather than a [vars] entry only because it is a
  // personal handle and this repository is public.
  REDDIT_USERNAME?: string;
}

// What a healthy production answers, one entry per probe.
//
// The four application routes on htmlradar.com are the original check. The
// two on htmlradar.page are the content domain, where recipient documents are
// served: it carries the customer links, so an outage there is invisible to
// the founder and total for the reader.
//
// Neither content-domain probe can be a 200 on a real page, because that host
// has no pages. A missing share is a 404 BY DESIGN, so 404 is the healthy
// answer and anything else — a 200, a 502, a redirect to the marketing site —
// means the worker route came loose. robots.txt is the one path that must
// answer 200, and its body has to keep saying Disallow, because that is what
// keeps somebody else's document out of a search result.
interface Check {
  url: string;
  status: number;
  /** Substring the body must contain. Omitted means the status is enough. */
  body?: string;
}

export const CHECKS: Check[] = [
  ...['/', '/pricing', '/docs', '/sign-in'].map((path) => ({
    url: `https://htmlradar.com${path}`,
    status: 200,
  })),
  { url: 'https://htmlradar.page/r/nonexistent-smoke-test', status: 404 },
  { url: 'https://htmlradar.page/robots.txt', status: 200, body: 'Disallow: /' },
];

// Route probing retries before it pages — see check 2 for why. Three attempts a
// few seconds apart finishes well inside the 5-minute cron window.
const ROUTE_ATTEMPTS = 3;
const ROUTE_RETRY_MS = 3_000;
const ROUTE_TIMEOUT_MS = 10_000;

/**
 * One probe, retried. Returns null when the target answered as it should, or
 * the reason it did not once every attempt has been spent.
 *
 * Exported for the tests; `retryMs` is a parameter for the same reason, so a
 * failing case does not sit through three real back-offs.
 */
export async function probe(
  check: Check,
  retryMs: number = ROUTE_RETRY_MS,
): Promise<string | null> {
  let problem: string | null = null;
  for (let attempt = 1; attempt <= ROUTE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(check.url, {
        redirect: 'follow',
        // Without this a hung request could stall the whole cron run.
        signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      });
      if (res.status !== check.status) {
        problem = `returned HTTP ${res.status} (expected ${check.status})`;
      } else if (check.body && !(await res.text()).includes(check.body)) {
        problem = `returned ${res.status} but the body no longer contains '${check.body}'`;
      } else {
        return null;
      }
    } catch (err) {
      problem = `fetch threw: ${(err as Error).message}`;
    }
    if (attempt < ROUTE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  return problem;
}

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
  // First-touch attribution → PostHog PERSON properties, set once.
  //
  // The first_* keys already ride along as event properties via the spread
  // above, but that only lets you filter events. $set_once promotes them to
  // the person, which is what makes PostHog's own first-touch attribution and
  // "which channel produced this customer" analysis work natively — and it is
  // write-once, so a later pageview with a different referrer cannot overwrite
  // where someone originally came from.
  const firstTouch = Object.fromEntries(
    Object.entries(props).filter(([k]) => k.startsWith('first_')),
  );
  if (Object.keys(firstTouch).length > 0) {
    props['$set_once'] = { ...(props['$set_once'] as object | undefined), ...firstTouch };
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

// ---------------------------------------------------------------------------
// The listening radar — sources, mining, and the daily digest.
//
// The one acquisition channel that works here is the founder answering a real
// question in a real thread, as himself, the same day it was asked. The part
// that kills it is the searching — nobody greps the web every morning. So the
// worker does that half. It reads three keyless sources once a day, logs and
// categorises EVERYTHING it sees into radar_items (the "mine everything"
// mandate — even items nobody ever replies to become intelligence), then a
// second cron an hour later drafts founder-voice replies for the worthwhile
// few and delivers them in one daily digest the founder approves in a tap.
//
// The three sources, in the order Lever 11 of the distribution playbook lays
// them out (docs/playbooks/PLAYBOOK-DISTRIBUTION-AND-TRUST-0-TO-1.md):
//   1. The six Google Alerts RSS feeds (URLs in the ALERT_FEEDS secret) —
//      Google's own watch on newly published pages containing our phrases.
//   2. Hacker News' Algolia search — the builder conversation, keyless.
//   3. Reddit's search RSS — rate-limited to ~1 call/minute, so spaced.
//
// The six phrases are the data-backed set from
// docs/workstreams/seo-and-indexing/KEYWORD-BASIS-2026-08-31.md, grounded in
// real typed searches and real forum phrasings rather than armchair guesses.
//
// Unlike the old stateless scan, this one remembers: radar_items is keyed on
// source_url, so re-seeing a thread is idempotent (its last_seen_at moves, its
// first_seen_at and acted flag do not). That is what lets the digest ask "what
// is new in the last 24 hours" rather than re-sending yesterday's shortlist.

// Each phrase carries the line the founder can open a reply with. Plain, no
// pitch — threads punish marketing voice, and he has to be able to say it in
// his own words in under five minutes. These angles feed the drafted replies.
const SCAN_QUERIES: { query: string; angle: string }[] = [
  {
    query: '"docsend alternative"',
    angle:
      'Open-source alternative that tracks HTML rather than uploaded PDFs; free for two links.',
  },
  {
    query: '"claude artifact" share',
    angle:
      'A published artifact gives you a URL and nothing else; HTMLRadar adds who opened it and which sections they read.',
  },
  {
    query: '"share html file"',
    angle: 'Paste or upload the HTML, get a link that keeps it a live page and shows reads.',
  },
  {
    query: 'papermark',
    angle: 'Both open source; HTMLRadar is for HTML, not file uploads.',
  },
  {
    query: '"send proposal"',
    angle:
      'Per-client link, email gate optional, section-level read timeline; the open-source, $15 equivalent of DocSend for proposals.',
  },
  {
    query: '"track who opened"',
    angle:
      'We built the read side of this for HTML documents: who opened, when, and which sections they actually read.',
  },
];

// 26 hours, not 24, so a run that slips can't open a gap the next one skips over.
const SCAN_WINDOW_MS = 26 * 60 * 60_000;
const SCAN_TIMEOUT_MS = 8_000;
// HN's Algolia index is comparatively sparse for these six phrases — a 26-hour
// lookback returns 0 hits most days, which reads as "HN is broken" when it is
// only "HN is quiet". Widening HN alone to 7 days costs nothing: radar_items
// dedupes on source_url and never resets first_seen_at on a re-seen thread
// (see upsertRadarItems), so the same thread surfacing again is a no-op, not a
// repeat in the digest. Reddit and Google Alerts keep the 26-hour window —
// their volume doesn't need it and Reddit's t=week param already caps there.
const HN_SCAN_WINDOW_MS = 7 * 24 * 60 * 60_000;
// Reddit rate-limits anonymous search to roughly one call a minute per address,
// so five back-to-back queries get four 429s and Reddit contributes nothing.
// Spacing them costs wall-clock time, which a once-a-day cron has in abundance
// (timers burn no CPU): 3-of-5 queries landed at 30s versus 1-of-5 with no gap,
// and 45s buys the rest of the margin toward Reddit's roughly-one-a-minute
// ceiling. ponytail: 45s is a measured compromise, not a limit Reddit
// documents — raise it toward 60s if queries still come back throttled.
const SCAN_QUERY_GAP_MS = 45_000;
// A descriptive User-Agent, not a spoofed browser one: Reddit's bot detection
// is more suspicious of a request claiming to be Chrome from a datacentre IP
// than one that says plainly what it is. Kept close to the endpoints that use
// it rather than up with the other scan constants.
const REDDIT_USER_AGENT = 'htmlradar-radar/1.0 (+https://htmlradar.com)';
// One retry, one host swap: www.reddit.com and old.reddit.com don't share a
// rate-limit bucket, so a 429 or a stalled request against one is worth one
// more try against the other before the query counts as failed.
const REDDIT_RETRY_DELAY_MS = 5_000;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
};

// HN comment bodies are HTML; Reddit's Atom fields are entity-escaped. Same
// cleanup serves both. Tags become a space, not nothing, so a stripped <p>
// doesn't glue two sentences together.
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-fA-F]{1,6}|\d{1,7});/g, (m, code: string) => {
      const n = code[0] === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/&(?:amp|lt|gt|quot);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

interface HNHit {
  objectID: string;
  title: string | null;
  story_title: string | null;
  comment_text: string | null;
  created_at_i: number | null;
}

// Both sources pad their results: the HN index is configured allOptional, so
// once the real matches run out Algolia fills the page with hits sharing a
// single word — "papermark alternative" comes back nine-tenths threads
// containing only "alternative" — and Reddit's search widens the same way.
// nbHits counts the padding too, so the only reliable filter is checking the
// words are actually there. Whole-word and case-insensitive: "html" must not
// match "htmlspecialchars", and thread titles are written in any casing.
// Without this the daily message is mostly noise.
function matchesQuery(query: string, haystack: string): boolean {
  const words = query.match(/[a-zA-Z0-9]+/g) ?? [];
  return words.every((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack),
  );
}

// Both source functions report the HTTP status alongside their items rather
// than throwing on a refusal, so the scan_run row can say WHY a query
// contributed nothing. "Reddit answered 429" and "Reddit answered 200 with no
// matching threads" are the same empty list and very different facts, and
// until this row existed neither of them was written down anywhere.
/** One item a source returned. `published_at` is ISO-8601 when the source
 *  dates its results (all three do), which is what feeds the recency boost in
 *  the intent score. `snippet` is any body text the source carried, used for
 *  classification and stored alongside the item. */
interface SourceItem {
  title: string;
  url: string;
  published_at?: string;
  snippet?: string;
}

interface ScanResult {
  status: number;
  items: SourceItem[];
  /** Why a successful response still yielded nothing, when that isn't obvious. */
  error?: string;
}

async function scanHN(query: string, sinceSec: number): Promise<ScanResult> {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date' +
      `?query=${encodeURIComponent(query)}&tags=(story,comment)` +
      `&numericFilters=created_at_i>${sinceSec}&hitsPerPage=10`,
    { signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) },
  );
  if (!res.ok) return { status: res.status, items: [] };
  const body = (await res.json()) as { hits?: HNHit[] };
  // story_title carries the thread a comment lives under, which is where the
  // query words usually sit when the hit is a reply rather than a story.
  const items = (body.hits ?? [])
    .filter((hit) =>
      matchesQuery(query, `${hit.title ?? ''} ${hit.story_title ?? ''} ${hit.comment_text ?? ''}`),
    )
    .map((hit) => ({
      // Stories have a title; comments only have their body.
      title: clean(hit.title ?? hit.comment_text ?? ''),
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      // The thread a comment lives under is the useful context for a comment hit.
      ...(hit.story_title ? { snippet: clean(hit.story_title) } : {}),
      // created_at_i is unix seconds; the radar wants ISO for published_at.
      ...(hit.created_at_i
        ? { published_at: new Date(hit.created_at_i * 1000).toISOString() }
        : {}),
    }));
  return { status: res.status, items };
}

function redditRssUrl(host: string, query: string): string {
  return `https://${host}/search.rss?q=${encodeURIComponent(query)}&sort=new&t=week`;
}

function fetchRedditRss(host: string, query: string): Promise<Response> {
  return fetch(redditRssUrl(host, query), {
    headers: { 'User-Agent': REDDIT_USER_AGENT },
    signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
  });
}

// Reddit blocks datacentre IPs often enough that treating a refusal as an
// error would take the HN half of the scan down with it. Anything that isn't
// a 200 of XML is a silent skip for that query — except a 429 or a timeout,
// which get one retry against old.reddit.com's search.rss before giving up.
async function scanReddit(
  query: string,
  sinceMs: number,
  retryDelayMs: number = REDDIT_RETRY_DELAY_MS,
): Promise<ScanResult> {
  let res: Response;
  try {
    res = await fetchRedditRss('www.reddit.com', query);
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      res = await fetchRedditRss('old.reddit.com', query);
    }
  } catch {
    // A hung request (AbortSignal.timeout) or any other network throw is
    // worth the same one retry against the other host.
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    try {
      res = await fetchRedditRss('old.reddit.com', query);
    } catch (err2) {
      return { status: 0, items: [], error: `fetch threw: ${(err2 as Error).message}` };
    }
  }
  if (!res.ok) return { status: res.status, items: [] };
  // A 200 whose body is not XML is Reddit's block page, which used to be
  // indistinguishable from a 200 with no matching threads. Say which it was.
  if (!(res.headers.get('content-type') ?? '').includes('xml')) {
    return {
      status: res.status,
      items: [],
      error: 'non-XML body — Reddit refused this address',
    };
  }
  const xml = await res.text();
  const items: SourceItem[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1] ?? '';
    // t=week, not t=day: Reddit's own filter keys off post time rather than
    // activity, so a day-wide ask drops threads that were posted earlier and
    // are only now being answered. The real window is the 26 hours re-applied
    // right here against <updated>; t=week just stops Reddit narrowing it first.
    const updated = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1];
    if (!updated || Date.parse(updated) < sinceMs) continue;
    const url = /<link[^>]*href="([^"]+)"/.exec(entry)?.[1];
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1];
    if (!url || !title) continue;
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? '';
    if (!matchesQuery(query, clean(`${title} ${content}`))) continue;
    const snippet = clean(content);
    items.push({
      title: clean(title),
      url: clean(url),
      published_at: updated,
      ...(snippet ? { snippet } : {}),
    });
  }
  return { status: res.status, items };
}

// ---------------------------------------------------------------------------
// Google Alerts RSS feeds — source three.
//
// Google Alerts watches what gets PUBLISHED (not who searched), and delivers
// matches as Atom. Each <entry> carries a <title type="html"> with the matched
// terms wrapped in <b>, a <link href> that is a google.com/url redirect to the
// real page, a <published> timestamp, and a <content> summary. The feed URLs
// are secret (ALERT_FEEDS): anyone holding one can read that feed, so they
// never enter the repo.

interface AlertFeed {
  /** The phrase the alert watches, for traceability and draft angle. */
  phrase: string;
  url: string;
}

// Split the ALERT_FEEDS secret. Newline- or comma-separated; each entry is a
// feed URL, optionally 'phrase|url'. Blank lines and '#' comments are dropped,
// so the ops backup file's own lines paste in verbatim.
export function parseAlertFeeds(raw: string | undefined): AlertFeed[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#'))
    .map((entry) => {
      const bar = entry.lastIndexOf('|');
      if (bar === -1) return { phrase: '', url: entry };
      return { phrase: entry.slice(0, bar).trim(), url: entry.slice(bar + 1).trim() };
    })
    .filter((f) => f.url.startsWith('http'));
}

// Google wraps every result link as https://www.google.com/url?...&url=<real>.
// The wrapper is per-fetch, so deduping on it would fail; unwrap to the real
// destination, which is stable.
export function unwrapGoogleUrl(href: string): string {
  const m = /[?&]url=([^&]+)/.exec(href);
  if (!m || !m[1]) return href;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return href;
  }
}

async function scanFeed(feed: AlertFeed, sinceMs: number): Promise<ScanResult> {
  let res: Response;
  try {
    res = await fetch(feed.url, { signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
  } catch (err) {
    return { status: 0, items: [], error: `fetch threw: ${(err as Error).message}` };
  }
  if (!res.ok) return { status: res.status, items: [] };
  const xml = await res.text();
  const items: SourceItem[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1] ?? '';
    const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1];
    const href = /<link[^>]*href="([^"]+)"/.exec(entry)?.[1];
    if (!rawTitle || !href) continue;
    const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1];
    // Re-apply the 26-hour window against <published> so a feed's older backlog
    // does not resurface every day — the same slack scanReddit gives itself.
    if (published && Date.parse(published) < sinceMs) continue;
    const content = clean(/<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? '');
    items.push({
      title: clean(rawTitle),
      url: unwrapGoogleUrl(clean(href)),
      ...(published ? { published_at: published } : {}),
      ...(content ? { snippet: content } : {}),
    });
  }
  return { status: res.status, items };
}

// ---------------------------------------------------------------------------
// Classification and intent scoring — pure functions, the "mine everything"
// core.
//
// Every item the radar sees is categorised and scored, and every item is
// stored regardless of score. Classification is a precedence ladder: the first
// rule that matches wins, most-specific first. Scoring is a small additive
// model — a direct question outranks a listicle outranks a passing mention,
// and recent beats stale — deliberately explainable rather than clever, so a
// surprising score can be read off the inputs.

export type RadarCategory =
  | 'buyer_question'
  | 'competitor_mention'
  | 'product_feedback'
  | 'reputation'
  | 'noise';

// Our own name, in the forms people write it. A match here is reputation —
// someone already knows us — whatever else the text contains.
const BRAND_TERMS = ['htmlradar', 'html radar'];
// The document-sharing competitors whose unhappy users are the highest-intent
// audience there is. Distinctive tokens only, so a bare substring match is safe.
const COMPETITOR_TERMS = [
  'docsend',
  'papermark',
  'pandadoc',
  'brieflink',
  'docsketch',
  'orangedox',
  'sellizer',
  'helprange',
];
// Pain paired with a competitor is the competitor_mention signal.
const PAIN_TERMS = [
  'alternative',
  'alternatives',
  ' vs ',
  'versus',
  'pricing',
  'too expensive',
  'expensive',
  'cheaper',
  'cancel',
  'complaint',
  'sucks',
  'hate ',
  'switch from',
  'switching from',
  'replace',
  'replacement',
];
// Unmet-need phrasing → product_feedback.
const FEEDBACK_TERMS = [
  'i wish',
  'wish there was',
  'is there a tool',
  'is there any tool',
  'is there a way',
  'looking for a tool',
  'need a tool',
  'anyone know a tool',
  'any tool that',
  'does anyone have a tool',
];
// Question phrasing → buyer_question (when nothing more specific matched).
const QUESTION_TERMS = [
  'how do i',
  'how to',
  'how can i',
  'how does',
  'what is the best',
  "what's the best",
  'best way to',
  'anyone know',
  'recommend',
  'suggestions',
  'ask hn',
  'which ',
];
// Listicle markers depress intent: an article, not a person with a question.
const LISTICLE_TERMS = ['best ', 'top ', 'roundup', 'list of', ' alternatives ', 'comparison of'];

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Categorise an item from its title and snippet. Precedence: reputation,
 *  competitor_mention, product_feedback, buyer_question, noise. Pure. */
export function classifyItem(title: string, snippet = ''): RadarCategory {
  const t = ` ${title} ${snippet} `.toLowerCase();
  if (containsAny(t, BRAND_TERMS)) return 'reputation';
  if (containsAny(t, COMPETITOR_TERMS) && containsAny(t, PAIN_TERMS)) return 'competitor_mention';
  if (containsAny(t, FEEDBACK_TERMS)) return 'product_feedback';
  if (t.includes('?') || containsAny(t, QUESTION_TERMS)) return 'buyer_question';
  return 'noise';
}

// Category floor: how much intent the category carries before shape and recency.
const CATEGORY_BASE: Record<RadarCategory, number> = {
  buyer_question: 45,
  product_feedback: 45,
  competitor_mention: 40,
  reputation: 35,
  noise: 8,
};

/** Score buying intent 0–100 from category, phrasing shape, and recency. Pure;
 *  `nowMs` is passed in so the recency term is testable without the clock. */
export function scoreIntent(
  item: { category: RadarCategory; title: string; snippet?: string; published_at?: string | null },
  nowMs: number,
): number {
  const t = ` ${item.title} ${item.snippet ?? ''} `.toLowerCase();
  let score = CATEGORY_BASE[item.category];
  if (t.includes('?')) score += 20;
  if (containsAny(t, FEEDBACK_TERMS) || containsAny(t, QUESTION_TERMS)) score += 12;
  if (containsAny(t, LISTICLE_TERMS)) score -= 15;
  if (item.published_at) {
    const ageH = (nowMs - Date.parse(item.published_at)) / 3_600_000;
    if (ageH < 24) score += 20;
    else if (ageH < 72) score += 10;
    else if (ageH < 168) score += 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// The digest's inclusion floor, and the score at or above which a drafted
// reply is attached. A recent, direct buyer question lands 45 + 20 (question)
// + 12 (phrasing) + 20 (fresh) = 97; a recent competitor-pain thread ~72; a
// listicle ~40; a passing mention below that. 60 is the clean gap between "a
// person asking, today" and "an article or a stale mention" — worth surfacing
// to the founder at all, not only worth a personal reply. Per
// docs/workstreams/seo-and-indexing/SEO-PLAN-DECISION-2026-08-31.md, the
// digest is a strict opportunity filter rather than a daily top-ten, so this
// number now gates both: whether an item appears at all, and whether it gets
// a draft.
export const REPLY_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// radar_items — the durable insight base (schema/042).
//
// Every item every source returns is upserted here, keyed on source_url. The
// upsert is idempotent by design: re-seeing a thread moves last_seen_at but
// leaves first_seen_at and acted untouched (those two columns are deliberately
// absent from the payload, so PostgREST's merge-duplicates cannot overwrite
// them). That is what lets the digest ask "new in the last 24 hours" and what
// stops an item the founder already acted on coming back.

interface RadarItem {
  source: string;
  source_url: string;
  title: string;
  snippet: string | null;
  published_at: string | null;
  category: RadarCategory;
  intent_score: number;
  last_seen_at: string;
  meta: Record<string, unknown>;
}

async function upsertRadarItems(env: Env, items: RadarItem[]): Promise<void> {
  if (items.length === 0) return;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/radar_items?on_conflict=source_url`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates = INSERT ... ON CONFLICT DO UPDATE over the columns
      // present in the body; return=minimal keeps the response small.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(items),
  });
  if (!res.ok)
    throw new Error(`radar_items upsert HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// Telegram, with a receipt.
//
// A Telegram bot cannot read back what it sent: the Bot API exposes incoming
// updates and nothing else. So every message this worker sent went into a
// channel neither the worker nor any later agent could re-read, and the only
// copy was on the founder's phone. sendTelegram is now the single door — it
// sends, then writes down what it sent and how Telegram answered, into
// telegram_outbox (schema/038).
//
// It fails open in one direction only. A failed outbox WRITE is logged and
// swallowed, because a bookkeeping problem must never be the reason the
// founder doesn't hear about a live thread. The reverse is not true: a failed
// SEND still writes its row, since "we tried and Telegram refused" is exactly
// the fact that used to go missing.
//
// The bot token never enters a row — it is in the request URL, not the body.
// The chat id does, because it is not a secret (it is the founder's own chat)
// and without it a row can't be attributed to a destination.

type OutboxKind = 'alert' | 'scan' | 'scan_run' | 'test' | 'heartbeat' | 'sentinel' | 'radar';

interface OutboxRow {
  kind: OutboxKind;
  source: string;
  message: string;
  /** Null when nothing was sent — neither true nor false would be honest. */
  telegram_ok: boolean | null;
  telegram_error?: string | null;
  meta?: Record<string, unknown>;
}

/** Writes one row. Never throws: the caller's real work outranks the receipt. */
export async function recordOutbox(env: Env, row: OutboxRow): Promise<void> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/telegram_outbox`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[outbox] write failed:', (err as Error).message);
  }
}

/** Sends one Telegram message and records it. Returns whether Telegram took it,
 *  and the id of the message it created — the id matters only to the one-tap
 *  flow, which has to find this message again when a button on it is tapped or
 *  the founder replies to it. `replyMarkup` is the inline keyboard, absent for
 *  every caller that is just talking. */
export async function sendTelegramMessage(
  env: Env,
  kind: OutboxKind,
  source: string,
  text: string,
  meta: Record<string, unknown> = {},
  replyMarkup?: Record<string, unknown>,
): Promise<{ ok: boolean; messageId: number | null }> {
  let ok = false;
  let messageId: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    // Read the body as text, not res.json(): a 502 from Telegram's edge is
    // HTML, and json() would throw away the status and body that explain it.
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { ok?: boolean; result?: { message_id?: number } };
      ok = res.ok && parsed.ok === true;
      messageId = parsed.result?.message_id ?? null;
    } catch {
      ok = false;
    }
    if (!ok) error = `HTTP ${res.status}: ${body.slice(0, 500)}`;
  } catch (err) {
    error = `fetch threw: ${(err as Error).message}`;
  }
  await recordOutbox(env, {
    kind,
    source,
    message: text,
    telegram_ok: ok,
    telegram_error: error,
    meta: { ...meta, chat_id: env.TELEGRAM_CHAT_ID },
  });
  return { ok, messageId };
}

/** Sends one Telegram message and records it. Returns whether Telegram took it. */
export async function sendTelegram(
  env: Env,
  kind: OutboxKind,
  source: string,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  return (await sendTelegramMessage(env, kind, source, text, meta)).ok;
}

/** One entry per fetch in a scan run, for the scan_run row's meta. */
interface ScanFetch {
  source: string;
  query: string;
  /** Null when the fetch threw before there was a response. */
  status: number | null;
  items: number;
  error?: string;
}

// Stored rows are kept modest — a feed's <content> can run long, and nothing
// downstream needs the whole thing.
const RADAR_TITLE_CHARS = 300;
const RADAR_SNIPPET_CHARS = 500;

// gapMs and redditRetryDelayMs are parameters for the same reason probe's
// retryMs is: so a test does not sit through minutes of real rate-limit
// spacing. nowMs is a parameter so the recency term of the score is
// reproducible under test.
export async function scanThreads(
  env: Env,
  gapMs: number = SCAN_QUERY_GAP_MS,
  nowMs: number = Date.now(),
  redditRetryDelayMs: number = REDDIT_RETRY_DELAY_MS,
): Promise<void> {
  const sinceMs = nowMs - SCAN_WINDOW_MS;
  const hnSinceSec = Math.floor((nowMs - HN_SCAN_WINDOW_MS) / 1000);
  const nowIso = new Date(nowMs).toISOString();
  // Keyed by source_url: the same thread surfaces under several phrases and
  // several sources, and the first to find it owns the row.
  const radar = new Map<string, RadarItem>();
  // One entry per fetch, whatever happens to each. This is the whole reason a
  // scan run stops being a black box, and what the sentinel reads.
  const fetches: ScanFetch[] = [];

  // Classify, score, and remember every item a fetch returned. Mine everything:
  // noise is stored the same as a buyer question — the only difference is score.
  const ingest = (source: string, query: string, found: ScanResult): void => {
    fetches.push({
      source,
      query,
      status: found.status,
      items: found.items.length,
      ...(found.error ? { error: found.error } : {}),
    });
    for (const it of found.items) {
      if (!it.title || !it.url || radar.has(it.url)) continue;
      const category = classifyItem(it.title, it.snippet);
      const intent_score = scoreIntent(
        {
          category,
          title: it.title,
          ...(it.snippet !== undefined ? { snippet: it.snippet } : {}),
          published_at: it.published_at ?? null,
        },
        nowMs,
      );
      radar.set(it.url, {
        source,
        source_url: it.url,
        title: it.title.slice(0, RADAR_TITLE_CHARS),
        snippet: it.snippet ? it.snippet.slice(0, RADAR_SNIPPET_CHARS) : null,
        published_at: it.published_at ?? null,
        category,
        intent_score,
        last_seen_at: nowIso,
        meta: { matched: query },
      });
    }
  };

  // Source one: the Google Alerts feeds. Same host, no tight rate limit, so
  // fetched back to back.
  for (const feed of parseAlertFeeds(env.ALERT_FEEDS)) {
    try {
      ingest('GoogleAlerts', feed.phrase || feed.url, await scanFeed(feed, sinceMs));
    } catch (err) {
      fetches.push({
        source: 'GoogleAlerts',
        query: feed.phrase || feed.url,
        status: null,
        items: 0,
        error: (err as Error).message,
      });
    }
  }

  // Sources two and three: HN and Reddit, per phrase, spaced for Reddit's limit.
  for (const [i, { query }] of SCAN_QUERIES.entries()) {
    for (const source of ['HN', 'Reddit'] as const) {
      try {
        ingest(
          source,
          query,
          source === 'HN'
            ? await scanHN(query, hnSinceSec)
            : await scanReddit(query, sinceMs, redditRetryDelayMs),
        );
      } catch (err) {
        // One dead source or one bad query must not cost the whole scan — but
        // it does go in the run row, which is the only place anyone will look.
        fetches.push({ source, query, status: null, items: 0, error: (err as Error).message });
      }
    }
    if (i < SCAN_QUERIES.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  // Mine everything: store every item, whatever its score or category. A store
  // failure is recorded, not thrown — the run row still has to be written.
  const items = [...radar.values()];
  let stored = items.length;
  let storeError: string | null = null;
  try {
    await upsertRadarItems(env, items);
  } catch (err) {
    stored = 0;
    storeError = (err as Error).message;
  }

  // The scan_run row, always, which the sentinel reads to prove the cron fired.
  // telegram_ok is null: this scan sends no founder-facing message — the 05:00
  // digest does — so there was no Telegram send to succeed or fail.
  await recordOutbox(env, {
    kind: 'scan_run',
    source: 'scanThreads',
    message:
      `${items.length} item(s) mined across ${fetches.length} fetch(es)` +
      (storeError ? `; store FAILED: ${storeError}` : `; ${stored} stored`),
    telegram_ok: null,
    meta: {
      fetches,
      total_items: items.length,
      items_stored: stored,
      ...(storeError ? { store_error: storeError } : {}),
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `[radar] mined ${items.length} item(s) across ${fetches.length} fetch(es); stored ${stored}`,
  );
}

// ---------------------------------------------------------------------------
// The daily digest and the weekly insight.
//
// The digest is the founder-facing half, on its own 05:00 cron an hour after
// the mining scan. It is a strict opportunity filter, not a daily top-ten: it
// reads what was first seen in the last 24 hours, drops noise, keeps only
// items at or above REPLY_THRESHOLD (a listicle or a passing mention never
// clears it — see that constant's comment), and shows at most
// DIGEST_MAX_ITEMS of those, highest intent first. Because everything shown
// already cleared REPLY_THRESHOLD, every shown item also gets a drafted reply
// when RADAR_DRAFTS is on. It marks nothing acted — acted defaults false and
// stays false until he tells us he replied; there is no auto-post. On a day
// nothing clears the bar it stays silent, except Monday, when the weekly
// insight (unchanged) rides along so unanswered items still become
// intelligence.

const DIGEST_WINDOW_MS = 24 * 60 * 60_000;
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
// Strict filter, not a top-ten: at most 3 items a day (see
// readRecentRadarItems for the score floor that keeps this a real cap, not
// just "all we happened to find").
const DIGEST_MAX_ITEMS = 3;
// How many rows the digest reads before filtering out the subreddits we may not
// speak in and the threads that have gone cold. Well above the cap on purpose:
// filtering after a read of exactly three would let three blocked rows empty a
// digest that had good items behind them. A hundred is far more than a day
// produces, so this is one query, not a pager.
const DIGEST_CANDIDATE_LIMIT = 100;
// Telegram hard-caps at 4096; stop well short so the appended weekly section
// and a draft can't push the last item past the cliff.
const DIGEST_MAX_CHARS = 3_800;

const SOURCE_LABEL: Record<string, string> = {
  GoogleAlerts: 'Google Alerts',
  HN: 'Hacker News',
  Reddit: 'Reddit',
};

interface RadarRow {
  source: string;
  source_url: string;
  title: string;
  snippet: string | null;
  category: RadarCategory;
  intent_score: number;
  published_at: string | null;
}

// ---------------------------------------------------------------------------
// Where we are allowed to speak on Reddit.
//
// The rules, their sources and the reasoning are in
// docs/workstreams/seo-and-indexing/REDDIT-ENGAGEMENT-STANDARD-2026-09-03.md.
// This is the machine-readable half of that document and nothing more.
//
// It is a constant, not a `radar_rules` table, on purpose. A row in a table can
// change what we say in public with no diff, no test, no review and no history,
// and this list is the last thing standing between a drafted reply and a
// permanent ban in somebody else's community. It changes about once a month, in
// a commit, with the document. That is the right amount of friction.
//
// The list is allow-first: a subreddit that is not named here gets no draft and
// never reaches the digest. That is deliberately the safe default, because
// Reddit's search returns every corner of the site and the two Reddit items the
// radar has produced so far were BOTH in places we must never post — a
// competitor's own community (r/papermark) and a promotional dumping ground
// (r/DigitalEscapeTools).
//
// Membership here means only "a disclosed founder comment is permitted at all".
// The per-subreddit conditions that follow from that (comments only, never a
// post; the weekly megathread; karma, age and flair gates) are in the document,
// because the founder does the posting by hand and the code cannot check them.
//
// Seven subreddits that looked obvious came off this list after Sol's review of
// 3 September read their live rules: r/Entrepreneur, r/marketing, r/sales,
// r/freelance and r/webdev forbid the comment outright (r/sales bans a seller
// recommending their own product even when asked, on pain of a permanent ban);
// r/startups requires a linked page to be one the commenter has no affiliation
// with; r/SaaS allows one product mention per sixty days and rejects text that
// reads as machine-written even when a human pasted it. The founder may still
// answer in all seven in his own words with no mention — that is participation,
// and the point is that no machine drafts it for him.
const REDDIT_ALLOWED_SUBREDDITS = new Set([
  'alexhormozi',
  'askmarketing',
  'claudeai',
  'claudecode',
  'consulting',
  'indiehackers',
  'leanstartup',
  'nocode',
  'ppc',
  'selfhosted',
  'sideproject',
  'smallbusiness',
]);

// Named separately from "merely not on the allow list" so the reason we skipped
// is honest in a log line. These are the ones a future reader is most likely to
// add by mistake, because the radar's own scoring rates them highly: they are
// full of our exact keywords. They are also the fastest way to be seen as a
// competitor astroturfing a rival's community.
const REDDIT_NEVER_SUBREDDITS = new Set([
  'datarooms',
  'digitalescapetools',
  'docsend',
  'pandadoc',
  'papermark',
]);

// A thread older than this is cold: the asker has moved on, and a reply arriving
// a fortnight late reads as somebody working a keyword list rather than
// answering a person. This is our own rule, not Reddit's — no Reddit or
// subreddit rule sets any deadline. Fourteen days rather than seven after Sol's
// review pointed out that the shorter window costs real reach for no safety.
const THREAD_MAX_AGE_MS = 14 * 24 * 60 * 60_000;

/** The subreddit in a Reddit thread URL, lowercased, or null for any other URL. */
export function subredditOf(url: string | null | undefined): string | null {
  return (
    /^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com\/r\/([A-Za-z0-9_]+)\b/
      .exec(url ?? '')?.[1]
      ?.toLowerCase() ?? null
  );
}

/** True for any address on Reddit's own hosts, including the redd.it share
 *  shortener, whether or not a subreddit can be read out of it. */
function isRedditUrl(url: string | null | undefined): boolean {
  return /^https?:\/\/(?:[a-z0-9-]+\.)?(?:reddit\.com|redd\.it)(?:[/?#]|$)/i.test(url ?? '');
}

/** Why this item must not receive a drafted reply, or null when it may.
 *  Non-Reddit items (Hacker News, Google Alerts) are never blocked here — they
 *  have no subreddit and no comment box we post into. `nowMs` is optional
 *  because draftReply has no clock; the digest passes one and applies the age
 *  rule, and both callers apply the subreddit rule. */
export function redditReplyBlocked(
  item: { source_url?: string | null; published_at?: string | null },
  nowMs?: number,
): string | null {
  const sub = subredditOf(item.source_url);
  // A Reddit address we cannot read a subreddit out of — a redd.it share link,
  // a user page, a search result — is blocked rather than waved through. The
  // allow list is only a defence if an unreadable Reddit URL fails closed.
  if (sub === null)
    return isRedditUrl(item.source_url)
      ? 'the subreddit cannot be read from this Reddit link'
      : null;
  if (REDDIT_NEVER_SUBREDDITS.has(sub))
    return `r/${sub} is a competitor-owned or promotional subreddit`;
  if (!REDDIT_ALLOWED_SUBREDDITS.has(sub)) return `r/${sub} is not on the allow list`;
  if (nowMs !== undefined && item.published_at) {
    const age = nowMs - Date.parse(item.published_at);
    if (Number.isFinite(age) && age > THREAD_MAX_AGE_MS)
      return 'thread is older than fourteen days';
  }
  return null;
}

// The disclosure that MUST appear in every drafted reply — the "I built this"
// line the platforms and honesty both require. draftReply guarantees it; a test
// holds the guarantee. This is the guardrail Sol reviews before drafts go live.
export const DISCLOSURE = 'Full disclosure: I built HTMLRadar.';

// The first line of every draft, and the one line the founder must replace.
//
// Reddit's Responsible Builder Policy forbids apps posting "identical or
// substantially similar content across subreddits", and a moderator reading two
// of our comments a week apart would see exactly that: the same five sentences
// under a different question. A template cannot answer a stranger's actual
// question, so it stops pretending to. What ships is a scaffold with a hole in
// it, and the hole is the part that makes the comment a reply rather than an ad.
//
// Exported because the one-tap path must refuse to post any text that still
// contains it: an unedited draft is, by construction, the boilerplate the policy
// names.
export const DRAFT_ANSWER_SLOT =
  '[[ replace this line with your own answer to their question, in your own words, ' +
  'referring to something specific in their thread ]]';

// The Telegram framing, not part of the reply. It exists so the founder can
// never mistake a draft for something already said — and it is a named export
// because the one-tap flow has to strip it: what goes to Reddit is the body,
// never the label wrapped around it for his eyes.
export const DRAFT_PREFIX = 'DRAFT (personal account, edit before posting): ';

/** The reply body without the Telegram-only label. This is what gets posted. */
export function draftBody(draft: string): string {
  return draft.startsWith(DRAFT_PREFIX) ? draft.slice(DRAFT_PREFIX.length) : draft;
}

// Evidence the item itself is about sharing or tracking a document — the
// actual audience for what HTMLRadar does — rather than a question the
// classifier's shape rules alone caught. Required before a buyer_question or
// product_feedback item earns a drafted reply; competitor_mention and
// reputation already carry their own evidence from classifyItem (a named
// competitor, or our own name), so they are not gated again here.
const SHARE_EVIDENCE_TERMS = [
  'share',
  'shared',
  'sharing',
  'send',
  'sent',
  'sending',
  'track',
  'tracked',
  'tracking',
  'read receipt',
  'open rate',
  'who opened',
  'who read',
  'document',
  'deck',
  'proposal',
  'html',
  'artifact',
];

// Pricing-specific pain — the one context where naming a cheaper open-source
// rival (Papermark) is an honest answer rather than a pitch bolted onto a
// complaint the item never actually made.
const PRICING_PAIN_TERMS = ['pricing', 'too expensive', 'expensive', 'cheaper', 'cost'];

/** A founder-voice reply DRAFT for one item, or null when no honest reply
 *  exists — noise, an unexpected category, a buyer_question/product_feedback
 *  item that never mentions sharing or tracking a document, or a Reddit thread
 *  in a subreddit we may not speak in (see redditReplyBlocked). Where it does
 *  draft, it opens with the slot the founder must replace, then two or three
 *  plain first-person sentences carrying the mandatory disclosure, no
 *  superlatives, no exclamation marks, no list, and no link. It names Papermark
 *  only where the item's own pricing complaint makes that the honest answer.
 *  Takes no web content into the body — title and snippet are read only to
 *  check for evidence, never interpolated. Pure. */
export function draftReply(item: {
  category: RadarCategory;
  title: string;
  snippet?: string | null;
  source_url?: string | null;
}): string | null {
  if (redditReplyBlocked(item) !== null) return null;
  const t = `${item.title} ${item.snippet ?? ''}`.toLowerCase();
  const hasShareEvidence = containsAny(t, SHARE_EVIDENCE_TERMS);
  const hasPricingPain = containsAny(t, PRICING_PAIN_TERMS);

  let body: string;
  switch (item.category) {
    case 'competitor_mention':
      body = hasPricingPain
        ? 'On price, Papermark is the usual open-source pick if what you are sending is a PDF. ' +
          'For HTML I built HTMLRadar: the link stays a live page, and it shows who opened it and which sections they read. ' +
          `${DISCLOSURE} AGPL, self-hostable, free for two links.`
        : 'If what you are sharing is HTML rather than a file you upload, I built HTMLRadar for that case: ' +
          'the link stays a live page, and it shows who opened it and which sections they read. ' +
          `${DISCLOSURE} AGPL, self-hostable, free for two links.`;
      break;
    case 'product_feedback':
      if (!hasShareEvidence) return null;
      body =
        'That exists. You paste or upload the HTML, get a link that stays a live page, and see who opened it and which sections they read. ' +
        `${DISCLOSURE} Open source (AGPL), free for two links.`;
      break;
    case 'reputation':
      body =
        'Happy to answer anything here. ' +
        `${DISCLOSURE} Take this as the maker talking, not a neutral review.`;
      break;
    case 'buyer_question':
      if (!hasShareEvidence) return null;
      body =
        'You can send it as a link rather than an attachment, and see whether it was opened and which sections were read. That is what I built HTMLRadar for. ' +
        `${DISCLOSURE} Open source (AGPL), free for two links.`;
      break;
    default:
      // noise, and any category this switch does not otherwise know about:
      // no honest reply exists, so no draft.
      return null;
  }
  // Belt to the braces above: no draft ever ships without the disclosure.
  if (!body.includes(DISCLOSURE)) body = `${DISCLOSURE} ${body}`;
  return `${DRAFT_PREFIX}${DRAFT_ANSWER_SLOT}\n\n${body}`;
}

function draftsEnabled(env: Env): boolean {
  const v = (env.RADAR_DRAFTS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

const radarHeaders = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

/** The digest's candidate list: unacted, non-noise items from the last 24h, at
 *  or above REPLY_THRESHOLD, in a subreddit we may speak in and still warm,
 *  highest intent first, capped at DIGEST_MAX_ITEMS. The score floor and the cap
 *  are also applied here in code (not left to the query alone), so the guarantee
 *  holds even if the query changes underneath.
 *
 *  It over-fetches before filtering: a blocked subreddit that came back inside
 *  the first three rows would otherwise eat a slot and leave the digest shorter
 *  than the day deserved. Mining is untouched — every blocked item is still
 *  stored in radar_items and still counts in the Monday summary. The only thing
 *  that changes is what we are asked to reply to. */
async function readRecentRadarItems(env: Env, nowMs: number): Promise<RadarRow[]> {
  const since = encodeURIComponent(new Date(nowMs - DIGEST_WINDOW_MS).toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/radar_items` +
      `?first_seen_at=gte.${since}&category=neq.noise&intent_score=gte.${REPLY_THRESHOLD}` +
      `&acted=is.false` +
      `&order=intent_score.desc,first_seen_at.desc&limit=${DIGEST_CANDIDATE_LIMIT}` +
      `&select=source,source_url,title,snippet,category,intent_score,published_at`,
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_items read HTTP ${res.status}`);
  const rows = (await res.json()) as RadarRow[];
  return rows
    .filter((r) => r.intent_score >= REPLY_THRESHOLD && redditReplyBlocked(r, nowMs) === null)
    .slice(0, DIGEST_MAX_ITEMS);
}

/** The most recent mining run's counts, read back for the zero-item marker's
 *  "N scanned, M stored" — the same total_items/items_stored scanThreads
 *  already writes into its scan_run row, not recomputed here. */
async function readLatestScanCounts(
  env: Env,
  nowMs: number,
): Promise<{ scanned: number; stored: number }> {
  const since = encodeURIComponent(new Date(nowMs - SCAN_WINDOW_MS).toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/telegram_outbox` +
      `?kind=eq.scan_run&created_at=gte.${since}&order=created_at.desc&limit=1&select=meta`,
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`telegram_outbox scan_run read HTTP ${res.status}`);
  const row = (
    (await res.json()) as { meta: { total_items?: number; items_stored?: number } | null }[]
  )[0];
  return { scanned: row?.meta?.total_items ?? 0, stored: row?.meta?.items_stored ?? 0 };
}

/** The weekly pattern summary: what recurred, not a raw dump. Monday only. */
export async function weeklyInsight(env: Env, nowMs: number): Promise<string> {
  const since = encodeURIComponent(new Date(nowMs - WEEKLY_WINDOW_MS).toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/radar_items` +
      `?first_seen_at=gte.${since}&order=intent_score.desc&limit=500` +
      `&select=source,title,category,intent_score`,
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_items weekly read HTTP ${res.status}`);
  const rows = (await res.json()) as { category: RadarCategory; title: string }[];
  if (rows.length === 0) return 'Weekly insight: nothing logged in the last 7 days.';

  const byCat = (c: RadarCategory) => rows.filter((r) => r.category === c);
  const counts = (c: RadarCategory) => byCat(c).length;
  const top = (c: RadarCategory, n: number) =>
    byCat(c)
      .slice(0, n)
      .map((r) => `  · ${r.title.slice(0, 100)}`)
      .join('\n');

  const sections: string[] = [
    `Weekly insight — ${new Date(nowMs).toISOString().slice(0, 10)}`,
    `Logged this week: ${rows.length} item(s) — ${counts('buyer_question')} buyer question(s), ` +
      `${counts('competitor_mention')} competitor-pain, ${counts('product_feedback')} product feedback, ` +
      `${counts('reputation')} reputation, ${counts('noise')} noise.`,
  ];
  if (counts('buyer_question') > 0)
    sections.push(`Recurring buyer questions:\n${top('buyer_question', 5)}`);
  if (counts('competitor_mention') > 0)
    sections.push(`Competitor-pain moments:\n${top('competitor_mention', 5)}`);
  if (counts('product_feedback') > 0)
    sections.push(`Product-feedback themes:\n${top('product_feedback', 5)}`);
  return sections.join('\n\n');
}

export async function dailyDigest(env: Env, nowMs: number = Date.now()): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    // eslint-disable-next-line no-console
    console.log('[digest] no Telegram credentials set — skipping');
    return;
  }
  const isMonday = new Date(nowMs).getUTCDay() === 1;
  const items = await readRecentRadarItems(env, nowMs);

  // Non-Monday with nothing above the noise floor: record a marker row (so
  // the sentinel's radar_digest check can tell "checked and found nothing"
  // from "the digest never ran") and stay silent on Telegram — a daily "found
  // nothing" is how a channel gets muted. Monday always speaks — see below.
  if (items.length === 0 && !isMonday) {
    const { scanned, stored } = await readLatestScanCounts(env, nowMs);
    await recordOutbox(env, {
      kind: 'radar',
      source: 'daily-digest',
      message: `no high-fit items today (${scanned} scanned, ${stored} stored)`,
      telegram_ok: null,
    });
    // eslint-disable-next-line no-console
    console.log('[digest] nothing above the noise floor — staying silent');
    return;
  }

  // On Monday the weekly insight rides along (or is the whole message). Build it
  // first so the item loop can leave room for it under Telegram's cap.
  const weekly = isMonday ? await weeklyInsight(env, nowMs) : '';
  const budget = DIGEST_MAX_CHARS - (weekly ? weekly.length + 4 : 0);
  const withDrafts = draftsEnabled(env);
  // Whether a draft can carry buttons at all. It needs the Reddit secrets AND a
  // Reddit thread to answer: a Hacker News or Google Alerts item has nothing to
  // tap, so its draft still rides inside the digest as text to copy.
  const oneTap = oneTapReady(env);
  const offers: {
    source_url: string;
    thing_id: string;
    subreddit: string;
    draft_text: string;
  }[] = [];

  const lines: string[] = [
    `HTMLRadar radar — daily digest — ${new Date(nowMs).toISOString().slice(0, 10)}`,
  ];
  let shown = 0;
  let drafted = 0;
  for (const it of items) {
    const block =
      `\n\n[${SOURCE_LABEL[it.source] ?? it.source}] ${it.title}` +
      `\n${it.source_url}` +
      `\ncategory: ${it.category} · intent ${it.intent_score}`;
    const raw = withDrafts && it.intent_score >= REPLY_THRESHOLD ? draftReply(it) : null;
    const thread = raw && oneTap ? parseRedditThread(it.source_url) : null;
    // A tappable draft leaves a pointer here and travels as its own message
    // below; the text is not repeated twice on one phone screen.
    const draft = raw ? (thread ? '\nDraft below — Post as me / Skip.' : `\n${raw}`) : '';
    if (lines.join('').length + block.length + draft.length > budget) break;
    lines.push(block);
    if (draft) {
      lines.push(draft);
      drafted++;
    }
    if (raw && thread)
      offers.push({
        source_url: it.source_url,
        thing_id: thread.thingId,
        subreddit: thread.subreddit,
        draft_text: raw,
      });
    shown++;
  }
  if (weekly) lines.push(`\n\n${weekly}`);

  const text = lines.join('');
  await sendTelegram(env, 'radar', 'daily-digest', text, {
    items_shown: shown,
    items_available: items.length,
    drafts: drafted,
    drafts_enabled: withDrafts,
    one_tap: offers.length,
    monday: isMonday,
    // The URLs shown, so a later "he replied to #2" can flip acted on the right row.
    item_urls: items.slice(0, shown).map((i) => i.source_url),
  });

  // After the digest, never inside it: each tappable draft is its own message,
  // because an inline keyboard belongs to one message and one decision.
  for (const offer of offers) await offerDraft(env, offer, nowMs);

  // eslint-disable-next-line no-console
  console.log(
    `[digest] ${shown} item(s), ${drafted} draft(s), ${offers.length} tappable, monday:${isMonday}`,
  );
}

// ---------------------------------------------------------------------------
// One-tap posting: a draft, two buttons, the founder's own account.
//
// WHAT IT DOES
//
// A draft that answers a Reddit thread arrives as its own Telegram message
// with two buttons. "Post as me" posts that exact text from HIS Reddit
// account; "Skip" closes it. Replying with different wording replaces the text
// and comes back as a new message with its own buttons. The SOP rule is
// unchanged — only the founder speaks in public — and the tap IS the speaking.
//
// WHAT SOL'S REVIEW CHANGED (3 Sep 2026)
//
// The first cut treated a callback carrying a draft id as proof of a tap. It
// is not. These are the five things that now stand between an HTTP request and
// a comment posted under the founder's name.
//
//   1. WHO. Every update must come from the configured founder user id, in the
//      configured private chat. The webhook secret proves the request came
//      from something holding a shared value; it cannot prove a human tapped.
//      Telegram sends `from.id` and `chat.id` precisely so they can be checked.
//   2. WHICH. An approval is bound to one message id, one immutable version of
//      the text, and one single-use nonce with a 72-hour expiry. A tap on a
//      stale message, an old version, a spent nonce or an expired draft does
//      nothing but say why. This is what makes a leftover button — an edit
//      race, or a keyboard Telegram failed to remove — inert rather than a
//      way to post text that was never approved on that message.
//   3. ONE WAY. `posted` and `skipped` are terminal, enforced by a database
//      trigger, and every transition is conditional. A Skip arriving mid-post
//      can no longer unclaim a draft Reddit is already being asked about.
//   4. THE RESERVATION. An append-only row is written BEFORE the Reddit
//      request leaves, inside the same locked function that counts the daily
//      cap. It is never removed. A request whose answer never arrived leaves
//      the draft in `reconcile`, and nothing is retried until a reconciliation
//      check has looked at the account's own recent comments. The old design
//      released its guard on failure, so a comment Reddit accepted but never
//      acknowledged left the thread open to be commented on twice.
//   5. NOTHING UPSTREAM IS QUOTED. Reddit's response body never reaches a row,
//      a message or a log. A status and an error code map to one of OUR
//      sentences; an unrecognised code is reported as a code, not as text.
//
// The tokens: the refresh token is a Worker secret, exchanged for a
// short-lived access token per post, and no code path here writes any of them
// to a row, a log line, or a message.

/** The cap on comments in a rolling 24 hours. The worker checks it before a tap
 *  is spent, for a friendlier message, and passes the same number to
 *  reserve_radar_post(), which decides it under a lock and is the authority — so
 *  there is one number rather than two that can drift apart.
 *
 *  Two, not the five the function defaults to, because the engagement standard
 *  says at most two comments a day and a written rule the code contradicts is
 *  not a rule. The standard's other two limits, five a week and one per
 *  subreddit per week, are the founder's discipline until a migration can count
 *  them in the same locked function. */
const REDDIT_DAILY_CAP = 2;
const ONETAP_WINDOW_MS = 24 * 60 * 60_000;
/** How long a button stays tappable. Long enough for a weekend. */
const DRAFT_TTL_MS = 72 * 60 * 60_000;
/** Refuse to post when Reddit says this few calls remain in the window. */
const REDDIT_RATELIMIT_FLOOR = 5;
/** A Telegram update is a few kilobytes. Anything far past that is not one. */
const MAX_WEBHOOK_BYTES = 32_768;

/** The subreddit and the thread's fullname behind a Reddit thread URL, or null
 *  when the URL is not a Reddit thread. The fullname ('t3_' + the base-36 id in
 *  the path) is what Reddit's comment endpoint takes as the parent. The
 *  trailing boundary is not decoration: without it a malformed path is
 *  partially accepted and yields a parent id belonging to a different thread. */
export function parseRedditThread(url: string): { subreddit: string; thingId: string } | null {
  const m =
    /^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com\/r\/([a-z0-9_]{2,32})\/comments\/([a-z0-9]{4,16})(?:[/?#]|$)/i.exec(
      url,
    );
  if (!m || !m[1] || !m[2]) return null;
  return { subreddit: m[1], thingId: `t3_${m[2].toLowerCase()}` };
}

/** True when every secret the one-tap path needs is set. Missing any of them
 *  leaves the radar exactly as it was: drafts still arrive, as text to copy.
 *  The founder's user id is in the list because without it the handler cannot
 *  tell his tap from anybody else's. */
export function oneTapReady(env: Env): boolean {
  return Boolean(
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_CHAT_ID &&
    env.TELEGRAM_WEBHOOK_SECRET &&
    env.TELEGRAM_FOUNDER_USER_ID &&
    env.REDDIT_CLIENT_ID &&
    env.REDDIT_CLIENT_SECRET &&
    env.REDDIT_REFRESH_TOKEN &&
    env.REDDIT_USERNAME,
  );
}

interface DraftRow {
  id: string;
  source_url: string;
  thing_id: string;
  subreddit: string | null;
  draft_text: string;
  version: number;
  status: string;
  nonce: string | null;
  nonce_used_at: string | null;
  expires_at: string;
  permalink: string | null;
  telegram_message_id: number | null;
}

const DRAFT_COLS =
  'id,source_url,thing_id,subreddit,draft_text,version,status,nonce,nonce_used_at,expires_at,permalink,telegram_message_id';

const draftsUrl = (env: Env, query: string) => `${env.SUPABASE_URL}/rest/v1/radar_drafts?${query}`;

const draftWriteHeaders = (env: Env, prefer: string) => ({
  ...radarHeaders(env),
  'Content-Type': 'application/json',
  Prefer: prefer,
});

/** A fresh single-use callback token. 32 hex characters, from the platform's
 *  own CSPRNG — this is a bearer credential for speaking as the founder. */
function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

async function createDraft(env: Env, row: Record<string, unknown>): Promise<DraftRow | null> {
  const res = await fetch(draftsUrl(env, `select=${DRAFT_COLS}`), {
    method: 'POST',
    headers: draftWriteHeaders(env, 'return=representation'),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`radar_drafts insert HTTP ${res.status}`);
  return ((await res.json()) as DraftRow[])[0] ?? null;
}

/** The draft a callback token names. Used only to explain a refusal — the
 *  guarantee is consumeNonce below, never this read. */
async function readDraftByNonce(env: Env, nonce: string): Promise<DraftRow | null> {
  const res = await fetch(
    draftsUrl(env, `nonce=eq.${encodeURIComponent(nonce)}&select=${DRAFT_COLS}&limit=1`),
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_drafts read HTTP ${res.status}`);
  return ((await res.json()) as DraftRow[])[0] ?? null;
}

/** The draft a Telegram reply is answering. Newest first, because a re-offered
 *  draft's message id moves to the replacement message. */
async function readDraftByMessage(env: Env, messageId: number): Promise<DraftRow | null> {
  const res = await fetch(
    draftsUrl(
      env,
      `telegram_message_id=eq.${messageId}&order=created_at.desc&limit=1&select=${DRAFT_COLS}`,
    ),
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_drafts read HTTP ${res.status}`);
  return ((await res.json()) as DraftRow[])[0] ?? null;
}

/** A conditional update. `filter` is appended to the id match, so a caller can
 *  say "only if it is still pending" and mean it. Returns the rows that
 *  actually changed, which is empty when the condition did not hold. */
async function patchDraft(
  env: Env,
  id: string,
  patch: Record<string, unknown>,
  filter = '',
): Promise<DraftRow[]> {
  const res = await fetch(
    draftsUrl(env, `id=eq.${encodeURIComponent(id)}${filter}&select=${DRAFT_COLS}`),
    {
      method: 'PATCH',
      headers: draftWriteHeaders(env, 'return=representation'),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  // A 4xx here is the terminal-state trigger refusing to reopen a posted or
  // skipped draft. That is a correct refusal, not an error to propagate.
  if (!res.ok) return [];
  return (await res.json()) as DraftRow[];
}

/** THE gate. One conditional update spends the nonce and moves the status, so
 *  a replayed callback, a stale button, an expired draft and a terminal state
 *  all fail in the database rather than in a sequence of checks that another
 *  request can interleave with. Only the caller that gets a row back proceeds. */
async function consumeNonce(
  env: Env,
  nonce: string,
  version: number,
  messageId: number,
  nextStatus: string,
  nowMs: number,
): Promise<DraftRow | null> {
  const nowIso = new Date(nowMs).toISOString();
  const res = await fetch(
    draftsUrl(
      env,
      `nonce=eq.${encodeURIComponent(nonce)}` +
        `&nonce_used_at=is.null` +
        `&version=eq.${version}` +
        `&telegram_message_id=eq.${messageId}` +
        `&expires_at=gt.${encodeURIComponent(nowIso)}` +
        `&status=in.(pending,edited,reconcile)` +
        `&select=${DRAFT_COLS}`,
    ),
    {
      method: 'PATCH',
      headers: draftWriteHeaders(env, 'return=representation'),
      body: JSON.stringify({ nonce_used_at: nowIso, status: nextStatus, updated_at: nowIso }),
    },
  );
  if (!res.ok) return null;
  return ((await res.json()) as DraftRow[])[0] ?? null;
}

/** Claims the thread and one slot of the daily cap in a single locked
 *  statement (schema/046). Answers 'ok', 'thread_taken' or 'cap_reached'. */
async function reservePost(env: Env, draftId: string, thingId: string): Promise<string> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reserve_radar_post`, {
    method: 'POST',
    headers: { ...radarHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_draft_id: draftId, p_thing_id: thingId, p_cap: REDDIT_DAILY_CAP }),
  });
  if (!res.ok) throw new Error(`reserve_radar_post HTTP ${res.status}`);
  return String(await res.json());
}

/** The pre-flight cap count, for a friendly refusal before a tap is spent.
 *  Counts reservations, the same ledger the function counts. */
async function reservedInWindow(env: Env, nowMs: number): Promise<number> {
  const since = encodeURIComponent(new Date(nowMs - ONETAP_WINDOW_MS).toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/radar_post_reservations` +
      `?created_at=gte.${since}&select=thing_id&limit=${REDDIT_DAILY_CAP + 1}`,
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_post_reservations read HTTP ${res.status}`);
  return ((await res.json()) as unknown[]).length;
}

// ---------------------------------------------------------------------------
// Reddit.

/** Reddit's published User-Agent format: platform, application id, version,
 *  and the human behind it. See the API rules wiki. */
function redditUserAgent(env: Env): string {
  return `web:htmlradar-radar:1.0 (by /u/${env.REDDIT_USERNAME ?? 'unknown'})`;
}

/** Our sentence for a Reddit refusal. Reddit's own prose is never shown: an
 *  upstream body copied into a row and a message is a disclosure path we get
 *  nothing for. An unknown code is reported as a code, and only after it has
 *  been checked to be a code. */
const REDDIT_REASONS: Record<string, string> = {
  RATELIMIT: 'Reddit is rate-limiting the account. Try again in a few minutes.',
  SUBREDDIT_NOTALLOWED: 'That subreddit does not accept comments from this account.',
  SUBREDDIT_NOTALLOWED_NOAUTH: 'That subreddit does not accept comments from this account.',
  THREAD_LOCKED: 'That thread is locked.',
  TOO_OLD: 'That thread is archived and no longer takes comments.',
  DELETED_LINK: 'That thread has been deleted.',
  DELETED_COMMENT: 'The parent comment has been deleted.',
  TOO_LONG: 'The reply is longer than Reddit accepts.',
  NO_TEXT: 'Reddit saw an empty reply.',
  USER_BLOCKED: 'That user has blocked this account.',
  NOT_AUTHOR: 'This account is not allowed to reply there.',
  BANNED_FROM_SUBREDDIT: 'This account is banned from that subreddit.',
};

function redditReason(code: string): string {
  const known = REDDIT_REASONS[code];
  if (known) return known;
  // Only a code-shaped token is ever echoed, never free text from upstream.
  const safe = /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unrecognised';
  return `Reddit refused the reply (code ${safe}).`;
}

function redditStatusReason(status: number): string {
  if (status === 401 || status === 403)
    return 'Reddit refused the account. Either the saved login expired or that subreddit does not accept comments from it.';
  if (status === 404) return 'Reddit could not find that thread.';
  if (status === 429) return 'Reddit is rate-limiting the account. Try again in a few minutes.';
  if (status >= 500) return `Reddit is having trouble (HTTP ${status}). Nothing was posted.`;
  return `Reddit refused the reply (HTTP ${status}).`;
}

/** Thrown when the request definitely reached Reddit and was refused. Safe to
 *  leave the draft as failed and retry later. */
class RedditRefused extends Error {}
/** Thrown when the request may have been received and we cannot tell. The
 *  draft goes to `reconcile` and nothing is retried until it is checked. */
class RedditAmbiguous extends Error {}

/** Exchanges the permanent refresh token for a short-lived access token. The
 *  error carries a status and nothing else — the request that failed holds both
 *  the client secret and the refresh token. */
async function redditAccessToken(env: Env): Promise<string> {
  let res: Response;
  try {
    res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': redditUserAgent(env),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: env.REDDIT_REFRESH_TOKEN ?? '',
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch {
    // Nothing was posted: this call only mints a token.
    throw new RedditRefused('Could not reach Reddit to sign in. Nothing was posted.');
  }
  if (!res.ok) {
    throw new RedditRefused(
      res.status === 400 || res.status === 401
        ? 'Reddit would not accept the saved login. The refresh token has probably been revoked — re-run ops/scripts/reddit_auth.py and set the secret again.'
        : `Reddit would not issue an access token (HTTP ${res.status}). Probably temporary.`,
    );
  }
  let token: string | undefined;
  try {
    token = ((await res.json()) as { access_token?: string }).access_token;
  } catch {
    token = undefined;
  }
  if (!token) throw new RedditRefused('Reddit returned no access token.');
  return token;
}

interface RedditIdentity {
  name: string;
  /** Calls left in Reddit's current window, null when it said nothing. */
  remaining: number | null;
  /** Seconds until that window resets. */
  resetSec: number | null;
}

/** Who the saved token actually belongs to, and how much quota is left. This
 *  runs before every post for two reasons: it catches a token minted while
 *  signed in as the wrong account, and its response headers are where Reddit
 *  publishes the rate-limit state, so the back-off costs no extra call. */
async function redditIdentity(env: Env, token: string): Promise<RedditIdentity> {
  let res: Response;
  try {
    res = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': redditUserAgent(env) },
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch {
    throw new RedditRefused('Could not reach Reddit to check the account. Nothing was posted.');
  }
  if (!res.ok) throw new RedditRefused(redditStatusReason(res.status));
  const num = (h: string): number | null => {
    const v = res.headers.get(h);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  let name = '';
  try {
    name = String(((await res.json()) as { name?: string }).name ?? '');
  } catch {
    throw new RedditRefused('Reddit gave an unreadable answer when asked which account this is.');
  }
  return { name, remaining: num('x-ratelimit-remaining'), resetSec: num('x-ratelimit-reset') };
}

/** Posts one comment and returns its absolute permalink. Everything it throws
 *  is already a sentence fit to show the founder, and says which of the two
 *  kinds of failure it was. */
async function postRedditComment(
  env: Env,
  token: string,
  thingId: string,
  text: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch('https://oauth.reddit.com/api/comment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': redditUserAgent(env),
      },
      body: new URLSearchParams({ api_type: 'json', thing_id: thingId, text }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch {
    // The request left. Whether Reddit acted on it is unknowable from here.
    throw new RedditAmbiguous(
      'The reply was sent but Reddit never answered, so it is not known whether it went up.',
    );
  }
  if (res.status >= 500) {
    throw new RedditAmbiguous(
      `Reddit answered ${res.status} after taking the reply, so it is not known whether it went up.`,
    );
  }
  if (!res.ok) throw new RedditRefused(redditStatusReason(res.status));

  let parsed: {
    json?: { errors?: string[][]; data?: { things?: { data?: { permalink?: string } }[] } };
  };
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    throw new RedditAmbiguous('Reddit answered with something unreadable after taking the reply.');
  }
  // Reddit reports a rejected comment inside a 200: json.errors is a list of
  // [code, prose, field]. Only the code is used; the prose is upstream text.
  const errors = parsed.json?.errors ?? [];
  if (errors.length > 0) throw new RedditRefused(redditReason(String(errors[0]?.[0] ?? '')));

  const permalink = parsed.json?.data?.things?.[0]?.data?.permalink;
  if (!permalink) {
    throw new RedditAmbiguous('Reddit accepted the reply but did not say where it is.');
  }
  return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
}

/** Did the comment actually go up? Reads the account's own recent comments and
 *  looks for one whose parent is this thread. This is the only honest way out
 *  of an ambiguous outcome, and the only thing allowed to unblock a retry. */
async function reconcileRedditComment(
  env: Env,
  token: string,
  thingId: string,
): Promise<string | null> {
  const res = await fetch(
    `https://oauth.reddit.com/user/${encodeURIComponent(env.REDDIT_USERNAME ?? '')}/comments?limit=100`,
    {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': redditUserAgent(env) },
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new RedditAmbiguous(redditStatusReason(res.status));
  let listing: { data?: { children?: { data?: { link_id?: string; permalink?: string } }[] } };
  try {
    listing = (await res.json()) as typeof listing;
  } catch {
    throw new RedditAmbiguous('Reddit gave an unreadable answer when asked for recent comments.');
  }
  for (const child of listing.data?.children ?? []) {
    if (child.data?.link_id === thingId) {
      const p = child.data.permalink ?? '';
      return p.startsWith('http') ? p : `https://www.reddit.com${p}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Telegram side: keyboards, edits, and the callback answer.

/** The two buttons. callback_data is capped at 64 bytes by Telegram; the
 *  single-use token plus the version fits in 40. The DRAFT ID is deliberately
 *  not in there — a durable identifier in a button is a replayable one. */
function draftKeyboard(nonce: string, version: number): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: 'Post as me', callback_data: `post:${nonce}:${version}` },
        { text: 'Skip', callback_data: `skip:${nonce}:${version}` },
      ],
    ],
  };
}

/** Rebuilt from the row rather than stored, so a re-offer and the original
 *  render identically and there is one definition of what a draft looks like. */
function draftMessageText(d: Pick<DraftRow, 'subreddit' | 'source_url' | 'draft_text'>): string {
  return (
    `Reply ready — r/${d.subreddit ?? 'reddit'}\n${d.source_url}\n\n` +
    `${draftBody(d.draft_text)}\n\nTap to post this as you, or reply with your own wording.`
  );
}

/** Fire-and-forget Telegram call for the housekeeping methods. Never throws: by
 *  the time these run the outcome is already recorded, and a failure to redraw
 *  a message must not turn a success into a reported failure. It is safe for
 *  these to fail — a button whose keyboard survives is inert anyway, because
 *  its nonce is spent. */
async function telegramCall(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[onetap] telegram ${method} failed:`, (err as Error).message);
  }
}

/** Rewrites a draft message and removes its buttons. */
async function editDraftMessage(env: Env, messageId: number | null, text: string): Promise<void> {
  if (!messageId) return;
  await telegramCall(env, 'editMessageText', {
    chat_id: env.TELEGRAM_CHAT_ID,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  });
}

/** Clears the spinner on the tapped button. Telegram shows `text` as a toast. */
async function answerCallback(env: Env, callbackId: string, text: string): Promise<void> {
  await telegramCall(env, 'answerCallbackQuery', { callback_query_id: callbackId, text });
}

// ---------------------------------------------------------------------------
// Offering a draft, and offering it again.

/** Sends a draft's message with fresh buttons and records which message and
 *  which token are now the live ones. Used for the first offer, for an edit,
 *  and for a retry after reconciliation — one definition of "this is now the
 *  live offer", so a re-offer can never leave two live buttons behind. */
async function sendOffer(env: Env, draft: DraftRow, note: string): Promise<void> {
  const text = note ? `${draftMessageText(draft)}\n\n${note}` : draftMessageText(draft);
  const sent = await sendTelegramMessage(
    env,
    'radar',
    'onetap-offer',
    text,
    { draft_id: draft.id, thing_id: draft.thing_id, version: draft.version },
    draftKeyboard(draft.nonce ?? '', draft.version),
  );
  // Without the message id a tap cannot be bound to this message, so the
  // buttons would refuse every tap. Record it before anything else arrives.
  if (sent.messageId) await patchDraft(env, draft.id, { telegram_message_id: sent.messageId });
}

/** Replaces a draft's text and/or state and offers it again under a new
 *  version, a new token and a fresh expiry. Conditional on the draft not being
 *  terminal, so a re-offer cannot resurrect something already posted or
 *  skipped. Returns false when the condition did not hold. */
async function reoffer(
  env: Env,
  draft: DraftRow,
  opts: { text?: string; status: string; note: string; nowMs: number },
): Promise<boolean> {
  const nonce = newNonce();
  const [updated] = await patchDraft(
    env,
    draft.id,
    {
      ...(opts.text === undefined ? {} : { draft_text: opts.text }),
      status: opts.status,
      version: draft.version + 1,
      nonce,
      nonce_used_at: null,
      expires_at: new Date(opts.nowMs + DRAFT_TTL_MS).toISOString(),
    },
    `&status=not.in.(posted,skipped)`,
  );
  if (!updated) return false;
  // The message that carried the old buttons is settled first, so there is
  // exactly one live offer even if the founder is looking at both.
  await editDraftMessage(
    env,
    draft.telegram_message_id,
    `${draftMessageText(draft)}\n\n${opts.note}`,
  );
  await sendOffer(env, updated, '');
  return true;
}

/** Writes the draft row and sends its first message. Never throws — the digest
 *  has already gone out, and one failed offer must not take the batch with it. */
export async function offerDraft(
  env: Env,
  offer: { source_url: string; thing_id: string; subreddit: string; draft_text: string },
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const row = await createDraft(env, {
      ...offer,
      nonce: newNonce(),
      expires_at: new Date(nowMs + DRAFT_TTL_MS).toISOString(),
    });
    if (row) await sendOffer(env, row, '');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[onetap] could not offer a draft:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// The webhook.

interface TelegramFrom {
  id?: number;
}
interface TelegramChat {
  id?: number | string;
}
interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: TelegramFrom;
  message?: { message_id: number; chat?: TelegramChat };
}
interface TelegramMessage {
  message_id: number;
  text?: string;
  from?: TelegramFrom;
  chat?: TelegramChat;
  reply_to_message?: { message_id: number };
}
export interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

/** The founder, in his own chat, and nobody else. A shared webhook secret
 *  proves the caller holds a value; it cannot prove a human tapped a button.
 *  Telegram states the sender and the chat on every update so they can be
 *  checked, and an update that fails this is dropped in silence — answering it
 *  would confirm to whoever sent it that the endpoint is real. */
function fromFounder(env: Env, from?: TelegramFrom, chat?: TelegramChat): boolean {
  if (!env.TELEGRAM_FOUNDER_USER_ID || !env.TELEGRAM_CHAT_ID) return false;
  return (
    String(from?.id ?? '') === String(env.TELEGRAM_FOUNDER_USER_ID) &&
    String(chat?.id ?? '') === String(env.TELEGRAM_CHAT_ID)
  );
}

/** Why a tap was refused, in one sentence, without touching anything. Returns
 *  null when nothing is obviously wrong and the atomic gate should decide. */
function staleReason(
  draft: DraftRow | null,
  version: number,
  messageId: number,
  nowMs: number,
): string | null {
  if (!draft) return 'That button is no longer valid.';
  if (draft.status === 'posted') return 'That one is already posted.';
  if (draft.status === 'skipped') return 'That one was skipped.';
  if (draft.status === 'posting') return 'That one is being posted right now.';
  if (draft.nonce_used_at) return 'That button has already been used.';
  if (draft.version !== version) return 'That button is for an older version of the reply.';
  if (draft.telegram_message_id !== messageId)
    return 'That message has been replaced — use the newest one.';
  if (Date.parse(draft.expires_at) <= nowMs) return 'That draft has expired. Nothing was posted.';
  return null;
}

async function handleSkip(
  env: Env,
  cb: TelegramCallbackQuery,
  nonce: string,
  version: number,
  messageId: number,
  nowMs: number,
): Promise<void> {
  const claimed = await consumeNonce(env, nonce, version, messageId, 'skipped', nowMs);
  if (!claimed) {
    await answerCallback(
      env,
      cb.id,
      staleReason(await readDraftByNonce(env, nonce), version, messageId, nowMs) ??
        'Nothing to skip.',
    );
    return;
  }
  await editDraftMessage(env, messageId, `${draftMessageText(claimed)}\n\nSkipped.`);
  await answerCallback(env, cb.id, 'Skipped.');
}

async function handlePost(
  env: Env,
  cb: TelegramCallbackQuery,
  nonce: string,
  version: number,
  messageId: number,
  nowMs: number,
): Promise<void> {
  if (!oneTapReady(env)) {
    await answerCallback(env, cb.id, 'Reddit is not connected.');
    return;
  }

  // Read first, only to explain a refusal in words and to remember whether this
  // draft is coming back from an unknown outcome. The guarantee is the
  // conditional update below, never this read.
  const before = await readDraftByNonce(env, nonce);
  const early = staleReason(before, version, messageId, nowMs);
  if (early) {
    await answerCallback(env, cb.id, early);
    return;
  }
  const priorStatus = before?.status ?? 'pending';

  // Pre-flight the cap before the tap is spent, so hitting the limit leaves the
  // button usable tomorrow instead of burning it.
  if ((await reservedInWindow(env, nowMs)) >= REDDIT_DAILY_CAP) {
    await answerCallback(
      env,
      cb.id,
      `That would be more than ${REDDIT_DAILY_CAP} in 24 hours. The button still works tomorrow.`,
    );
    return;
  }

  // The gate: one conditional update spends the nonce and moves the draft to
  // `posting`. Everything a replayed, stale, expired or already-settled tap
  // could be fails here, in the database, rather than in a sequence of checks
  // another request can interleave with.
  const draft = await consumeNonce(env, nonce, version, messageId, 'posting', nowMs);
  if (!draft) {
    await answerCallback(
      env,
      cb.id,
      staleReason(await readDraftByNonce(env, nonce), version, messageId, nowMs) ??
        'That tap was already handled.',
    );
    return;
  }
  const body = draftMessageText(draft);
  const settle = async (patch: Record<string, unknown>, note: string, toast: string) => {
    await patchDraft(env, draft.id, patch);
    await editDraftMessage(env, messageId, `${body}\n\n${note}`);
    await answerCallback(env, cb.id, toast);
  };
  const markPosted = async (permalink: string) => {
    await patchDraft(env, draft.id, {
      status: 'posted',
      permalink,
      posted_at: new Date(nowMs).toISOString(),
      posted_version: draft.version,
      error: null,
    });
    await editDraftMessage(env, messageId, `${body}\n\nPosted: ${permalink}`);
    await answerCallback(env, cb.id, 'Posted.');
    await recordOutbox(env, {
      kind: 'radar',
      source: 'onetap-post',
      message: draftBody(draft.draft_text),
      telegram_ok: null,
      meta: { draft_id: draft.id, thing_id: draft.thing_id, permalink, version: draft.version },
    });
  };

  // An unedited draft still carries DRAFT_ANSWER_SLOT, which means the first
  // line is a note to himself and the rest is the same boilerplate every other
  // draft in that category carries. Reddit's Responsible Builder Policy names
  // exactly that ("identical or substantially similar content across
  // subreddits"), and no reader forgives it either. Refuse before the token, the
  // identity call and above all the reservation, because a reservation is never
  // released: burning one on a draft we were never going to post would close the
  // thread to the real reply.
  if (draftBody(draft.draft_text).includes(DRAFT_ANSWER_SLOT)) {
    const msg =
      'This draft still has the placeholder first line. Reply with your own answer to their ' +
      'question and the edited version comes back with its own button.';
    await settle({ status: 'failed', error: msg }, `Not posted. ${msg}`, 'Needs your own words.');
    return;
  }

  let token: string;
  let who: RedditIdentity;
  try {
    token = await redditAccessToken(env);
    who = await redditIdentity(env, token);
  } catch (err) {
    const msg = (err as Error).message;
    await settle({ status: 'failed', error: msg }, `Not posted. ${msg}`, 'Not posted.');
    return;
  }

  // The authorised account must be the one we think it is. A token minted while
  // signed in as somebody else would otherwise post under that name, and the
  // whole design rests on the name being his.
  if (who.name.toLowerCase() !== (env.REDDIT_USERNAME ?? '').toLowerCase()) {
    const msg =
      'The saved Reddit login belongs to a different account than REDDIT_USERNAME. ' +
      'Re-run ops/scripts/reddit_auth.py signed in as the right one.';
    await settle({ status: 'failed', error: msg }, `Not posted. ${msg}`, 'Wrong Reddit account.');
    return;
  }
  // Reddit publishes its remaining quota on every response, so backing off
  // costs nothing: the identity call above had to happen anyway.
  if (who.remaining !== null && who.remaining < REDDIT_RATELIMIT_FLOOR) {
    const secs = who.resetSec === null ? 'shortly' : `in about ${Math.ceil(who.resetSec)} seconds`;
    const msg = `Reddit's quota for this account is nearly used up; it resets ${secs}.`;
    await settle(
      { status: 'failed', error: msg },
      `Not posted. ${msg}`,
      'Backing off — quota low.',
    );
    return;
  }
  const identity = { reddit_identity: who.name, verified_at: new Date(nowMs).toISOString() };

  // Coming back from an unknown outcome: look before sending anything. This is
  // the only thing allowed to unblock a retry, and it runs BEFORE the second
  // request rather than after it.
  if (priorStatus === 'reconcile') {
    let found: string | null = null;
    let checkFailed = false;
    try {
      found = await reconcileRedditComment(env, token, draft.thing_id);
    } catch {
      checkFailed = true;
    }
    if (found) {
      await markPosted(found);
      return;
    }
    if (checkFailed) {
      // Not knowing is not licence to send again. The draft stays blocked and
      // comes back with a button that will try the check once more.
      const msg = 'Could not check Reddit for the earlier reply, so nothing was sent again.';
      await patchDraft(env, draft.id, { status: 'reconcile', error: msg, meta: identity });
      await reoffer(
        env,
        { ...draft, status: 'reconcile' },
        { status: 'reconcile', note: msg, nowMs },
      );
      await answerCallback(env, cb.id, 'Check failed — nothing sent.');
      return;
    }
    // Checked, and it is genuinely not there. Falling through re-sends, and
    // reserve_radar_post returns 'ok' because this draft already owns the
    // reservation — the thread stays closed to every other draft.
  }

  // The reservation, atomic with the daily cap, written before Reddit is asked
  // and never removed.
  let reserved: string;
  try {
    reserved = await reservePost(env, draft.id, draft.thing_id);
  } catch {
    const msg = 'Could not record the reservation, so nothing was sent.';
    await settle(
      { status: 'failed', error: msg, meta: identity },
      `Not posted. ${msg}`,
      'Not posted.',
    );
    return;
  }
  if (reserved === 'thread_taken') {
    const msg = 'This account has already replied on that thread.';
    await settle(
      { status: 'failed', error: msg, meta: identity },
      `Not posted: ${msg}`,
      'Already replied there.',
    );
    return;
  }
  if (reserved === 'cap_reached') {
    const msg = `that would be more than ${REDDIT_DAILY_CAP} replies in 24 hours`;
    await settle(
      { status: 'failed', error: msg, meta: identity },
      `Not posted: ${msg}.`,
      'Daily cap reached.',
    );
    return;
  }

  try {
    const permalink = await postRedditComment(
      env,
      token,
      draft.thing_id,
      draftBody(draft.draft_text),
    );
    await markPosted(permalink);
  } catch (err) {
    const msg = (err as Error).message;
    if (!(err instanceof RedditAmbiguous)) {
      await settle(
        { status: 'failed', error: msg, meta: identity },
        `Not posted. ${msg}`,
        'Reddit refused.',
      );
      return;
    }
    // The request may have landed. Check the account's own comments now; if
    // that is inconclusive the draft stays blocked in `reconcile` and comes
    // back with a button that will re-check before it re-sends.
    let found: string | null = null;
    try {
      found = await reconcileRedditComment(env, token, draft.thing_id);
    } catch {
      found = null;
    }
    if (found) {
      await markPosted(found);
      return;
    }
    await patchDraft(env, draft.id, { status: 'reconcile', error: msg, meta: identity });
    await reoffer(
      env,
      { ...draft, status: 'reconcile' },
      {
        status: 'reconcile',
        note: `${msg} Tapping again re-checks Reddit before sending anything.`,
        nowMs,
      },
    );
    await answerCallback(env, cb.id, 'Outcome unknown — re-check sent.');
  }
}

/** A reply in Telegram is the founder rewording a draft. It replaces the text
 *  and comes back as a NEW message under a new version with a new token, so
 *  the old button is inert and the edit still waits for its own tap. */
async function handleEdit(env: Env, msg: TelegramMessage, nowMs: number): Promise<void> {
  const parentId = msg.reply_to_message?.message_id;
  const text = (msg.text ?? '').trim();
  if (!parentId || !text) return;
  const draft = await readDraftByMessage(env, parentId);
  if (!draft) return; // a reply to anything else in the chat is not our business
  if (draft.status === 'posted') {
    await sendTelegram(
      env,
      'radar',
      'onetap-edit',
      `That one is already posted, so the edit changes nothing: ${draft.permalink ?? 'on Reddit'}`,
      { draft_id: draft.id },
    );
    return;
  }
  const ok = await reoffer(env, draft, {
    text,
    status: 'edited',
    note: 'Replaced by your edit below.',
    nowMs,
  });
  if (!ok) {
    await sendTelegram(
      env,
      'radar',
      'onetap-edit',
      'That draft is already settled; the edit changed nothing.',
      {
        draft_id: draft.id,
      },
    );
  }
}

/** Routes one Telegram update. nowMs is a parameter so expiry and the cap
 *  window are reproducible under test. */
export async function handleTelegramUpdate(
  env: Env,
  update: TelegramUpdate,
  nowMs: number = Date.now(),
): Promise<void> {
  const cb = update.callback_query;
  if (cb) {
    // Silent drop: an update that is not the founder's, in his chat, gets no
    // answer at all. Answering tells the sender the endpoint is real.
    if (!fromFounder(env, cb.from, cb.message?.chat)) {
      // eslint-disable-next-line no-console
      console.error('[onetap] callback rejected: not the founder or not his chat');
      return;
    }
    const messageId = cb.message?.message_id;
    const [action, nonce, rawVersion] = (cb.data ?? '').split(':');
    const version = Number(rawVersion);
    if (
      (action !== 'post' && action !== 'skip') ||
      !nonce ||
      !Number.isInteger(version) ||
      !messageId
    ) {
      await answerCallback(env, cb.id, 'That button means nothing to me.');
      return;
    }
    if (action === 'skip') await handleSkip(env, cb, nonce, version, messageId, nowMs);
    else await handlePost(env, cb, nonce, version, messageId, nowMs);
    return;
  }
  if (update.message?.reply_to_message) {
    if (!fromFounder(env, update.message.from, update.message.chat)) {
      // eslint-disable-next-line no-console
      console.error('[onetap] reply rejected: not the founder or not his chat');
      return;
    }
    await handleEdit(env, update.message, nowMs);
  }
}

/** The webhook. Everything that is not an authenticated POST to the one path is
 *  a 404 — not a 401, because a 401 confirms the address is worth attacking.
 *  An unset TELEGRAM_WEBHOOK_SECRET is the same 404: no secret, no endpoint.
 *
 *  It answers 200 to every authenticated delivery, even one that threw, because
 *  Telegram redelivers anything else and a redelivery loop over a handler that
 *  posts to Reddit is the last thing this wants. The single-use nonce is what
 *  makes that safe. The address is public (workers.dev), so the body is size-
 *  capped before it is parsed. */
export async function handleWebhookRequest(request: Request, env: Env): Promise<Response> {
  const notFound = new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return notFound;
  if (new URL(request.url).pathname !== '/telegram/webhook') return notFound;
  if (!env.TELEGRAM_WEBHOOK_SECRET) return notFound;
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET)
    return notFound;

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES)
    return new Response('Payload too large', { status: 413 });
  const raw = await request.text();
  // A missing or lying Content-Length is why this is checked twice.
  if (raw.length > MAX_WEBHOOK_BYTES) return new Response('Payload too large', { status: 413 });

  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  try {
    await handleTelegramUpdate(env, update);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[onetap] update failed:', (err as Error).message);
  }
  return new Response('ok');
}

// ---------------------------------------------------------------------------
// Daily maintenance sentinel.
//
// docs/control/MAINTENANCE-REGISTER.md lists the duties that never close — the
// abuse queue, failed notification emails, yesterday's thread scan. Reading
// them was a thing a session did by hand, which means "nobody looked for two
// days" and "somebody looked and all was well" left the same trace: none.
//
// This is the machine-checkable half of that register, once a day, plus one
// check on the human half: has any maintenance session stamped a heartbeat in
// the last 48 hours? A sentinel that only watched the database would go on
// reporting all-clear through a fortnight of nobody running the register at
// all, which is the failure it exists to catch.
//
// 03:30 UTC, half an hour BEFORE the 04:00 thread scan, so the scan_run row it
// looks for is yesterday's finished run (23.5 hours old) rather than today's
// still-running one. That is also why the window is 26 hours: the same slack
// scanThreads gives itself.
//
// Quiet by default. A clean run says nothing at all — a daily "all fine" is
// how a channel gets muted — except on Monday, when one line proves the cron
// is alive and reports how fresh the heartbeat is. Everything it does say goes
// out as ONE message: six findings are one glance, six messages are noise.
//
// Every check runs inside its own try/catch, so a failure in one cannot hide
// the other three, and a check that could not run at all is reported as
// "check unavailable" rather than silently counting as clean. An unreadable
// table is not an empty table.

const SENTINEL_WINDOW_MS = 24 * 60 * 60_000;
// Matches scanThreads' own 26-hour window — see above.
const SENTINEL_SCAN_WINDOW_MS = 26 * 60 * 60_000;
const HEARTBEAT_STALE_HOURS = 48;
// One finding is one line; a run of 429s must not push the message past
// Telegram's 4096-char cap.
const SENTINEL_DETAIL_CHARS = 300;

interface AbuseRow {
  reason: string;
  document_id: string | null;
}

interface ScanRunRow {
  created_at: string;
  meta: { fetches?: ScanFetch[]; total_items?: number } | null;
}

/**
 * `nowMs` is the scheduled event's timestamp, not Date.now(): the Monday
 * all-clear keys off it, and passing it in is what makes both that and the
 * heartbeat arithmetic testable without freezing the clock.
 */
export async function sentinel(env: Env, nowMs: number = Date.now()): Promise<void> {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const since = (ms: number) => encodeURIComponent(new Date(nowMs - ms).toISOString());

  const findings: string[] = [];
  const meta: Record<string, unknown> = {};

  // One runner so every check gets the same isolation and the same wording for
  // "this check could not run", without five copies of the same try/catch.
  const run = async (name: string, check: () => Promise<string | null>): Promise<void> => {
    try {
      const finding = await check();
      if (finding) findings.push(finding);
    } catch (err) {
      findings.push(`check unavailable: ${name} — ${(err as Error).message}`);
    }
  };

  // Abuse queue. Recipient reports name a share; the upload screen's automated
  // flags name a document (schema/039), and they are different work — a report
  // is somebody complaining, a flag is a heuristic firing.
  await run('abuse_reports', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/abuse_reports` +
        `?created_at=gte.${since(SENTINEL_WINDOW_MS)}&select=reason,document_id`,
      { headers },
    );
    if (!res.ok) throw new Error(`abuse_reports read HTTP ${res.status}`);
    const rows = (await res.json()) as AbuseRow[];
    meta['abuse_reports'] = rows.length;
    if (rows.length === 0) return null;
    const flags = rows.filter((r) => r.document_id).length;
    const reasons = [...new Set(rows.map((r) => r.reason))].join(', ');
    return (
      `abuse: ${rows.length} new in 24h — ${rows.length - flags} recipient report(s), ` +
      `${flags} automated flag(s) [${reasons}]`
    );
  });

  // Failed notification emails. The 5-minute cron already alarms on a 30-minute
  // window; this is the register's 2-day duty, so it looks back a full day and
  // catches anything that failed and healed while nobody was watching.
  await run('notifications_log', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notifications_log` +
        `?status=eq.failed&created_at=gte.${since(SENTINEL_WINDOW_MS)}&select=count`,
      { headers: { ...headers, Prefer: 'count=exact' } },
    );
    if (!res.ok) throw new Error(`notifications_log read HTTP ${res.status}`);
    const failed = parseInt((res.headers.get('content-range') ?? '0-0/0').split('/')[1] ?? '0', 10);
    meta['notifications_failed'] = failed;
    return failed > 0
      ? `notifications: ${failed} email(s) failed in 24h — see notifications_log`
      : null;
  });

  // Unverified notification sends — handoff from schema/044. A 'queued' row
  // older than 30 minutes with no matching net._http_response becomes
  // 'unverified': nobody knows if it sent. A handful is expected (the
  // reconciler's own 10-minute cadence keeps them rare, not zero); a count
  // that keeps climbing is the signal that the reconciler cron stopped
  // firing or pg_net itself is down, which today would look identical to
  // "everything is fine" because nothing ever left 'queued'.
  await run('notifications_unverified', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/notifications_log` +
        `?status=eq.unverified&created_at=gte.${since(SENTINEL_WINDOW_MS)}&select=count`,
      { headers: { ...headers, Prefer: 'count=exact' } },
    );
    if (!res.ok) throw new Error(`notifications_log read HTTP ${res.status}`);
    const unverified = parseInt(
      (res.headers.get('content-range') ?? '0-0/0').split('/')[1] ?? '0',
      10,
    );
    meta['notifications_unverified'] = unverified;
    return unverified > 0
      ? `notifications: ${unverified} unverified in 24h — reconciler cron or pg_net may be down`
      : null;
  });

  // Yesterday's thread scan. A missing scan_run row is the finding schema/038
  // was written for: it is what a cron that never fired looks like.
  await run('scan_run', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/telegram_outbox` +
        `?kind=eq.scan_run&created_at=gte.${since(SENTINEL_SCAN_WINDOW_MS)}` +
        `&order=created_at.desc&limit=1&select=created_at,meta`,
      { headers },
    );
    if (!res.ok) throw new Error(`telegram_outbox read HTTP ${res.status}`);
    const row = ((await res.json()) as ScanRunRow[])[0];
    if (!row) {
      meta['scan_run'] = null;
      return 'thread scan: no scan_run row in the last 26h — the 04:00 UTC scan did not run, or could not write its row';
    }
    const fetches = row.meta?.fetches ?? [];
    const items = row.meta?.total_items ?? 0;
    const bad = fetches.filter((f) => f.error || f.status !== 200);
    meta['scan_run'] = { at: row.created_at, items, fetches: fetches.length, failed: bad.length };
    if (bad.length === 0) return null;
    const detail = bad
      .map((f) => `${f.source} ${f.query}: ${f.error ?? `HTTP ${f.status}`}`)
      .join('; ');
    return (
      `thread scan: ${items} item(s), ${bad.length} of ${fetches.length} fetch(es) failed — ` +
      detail.slice(0, SENTINEL_DETAIL_CHARS)
    );
  });

  // Yesterday's radar digest. Every run now writes a kind='radar' row — the
  // real digest, or on a silent day the no-send marker (see dailyDigest) — so
  // a missing row means the 05:00 UTC digest did not run at all, which before
  // the marker existed looked identical to "correctly found nothing today".
  await run('radar_digest', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/telegram_outbox` +
        `?kind=eq.radar&created_at=gte.${since(SENTINEL_SCAN_WINDOW_MS)}` +
        `&order=created_at.desc&limit=1&select=created_at`,
      { headers },
    );
    if (!res.ok) throw new Error(`telegram_outbox read HTTP ${res.status}`);
    const row = ((await res.json()) as { created_at: string }[])[0];
    meta['radar_digest'] = row ? row.created_at : null;
    return row
      ? null
      : 'radar: no radar row in the last 26h — the 05:00 UTC digest did not run, or could not write its row';
  });

  // The human half. Infinity when there is no heartbeat row at all, which
  // reads as infinitely stale and needs no second branch in the comparison.
  let heartbeatHours = Infinity;
  await run('heartbeat', async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/telegram_outbox` +
        `?kind=eq.heartbeat&order=created_at.desc&limit=1&select=created_at`,
      { headers },
    );
    if (!res.ok) throw new Error(`telegram_outbox read HTTP ${res.status}`);
    const row = ((await res.json()) as { created_at: string }[])[0];
    if (row) {
      heartbeatHours = Math.round(((nowMs - Date.parse(row.created_at)) / 3_600_000) * 10) / 10;
    }
    meta['heartbeat_hours'] = heartbeatHours;
    if (heartbeatHours <= HEARTBEAT_STALE_HOURS) return null;
    return (
      'heartbeat: no maintenance session has stamped the register in two days ' +
      (Number.isFinite(heartbeatHours)
        ? `(last ${heartbeatHours}h ago)`
        : '(no heartbeat row ever)')
    );
  });

  if (findings.length > 0) {
    // Plain text, no parse_mode: a stray underscore in a thread title or an
    // error string must not 400 the whole message.
    const text = [
      `HTMLRadar sentinel — ${new Date(nowMs).toISOString().slice(0, 10)}`,
      ...findings.map((f) => `• ${f}`),
    ].join('\n');
    await sendTelegram(env, 'sentinel', 'maintenance-sentinel', text, {
      ...meta,
      findings: findings.length,
    });
    return;
  }

  // Clean. Silent every day but Monday, when one line is the proof that the
  // silence means "checked and fine" rather than "cron is dead".
  if (new Date(nowMs).getUTCDay() === 1) {
    await sendTelegram(
      env,
      'sentinel',
      'maintenance-sentinel',
      `Sentinel: all clear this week; last heartbeat ${heartbeatHours}h ago`,
      meta,
    );
  }
}

export default {
  // The only HTTP this worker answers: Telegram delivering a button tap or a
  // reply to a draft. Everything else, every path and every method, is a 404.
  // See handleWebhookRequest for why an unset secret is also a 404.
  fetch(request: Request, env: Env): Promise<Response> {
    return handleWebhookRequest(request, env);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The daily 04:00 UTC trigger (see wrangler.toml) is the thread scan and
    // nothing else. Cloudflare calls scheduled() once per matching cron
    // expression, so returning here costs the 5-minute health checks nothing.
    if (event.cron === '0 4 * * *') {
      await scanThreads(env).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[scan] failed:', (err as Error).message);
      });
      return;
    }

    // 03:30 UTC: the daily maintenance sentinel, also on its own. It reads the
    // event's own timestamp rather than the clock so the Monday all-clear
    // fires on the schedule's Monday, not on a retry's.
    if (event.cron === '30 3 * * *') {
      await sentinel(env, event.scheduledTime).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[sentinel] failed:', (err as Error).message);
      });
      return;
    }

    // 05:00 UTC: the daily digest, an hour after the 04:00 mining scan so it
    // reads a finished radar_items harvest, not one still being written. It
    // reads the event's own timestamp so the Monday weekly-insight keys off the
    // schedule's Monday, not a retry's.
    if (event.cron === '0 5 * * *') {
      await dailyDigest(env, event.scheduledTime).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[digest] failed:', (err as Error).message);
      });
      return;
    }

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

    // Check 2: every route in CHECKS answers as it should, confirmed over
    // several attempts.
    //
    // One probe is weak evidence. /sign-in and /docs run as Cloudflare edge
    // functions (x-edge-runtime), and a transient edge 503 that heals in seconds
    // looks identical to a real outage in a single sample. That false positive
    // paged the founder on 2026-08-25 for a blip no user ever hit — zero traffic
    // in the window, nothing in app_error_log. A genuine outage survives all
    // three attempts; a blip does not.
    //
    // This is deliberately the OPPOSITE call to the webhook alarm above, which
    // stays loud on a single failure. The difference is whether the condition can
    // heal on its own: an edge blip does, an unprocessed payment never does.
    for (const check of CHECKS) {
      const problem = await probe(check);
      if (problem) {
        alerts.push(`${check.url} ${problem} — failed all ${ROUTE_ATTEMPTS} attempts`);
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

    // Deliberately NOT written to telegram_outbox: this alert goes out by
    // email, and an inbox is already a readable record — the outbox exists
    // for the one channel that isn't. A healthy run writes nothing here
    // either; a row every five minutes would bury the scan runs the table was
    // built to surface. ponytail: if health alerts ever move to Telegram they
    // go through sendTelegram with kind='alert', which the schema already
    // allows.
    //
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
