import { createClient } from '@supabase/supabase-js';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import { logServerError } from '@/lib/error-log';
import { computeTierUpdate } from '@/lib/payments';
import { captureServerEvent, type AppEvent } from '@/lib/events';

export const runtime = 'edge';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
const WEBHOOK_SECRET = process.env['POLAR_WEBHOOK_SECRET'] ?? '';
const POLAR_API_KEY = process.env['POLAR_API_KEY'] ?? '';

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Polar SDK pattern: take the raw secret Polar gives, UTF-8 → base64,
// then hand to standardwebhooks. standardwebhooks base64-decodes back
// to the original bytes and uses them as the HMAC key. Polar's secrets
// are ASCII so btoa() is byte-equivalent to Buffer.from(s,'utf-8').toString('base64').
function verifyAndParse(rawBody: string, headers: Headers): { type: string; data: unknown } {
  // Polar secrets are alphanumeric — refuse anything that smells empty or
  // would silently produce a verifier with an empty HMAC key.
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 16) {
    throw new Error('POLAR_WEBHOOK_SECRET missing or implausibly short');
  }
  const base64Secret = btoa(WEBHOOK_SECRET);
  const wh = new Webhook(base64Secret);
  const headerObj: Record<string, string> = {};
  headers.forEach((v, k) => {
    headerObj[k] = v;
  });
  return wh.verify(rawBody, headerObj) as { type: string; data: unknown };
}

type PolarCustomer = {
  id?: string;
  email?: string | null;
  external_id?: string | null;
};

type PolarSubscription = {
  id: string;
  status: string;
  started_at: string | null;
  current_period_end: string | null;
  ended_at: string | null;
  customer?: PolarCustomer | null;
  customer_id?: string | null;
};

type PolarOrder = {
  id: string;
  subscription_id?: string | null;
};

async function polarGet<T>(path: string): Promise<T> {
  const r = await fetch(`https://api.polar.sh${path}`, {
    headers: { Authorization: `Bearer ${POLAR_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Polar GET ${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

type ResolutionResult =
  | { kind: 'matched'; profileId: string }
  | { kind: 'orphan_external_id'; externalId: string }
  | { kind: 'no_customer_reference' }
  | { kind: 'no_match' };

async function resolveProfileId(
  sb: ReturnType<typeof serviceClient>,
  sub: PolarSubscription,
): Promise<ResolutionResult> {
  let customer: PolarCustomer | null | undefined = sub.customer;
  if (!customer?.email && !customer?.external_id) {
    const id = sub.customer_id ?? customer?.id;
    if (!id) return { kind: 'no_customer_reference' };
    customer = await polarGet<PolarCustomer>(`/v1/customers/${id}`);
  }
  // external_id is authoritative when present. If it doesn't resolve, we
  // FAIL — do NOT fall through to email match. A stale/wrong external_id
  // falling through to an email lookup is how subscription hijack happens.
  if (customer.external_id) {
    const { data } = await sb
      .from('profiles')
      .select('id')
      .eq('id', customer.external_id)
      .maybeSingle();
    if (data?.id) return { kind: 'matched', profileId: data.id };
    return { kind: 'orphan_external_id', externalId: customer.external_id };
  }
  if (customer.email) {
    // ilike with no wildcards = case-insensitive equality. profiles.email
    // is typically lowercase from Supabase Auth, but some OAuth flows
    // preserve case — match either way.
    const { data } = await sb
      .from('profiles')
      .select('id')
      .ilike('email', customer.email)
      .maybeSingle();
    if (data?.id) {
      // Best-effort back-link so future events resolve via the authoritative
      // external_id path. Awaited (not fire-and-forget) so the request
      // doesn't return before the in-flight fetch on Workers/edge where
      // un-awaited fetches get cancelled.
      if (customer.id) {
        try {
          await fetch(`https://api.polar.sh/v1/customers/${customer.id}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${POLAR_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ external_id: data.id }),
          });
        } catch {
          // Backlink failure is non-fatal — the tier flip below still
          // succeeds; the next event for this customer just falls through
          // to email again.
        }
      }
      return { kind: 'matched', profileId: data.id };
    }
  }
  return { kind: 'no_match' };
}

async function applySubscription(
  sb: ReturnType<typeof serviceClient>,
  sub: PolarSubscription,
): Promise<string> {
  const resolution = await resolveProfileId(sb, sub);
  if (resolution.kind !== 'matched') {
    // Resolution failure messages are logged into webhook_events_log.error
    // for the founder to diagnose. Don't include user-identifiable data
    // in the response body (it ends up in Polar's delivery log).
    throw new Error(`resolve_failed:${resolution.kind}`);
  }
  // Read existing profile for coalescing pro_since / non-shrinking pro_until.
  const { data: existing } = await sb
    .from('profiles')
    .select('pro_since, pro_until')
    .eq('id', resolution.profileId)
    .single();

  const update = computeTierUpdate(sub, existing ?? null);
  const { error } = await sb.from('profiles').update(update).eq('id', resolution.profileId);
  if (error) throw new Error(`profile_update_failed:${error.code ?? 'unknown'}`);
  return resolution.profileId;
}

