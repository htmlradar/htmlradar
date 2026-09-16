// Client-side event capture. Uses Supabase anon key + RLS policy
// `app_events_anon_insert` (user_id must be null). Fire-and-forget.

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const ANON = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;

const FP_KEY = 'hr:fp';

export function stripUrlQuery(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://htmlradar.com');
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

const CONVERTER_EVENTS = new Set([
  'converter.started',
  'converter.completed',
  'converter.rejected',
  'converter.download_clicked',
  'converter.tracked_link_clicked',
]);
const CONVERTER_REASONS = new Set([
  'portrait',
  'aspect',
  'text',
  'forms',
  'sizes',
  'pages',
  'single',
  'size',
  'format',
  'password',
  'damaged',
  'attachments',
  'timeout',
  'overflow',
  'cancelled',
  'multiple',
]);

function getFingerprint(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    let fp = localStorage.getItem(FP_KEY);
    if (!fp) {
      fp = crypto.randomUUID();
      localStorage.setItem(FP_KEY, fp);
    }
    // Also mirror to a cookie so the server can read it for alias /
    // server-event attribution. Year-long lifetime, lax samesite so
    // OAuth redirects still carry it.
    if (typeof document !== 'undefined') {
      document.cookie = `${FP_KEY}=${fp}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
    return fp;
  } catch {
    // private browsing / no localStorage
    return 'no-storage';
  }
}

const SRC_KEY = 'hr:src';

// First-touch attribution.
//
// The bug this fixes: `document.referrer` was read fresh on every page view,
// so a visitor who lands from Google and clicks through to /pricing has their
// origin recorded once and lost on every event after. By the time they sign up
// — and certainly by the time they pay — it's gone. Neither paying customer's
// source was in the dashboard; both had to be reconstructed by hand, matching
// signup timestamps against page views in the preceding 30 minutes.
//
// So: capture the source ONCE, on a browser's first ever page view, and carry
// it on every subsequent event forever. The fingerprint above already does
// exactly this for identity; this was simply never done for source.
//
// Mirrored to a cookie for the same reason the fingerprint is — server-side
// events (signup, payment) can then attribute themselves without the client.
//
// `gclid` is captured deliberately: it's Google's click identifier, and it's
// what makes server-side offline conversion import possible later, so ad
// bidding can optimise on customers who actually pay rather than on signups.
function getFirstTouch(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const existing = localStorage.getItem(SRC_KEY);
    if (existing) {
      const touch = JSON.parse(existing) as Record<string, unknown>;
      return {
        ...touch,
        first_referrer: stripUrlQuery(String(touch.first_referrer ?? '')),
        first_landing: String(touch.first_landing ?? '').split(/[?#]/)[0],
      };
    }

    const params = new URLSearchParams(window.location.search);
    const touch: Record<string, unknown> = {
      first_referrer: stripUrlQuery(document.referrer),
      first_landing: location.pathname,
      first_seen: new Date().toISOString(),
      // Recorded so automated traffic can be excluded from the funnel — and
      // excluded retroactively, which is impossible without storing it. Of 570
      // browsers that ever viewed the homepage, 508 viewed exactly one page
      // and left with no referrer; at this volume that is mostly crawlers.
      first_ua: navigator.userAgent?.slice(0, 300) ?? null,
    };
    for (const k of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'gclid',
    ]) {
      const v = params.get(k);
      if (v) touch[`first_${k}`] = v;
    }
    localStorage.setItem(SRC_KEY, JSON.stringify(touch));
    if (typeof document !== 'undefined') {
      // Same lifetime and samesite as the fingerprint cookie, so an OAuth
      // redirect doesn't drop it mid-signup.
      document.cookie = `${SRC_KEY}=${encodeURIComponent(JSON.stringify(touch))}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
    return touch;
  } catch {
    return {};
  }
}

// Extract the UTM params from the current URL. Captured once on every
// page.viewed so paid-channel attribution (Reddit Ads, newsletter
// sponsorships, etc.) is queryable later.
function getUtmParams(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = params.get(key);
      if (v) utm[key] = v;
    }
    return utm;
  } catch {
    return {};
  }
}

export async function captureClientEvent(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    const converter = typeof location !== 'undefined' && /^\/convert\/?$/.test(location.pathname);
    const converterEvent = event.startsWith('converter.');
    if (converterEvent && !CONVERTER_EVENTS.has(event)) return;
    if (converter && !converterEvent && event !== 'page.viewed') return;
    // Converter payloads are allowlisted at the transport boundary, including
    // callers outside the panel. Never carry arbitrary strings or attribution
    // query parameters alongside local PDF work.
    const safeProperties =
      converter || converterEvent
        ? typeof properties.reason === 'string' && CONVERTER_REASONS.has(properties.reason)
          ? { reason: properties.reason }
          : {}
        : properties;
    await fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        distinct_id: getFingerprint(),
        event,
        properties: {
          ...(!converter && !converterEvent ? { ...getFirstTouch(), ...getUtmParams() } : {}),
          ...safeProperties,
          path: typeof location !== 'undefined' ? location.pathname : null,
          referrer: typeof document !== 'undefined' ? stripUrlQuery(document.referrer) : null,
        },
      }),
      keepalive: true,
    });
  } catch {
    // Silent. Analytics must never break the user flow.
  }
}
