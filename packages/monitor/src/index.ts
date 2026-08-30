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
// And one job that isn't monitoring at all: a once-a-day scan of Hacker News
// and Reddit for people asking the question this product answers, Telegrammed
// to the founder so he can reply as himself (see scanThreads). It lives here
// because this worker already has a cron, a fetch, and nothing else to do at
// 04:00 UTC — a second worker for five HTTP calls a day would be silly.
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
  // Thread scan (see scanThreads). Optional: absent means the scan no-ops
  // rather than the worker failing to boot.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
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
// Daily thread scan.
//
// The one acquisition channel that works here is the founder answering a real
// question in a real thread, as himself, the same day it was asked. The part
// that kills it is the searching — nobody greps Hacker News and Reddit every
// morning. So the worker does that half and Telegrams the shortlist: five
// queries, two keyless sources, one message a day, replies still human.
//
// Deliberately stateless: no scoring, no "already seen" table. A 26-hour
// window against a once-a-day cron means the occasional repeat, which costs
// one glance — cheaper than a KV namespace to remember what was read. Zero
// hits sends nothing at all; a daily "found nothing" message is how a channel
// gets muted, and a muted channel is worse than no channel.

interface ThreadHit {
  source: string;
  title: string;
  url: string;
  angle: string;
}

// Each query carries the line the founder can open a reply with. Plain, no
// pitch — threads punish marketing voice, and he has to be able to say it in
// his own words in under five minutes.
const SCAN_QUERIES: { query: string; angle: string }[] = [
  {
    query: '"docsend alternative"',
    angle: 'Open-source alternative that tracks HTML rather than uploaded PDFs; free for 2 links.',
  },
  {
    query: '"share claude artifact"',
    angle:
      'A published artifact gives you a URL and nothing else; HTMLRadar adds who opened it and which sections they read.',
  },
  {
    query: '"share html file" link',
    angle: 'Paste or upload the HTML, get a link that keeps it a live page and shows reads.',
  },
  {
    query: 'papermark alternative',
    angle: 'Both open source; HTMLRadar is for HTML, not file uploads.',
  },
  {
    query: '"track who opened" proposal',
    angle: 'Per-client link, email gate optional, section-level read timeline.',
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
const SCAN_MAX_ITEMS = 10;
// Telegram hard-caps a message at 4096 chars. Stop short of it rather than
// find out in prod which item got sliced in half.
const SCAN_MAX_CHARS = 3_800;
const SCAN_TITLE_CHARS = 120;

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

async function scanHN(query: string, sinceSec: number): Promise<{ title: string; url: string }[]> {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date' +
      `?query=${encodeURIComponent(query)}&tags=(story,comment)` +
      `&numericFilters=created_at_i>${sinceSec}&hitsPerPage=10`,
    { signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`algolia HTTP ${res.status}`);
  const body = (await res.json()) as { hits?: HNHit[] };
  // story_title carries the thread a comment lives under, which is where the
  // query words usually sit when the hit is a reply rather than a story.
  return (body.hits ?? [])
    .filter((hit) =>
      matchesQuery(query, `${hit.title ?? ''} ${hit.story_title ?? ''} ${hit.comment_text ?? ''}`),
    )
    .map((hit) => ({
      // Stories have a title; comments only have their body.
      title: clean(hit.title ?? hit.comment_text ?? ''),
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    }));
}

// Reddit blocks datacentre IPs often enough that treating a refusal as an
// error would take the HN half of the scan down with it. Anything that isn't
// a 200 of XML is a silent skip for that query.
async function scanReddit(
  query: string,
  sinceMs: number,
): Promise<{ title: string; url: string }[]> {
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
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('xml')) return [];
  const xml = await res.text();
  const out: { title: string; url: string }[] = [];
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
    out.push({ title: clean(title), url: clean(url) });
  }
  return out;
}

async function scanThreads(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    // eslint-disable-next-line no-console
    console.log('[scan] no Telegram credentials set — skipping');
    return;
  }

  const sinceMs = Date.now() - SCAN_WINDOW_MS;
  const sinceSec = Math.floor(sinceMs / 1000);
  // Keyed by URL: the same thread surfaces under several queries, and the
  // first query to find it owns the angle.
  const hits = new Map<string, ThreadHit>();

  for (const [i, { query, angle }] of SCAN_QUERIES.entries()) {
    for (const source of ['HN', 'Reddit'] as const) {
      try {
        const found =
          source === 'HN' ? await scanHN(query, sinceSec) : await scanReddit(query, sinceMs);
        for (const { title, url } of found) {
          if (title && !hits.has(url)) hits.set(url, { source, title, url, angle });
        }
      } catch (err) {
        // One dead source or one bad query must not cost the whole scan.
        // eslint-disable-next-line no-console
        console.error(`[scan] ${source} "${query}" failed:`, (err as Error).message);
      }
    }
    if (i < SCAN_QUERIES.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, SCAN_QUERY_GAP_MS));
    }
  }
  if (hits.size === 0) return;

  // Plain text on purpose — no parse_mode, so a stray underscore in a thread
  // title can't 400 the whole message.
  let text = `HTMLRadar thread scan — ${new Date().toISOString().slice(0, 10)}`;
  let sent = 0;
  for (const hit of hits.values()) {
    if (sent >= SCAN_MAX_ITEMS) break;
    const block =
      `\n\n${hit.source} — ${hit.title.slice(0, SCAN_TITLE_CHARS)}` +
      `\n${hit.url}\nAngle: ${hit.angle}`;
    if (text.length + block.length > SCAN_MAX_CHARS) break;
    text += block;
    sent++;
  }

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
  const tg = (await res.json()) as { ok?: boolean; description?: string };
  // eslint-disable-next-line no-console
  console.log(
    `[scan] ${sent} of ${hits.size} item(s) sent — telegram ok:${tg.ok === true}`,
    tg.description ?? '',
  );
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