async function handleOrder(
  sb: ReturnType<typeof serviceClient>,
  order: PolarOrder,
): Promise<string | null> {
  // Orders for one-time products won't carry a subscription_id — skip them
  // since HTMLRadar only sells the recurring Pro plan. For renewals and
  // for $0 (100% discount) checkouts, the order carries subscription_id;
  // fetch the full subscription to get accurate current_period_end.
  if (!order.subscription_id) return null;
  const sub = await polarGet<PolarSubscription>(`/v1/subscriptions/${order.subscription_id}`);
  return applySubscription(sb, sub);
}

// The conversion moment must be visible in app_events, not just as a
// silent profiles.tier flip — it's the end of the land→signup→pay funnel.
// Only high-signal Polar event types map to an analytics event; the noisy
// subscription.updated / .created intermediates stay untracked.
const ANALYTICS_EVENT: Record<string, AppEvent> = {
  'order.paid': 'payment.received',
  'subscription.active': 'subscription.activated',
  'subscription.canceled': 'subscription.canceled',
  'subscription.uncanceled': 'subscription.resumed',
  'subscription.revoked': 'subscription.revoked',
};

// Awaited (not fire-and-forget) — on the edge runtime an un-awaited
// fetch gets cancelled when the response returns, same reason the
// Polar back-link PATCH above is awaited. captureServerEvent never throws.
async function captureConversionEvent(
  polarType: string,
  profileId: string,
  data: unknown,
): Promise<void> {
  const event = ANALYTICS_EVENT[polarType];
  if (!event) return;
  const d = data as { amount?: number; currency?: string; recurring_interval?: string };
  await captureServerEvent({
    event,
    distinctId: profileId,
    userId: profileId,
    properties: {
      polar_type: polarType,
      amount: d.amount ?? null,
      currency: d.currency ?? null,
      interval: d.recurring_interval ?? null,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const webhookId = req.headers.get('webhook-id') ?? '';

  let event: { type: string; data: unknown };
  try {
    event = verifyAndParse(rawBody, req.headers);
  } catch (e) {
    if (e instanceof WebhookVerificationError) {
      return new Response('signature mismatch', { status: 403 });
    }
    return new Response('verification failed', { status: 400 });
  }
  // Header presence is implicitly verified by the signature check above
  // (webhook-id is part of the signed payload). Belt-and-suspenders:
  // refuse if it's missing post-verify so we don't try to write a null PK.
  if (!webhookId) return new Response('missing webhook-id', { status: 400 });

  const sb = serviceClient();

  // Idempotency: try to claim the event. If a previous delivery already
  // claimed AND processed it, skip. If it claimed but didn't finish
  // processing (transient failure), allow this retry to re-process —
  // otherwise Polar's retry would silently return 200 and a paid
  // customer would be stuck.
  const { error: insertErr } = await sb.from('webhook_events_log').insert({
    event_id: webhookId,
    event_type: event.type,
    payload: event,
  });
  if (insertErr && insertErr.code === '23505') {
    const { data: prior } = await sb
      .from('webhook_events_log')
      .select('processed_at')
      .eq('event_id', webhookId)
      .single();
    if (prior?.processed_at) return new Response('duplicate', { status: 200 });
    // else: fall through and re-process. The UPDATE in applySubscription
    // is idempotent (same target values for the same event), and the
    // back-link PATCH on Polar is already idempotent.
  } else if (insertErr) {
    return new Response('log insert failed', { status: 500 });
  }

  try {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.active':
      case 'subscription.uncanceled':
      case 'subscription.past_due':
      case 'subscription.canceled':
      case 'subscription.revoked': {
        const profileId = await applySubscription(sb, event.data as PolarSubscription);
        await captureConversionEvent(event.type, profileId, event.data);
        break;
      }
      case 'order.created':
      case 'order.paid': {
        // Renewals: Polar charges the card → fires order.* with
        // subscription_id — fetch sub to get fresh current_period_end
        // and extend pro_until. Also covers $0 (Test100 100% discount)
        // checkouts where subscription.created may not fire.
        const profileId = await handleOrder(sb, event.data as PolarOrder);
        if (profileId) await captureConversionEvent(event.type, profileId, event.data);
        break;
      }
      default:
        break;
    }
    await sb
      .from('webhook_events_log')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', webhookId);
    return new Response('ok', { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await sb.from('webhook_events_log').update({ error: msg }).eq('event_id', webhookId);
    await logServerError({
      source: 'webhook.polar',
      message: msg,
      route: '/api/webhooks/polar',
      context: { event_id: webhookId, event_type: event.type },
    });
    // Generic 500 body — full error stays in webhook_events_log, not in
    // Polar's delivery log where it'd leak customer IDs / profile UUIDs.
    return new Response('processing failed', { status: 500 });
  }
}
