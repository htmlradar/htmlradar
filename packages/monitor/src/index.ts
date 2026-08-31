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
// Reddit rate-limits anonymous search to roughly one call a minute per address,
// so five back-to-back queries get four 429s and Reddit contributes nothing.
// Spacing them costs wall-clock time, which a once-a-day cron has in abundance
// (timers burn no CPU): 3-of-5 queries landed at 30s versus 1-of-5 with no gap,
// and 45s buys the rest of the margin toward Reddit's roughly-one-a-minute
// ceiling. ponytail: 45s is a measured compromise, not a limit Reddit
// documents — raise it toward 60s if queries still come back throttled.
const SCAN_QUERY_GAP_MS = 45_000;

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

// Reddit blocks datacentre IPs often enough that treating a refusal as an
// error would take the HN half of the scan down with it. Anything that isn't
// a 200 of XML is a silent skip for that query.
async function scanReddit(query: string, sinceMs: number): Promise<ScanResult> {
  const res = await fetch(
    `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=new&t=week`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    },
  );
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

/** Sends one Telegram message and records it. Returns whether Telegram took it. */
export async function sendTelegram(
  env: Env,
  kind: OutboxKind,
  source: string,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<boolean> {
  let ok = false;
  let error: string | null = null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
    // Read the body as text, not res.json(): a 502 from Telegram's edge is
    // HTML, and json() would throw away the status and body that explain it.
    const body = await res.text();
    try {
      ok = res.ok && (JSON.parse(body) as { ok?: boolean }).ok === true;
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
  return ok;
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

// gapMs is a parameter for the same reason probe's retryMs is: so a test does
// not sit through minutes of real rate-limit spacing. nowMs is a parameter so
// the recency term of the score is reproducible under test.
export async function scanThreads(
  env: Env,
  gapMs: number = SCAN_QUERY_GAP_MS,
  nowMs: number = Date.now(),
): Promise<void> {
  const sinceMs = nowMs - SCAN_WINDOW_MS;
  const sinceSec = Math.floor(sinceMs / 1000);
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
          source === 'HN' ? await scanHN(query, sinceSec) : await scanReddit(query, sinceMs),
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

// The disclosure that MUST appear in every drafted reply — the "I built this"
// line the platforms and honesty both require. draftReply guarantees it; a test
// holds the guarantee. This is the guardrail Sol reviews before drafts go live.
export const DISCLOSURE = 'Full disclosure: I built HTMLRadar.';

/** A founder-voice reply DRAFT for one item. A scaffold he edits, not a
 *  finished post: plain first-person, the mandatory disclosure, and — where it
 *  genuinely fits — Papermark named as the honest pick for PDFs. Pure. */
export function draftReply(item: { category: RadarCategory; title: string }): string {
  let body: string;
  switch (item.category) {
    case 'competitor_mention':
      body =
        'For an open-source route, Papermark is the usual answer for PDFs — its own repo calls itself the open-source DocSend alternative. ' +
        'If what you send is HTML rather than an uploaded file, that is the gap I built for: a link that stays a live page and shows who opened it and which sections they read. ' +
        `${DISCLOSURE} It is AGPL, self-hostable, free for two tracked links. Either way, send one real document to yourself and read the per-section numbers — that is the feature.`;
      break;
    case 'product_feedback':
      body =
        'This exists. You paste or upload the HTML and get a link that stays a live page and reports who opened it, when, and which sections they actually read — not just a count of opens. ' +
        `${DISCLOSURE} It is open source (AGPL) and free for two tracked links. If your document is a PDF rather than HTML, Papermark is the honest pick.`;
      break;
    case 'reputation':
      body =
        'Happy to answer anything here. ' +
        `${DISCLOSURE} Treat this as the maker talking, not a neutral review. For PDFs specifically, Papermark is often the better fit than what I built.`;
      break;
    case 'buyer_question':
    default:
      body =
        'You can do this without emailing the file: paste or upload the HTML and share a link that stays a live page and shows who opened it and which sections they read. ' +
        `${DISCLOSURE} It is open source (AGPL) and free for two tracked links. If what you are sending is a PDF instead, Papermark is the honest pick.`;
      break;
  }
  // Belt to the braces above: no draft ever ships without the disclosure.
  if (!body.includes(DISCLOSURE)) body = `${DISCLOSURE} ${body}`;
  return `DRAFT (personal account, edit before posting): ${body}`;
}

function draftsEnabled(env: Env): boolean {
  const v = (env.RADAR_DRAFTS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

const radarHeaders = (env: Env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

/** The digest's candidate list: non-noise items from the last 24h, at or above
 *  REPLY_THRESHOLD, highest intent first, capped at DIGEST_MAX_ITEMS. The
 *  score floor and the cap are also applied here in code (not left to the
 *  query alone), so the guarantee holds even if the query changes underneath. */
async function readRecentRadarItems(env: Env, nowMs: number): Promise<RadarRow[]> {
  const since = encodeURIComponent(new Date(nowMs - DIGEST_WINDOW_MS).toISOString());
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/radar_items` +
      `?first_seen_at=gte.${since}&category=neq.noise&intent_score=gte.${REPLY_THRESHOLD}` +
      `&order=intent_score.desc,first_seen_at.desc&limit=${DIGEST_MAX_ITEMS}` +
      `&select=source,source_url,title,snippet,category,intent_score,published_at`,
    { headers: radarHeaders(env) },
  );
  if (!res.ok) throw new Error(`radar_items read HTTP ${res.status}`);
  const rows = (await res.json()) as RadarRow[];
  return rows.filter((r) => r.intent_score >= REPLY_THRESHOLD).slice(0, DIGEST_MAX_ITEMS);
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

  // Non-Monday with nothing above the noise floor: stay silent. A daily "found
  // nothing" is how a channel gets muted. Monday always speaks — see below.
  if (items.length === 0 && !isMonday) {
    // eslint-disable-next-line no-console
    console.log('[digest] nothing above the noise floor — staying silent');
    return;
  }

  // On Monday the weekly insight rides along (or is the whole message). Build it
  // first so the item loop can leave room for it under Telegram's cap.
  const weekly = isMonday ? await weeklyInsight(env, nowMs) : '';
  const budget = DIGEST_MAX_CHARS - (weekly ? weekly.length + 4 : 0);
  const withDrafts = draftsEnabled(env);

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
    const draft = withDrafts && it.intent_score >= REPLY_THRESHOLD ? `\n${draftReply(it)}` : '';
    if (lines.join('').length + block.length + draft.length > budget) break;
    lines.push(block);
    if (draft) {
      lines.push(draft);
      drafted++;
    }
    shown++;
  }
  if (weekly) lines.push(`\n\n${weekly}`);

  const text = lines.join('');
  await sendTelegram(env, 'radar', 'daily-digest', text, {
    items_shown: shown,
    items_available: items.length,
    drafts: drafted,
    drafts_enabled: withDrafts,
    monday: isMonday,
    // The URLs shown, so a later "he replied to #2" can flip acted on the right row.
    item_urls: items.slice(0, shown).map((i) => i.source_url),
  });

  // eslint-disable-next-line no-console
  console.log(`[digest] ${shown} item(s), ${drafted} draft(s), monday:${isMonday}`);
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
