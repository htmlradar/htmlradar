// Client-side event capture. Uses Supabase anon key + RLS policy
// `app_events_anon_insert` (user_id must be null). Fire-and-forget.

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const ANON = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;

const FP_KEY = 'hr:fp';

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
          ...getUtmParams(),
          ...properties,
          path: typeof location !== 'undefined' ? location.pathname : null,
          referrer: typeof document !== 'undefined' ? document.referrer || null : null,
        },
      }),
      keepalive: true,
    });
  } catch {
    // Silent. Analytics must never break the user flow.
  }
}
