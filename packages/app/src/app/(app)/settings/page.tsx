import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { readQuota } from '@/lib/quota';
import {
  shouldOfferAnnualSwitch,
  switchToAnnual,
  type ActiveSubscription,
} from '@/lib/annual-switch';
import { SectionMark } from '@/components/SectionMark';
import { UpgradePending } from '@/components/UpgradePending';
import { SubscriptionControls } from '@/components/SubscriptionControls';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '@/lib/api-auth';
import { CONNECTOR_LABEL_PREFIX } from '@/lib/connect';
import { AnnualSwitch } from './AnnualSwitch';
import { ApiKeys, type ApiKeyRow } from './ApiKeys';
import { ConnectedApps } from './ConnectedApps';
import { ArrowRight, CheckCircle2, LogOut } from 'lucide-react';
import Link from 'next/link';

export const runtime = 'edge';

// These two names are not in the AppEvent union in lib/events.ts yet — that
// file is outside this change's file boundary. Add them to the union there and
// delete these two casts.

async function polarGet<T>(path: string): Promise<T> {
  // Reads env inside the function — next-on-pages can resolve env at
  // request time but not always at module-load time on edge.
  const apiKey = process.env['POLAR_API_KEY'] ?? '';
  if (!apiKey) throw new Error('POLAR_API_KEY env var is empty at request time');
  // Cloudflare Workers fetch rejects `cache: 'no-store'` ("The 'cache'
  // field on 'RequestInitializerDict' is not implemented."). Use
  // Next.js's `next.revalidate: 0` instead — handled by the Next caching
  // layer and not passed through to the underlying CF fetch.
  const r = await fetch(`https://api.polar.sh${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 0 },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Polar GET ${path} → HTTP ${r.status}: ${body.slice(0, 120)}`);
  }
  return (await r.json()) as T;
}

type PolarSubLite = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  created_at?: string;
  recurring_interval?: string;
  product_id?: string;
  amount?: number;
};

async function getActiveSubscription(externalId: string): Promise<ActiveSubscription | null> {
  type CustomersResp = { items: Array<{ id: string }> };
  type SubsResp = { items: PolarSubLite[] };
  const customers = await polarGet<CustomersResp>(
    `/v1/customers/?external_id=${encodeURIComponent(externalId)}&limit=1`,
  );
  const customerId = customers.items?.[0]?.id;
  if (!customerId) return null;
  // Ask for several, not one. A customer is only ever meant to hold a single
  // active subscription — /upgrade refuses anyone already on Pro, which is what
  // stops a monthly subscriber buying annual on top of what they have — but a
  // raw Polar checkout link reached from an old email bypasses that. With
  // limit=1 a second subscription would make cancel act on whichever of the two
  // Polar happened to return first, so someone could press Cancel, see it
  // succeed, and still be charged by the other one.
  const subs = await polarGet<SubsResp>(
    `/v1/subscriptions/?customer_id=${customerId}&active=true&limit=10`,
  );
  const items = subs.items ?? [];
  if (items.length === 0) return null;
  if (items.length > 1) {
    // Not fatal, and deliberately not auto-resolved: cancelling the wrong one
    // costs a customer money either way, so this surfaces for a human while the
    // action below still operates on a deterministic choice rather than on
    // whatever order Polar replied in.
    await logServerError({
      source: 'settings.subscription',
      message: `Customer holds ${items.length} active subscriptions; acting on the newest`,
      route: '/settings',
      context: { subscription_ids: items.map((i) => i.id) },
    });
  }
  // Newest wins — if someone did double-subscribe, the later one is the plan
  // they actually meant to be on.
  const sub = items.reduce((newest, candidate) =>
    (candidate.created_at ?? '') > (newest.created_at ?? '') ? candidate : newest,
  );
  return {
    id: sub.id,
    canceling: sub.cancel_at_period_end === true,
    // Empty string rather than a guess when Polar omits the field — the annual
    // offer and the switch both require an explicit 'month', so a missing
    // interval hides the offer and refuses the switch instead of charging.
    recurringInterval: sub.recurring_interval ?? '',
    productId: sub.product_id ?? '',
    amount: sub.amount ?? 0,
  };
}

async function patchSubscription(
  subscriptionId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const apiKey = process.env['POLAR_API_KEY'] ?? '';
  if (!apiKey) throw new Error('POLAR_API_KEY env var is empty at request time');
  const r = await fetch(`https://api.polar.sh/v1/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    throw new Error(
      `Polar PATCH /v1/subscriptions/${subscriptionId} → HTTP ${r.status}: ${errBody.slice(0, 120)}`,
    );
  }
}

async function cancelSubscriptionAction(
  reason: string,
  comment: string,
): Promise<{ ok: boolean; error?: string }> {
  'use server';
  const user = await requireUser();
  try {
    const sub = await getActiveSubscription(user.id);
    if (!sub) {
      await logServerError({
        source: 'settings.cancel',
        message: 'No active subscription found for user during cancel',
        userId: user.id,
        route: '/settings',
        context: { reason },
      });
      return {
        ok: false,
        error:
          'No active subscription found on Polar for this account. Email hello@htmlradar.com and we can cancel manually.',
      };
    }
    if (!sub.canceling) {
      await patchSubscription(sub.id, { cancel_at_period_end: true });
    }
    try {
      const sb = createClient(
        process.env['SUPABASE_URL'] ?? '',
        process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      await sb.from('cancellation_feedback').insert({
        profile_id: user.id,
        subscription_id: sub.id,
        reason,
        comment: comment.trim() || null,
      });
    } catch {
      // Feedback insert failure shouldn't block the cancellation.
    }
    // The reason must reach the event stream too — the Polar webhook's
    // subscription.canceled carries no reason, so without this a churn
    // breakdown can't be built from analytics alone.
    await captureServerEvent({
      event: 'subscription.cancel_requested',
      distinctId: user.id,
      userId: user.id,
      properties: { reason, has_comment: !!comment.trim(), subscription_id: sub.id },
    });
    // Skip revalidatePath — it has known issues on edge runtime via
    // next-on-pages and can crash the post-action re-render. The client
    // calls router.refresh() instead.
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await logServerError({
      source: 'settings.cancel',
      message: msg,
      userId: user.id,
      route: '/settings',
      context: { reason, threw: true },
    });
    return { ok: false, error: msg };
  }
}

async function resumeSubscriptionAction(): Promise<{ ok: boolean; error?: string }> {
  'use server';
  const user = await requireUser();
  try {
    const sub = await getActiveSubscription(user.id);
    if (!sub) {
      await logServerError({
        source: 'settings.resume',
        message: 'No subscription found for user during resume',
        userId: user.id,
        route: '/settings',
      });
      return { ok: false, error: 'No subscription found to resume.' };
    }
    if (sub.canceling) {
      await patchSubscription(sub.id, { cancel_at_period_end: false });
    }
    await captureServerEvent({
      event: 'subscription.resume_requested',
      distinctId: user.id,
      userId: user.id,
      properties: { subscription_id: sub.id },
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await logServerError({
      source: 'settings.resume',
      message: msg,
      userId: user.id,
      route: '/settings',
      context: { threw: true },
    });
    return { ok: false, error: msg };
  }
}

// Charges money. Every guard here is deliberate:
//  - the subscription is re-read from Polar, never taken from page state;
//  - switchToAnnual() refuses anything that isn't a live monthly plan and
//    returns success without a PATCH when the plan is already annual, so a
//    double submit can't bill twice;
//  - the customer-facing error is fixed text, so a raw Polar message can never
//    reach the browser.
const SWITCH_FAILED_MESSAGE =
  'We could not switch your plan, and you have not been charged for the annual plan. Email hello@htmlradar.com and we will sort it out.';

async function switchToAnnualAction(): Promise<{ ok: boolean; error?: string }> {
  'use server';
  const user = await requireUser();
  try {
    const sub = await getActiveSubscription(user.id);
    await captureServerEvent({
      event: 'subscription.switch_requested',
      distinctId: user.id,
      userId: user.id,
      properties: {
        from_interval: sub?.recurringInterval ?? null,
        to_interval: 'year',
        subscription_id: sub?.id ?? null,
      },
    });
    const result = await switchToAnnual({
      sub,
      annualProductId: process.env['POLAR_PRODUCT_ID_ANNUAL'] ?? '',
      patch: patchSubscription,
    });
    if (!result.ok) {
      await logServerError({
        source: 'settings.switch_annual',
        message: `Refused monthly→annual switch: ${result.detail}`,
        userId: user.id,
        route: '/settings',
        context: { reason: result.reason, subscription_id: sub?.id ?? null },
      });
      return { ok: false, error: SWITCH_FAILED_MESSAGE };
    }
    // Only a real PATCH counts as a switch — the idempotent no-op must not
    // inflate the count of plans that actually moved.
    if (result.patched) {
      await captureServerEvent({
        event: 'subscription.switch_succeeded',
        distinctId: user.id,
        userId: user.id,
        properties: { from_interval: 'month', to_interval: 'year', subscription_id: sub!.id },
      });
    }
    // No revalidatePath — same edge-runtime reason as the cancel action. The
    // client calls router.refresh().
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await logServerError({
      source: 'settings.switch_annual',
      message: msg,
      userId: user.id,
      route: '/settings',
      context: { threw: true },
    });
    return { ok: false, error: SWITCH_FAILED_MESSAGE };
  }
}

type SearchParams = Promise<{ upgraded?: string; checkout_id?: string }>;

function ProSuccessBanner({ proUntil }: { proUntil: string | null }) {
  const untilStr = proUntil
    ? new Date(proUntil).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  return (
    <div className="mb-8 flex items-start gap-3 rounded-2xl border border-signal/40 bg-signal/5 p-5">
      <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-signal-dark" />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
          Pro active
        </p>
        <p className="mt-1 text-[14.5px] text-ink">
          You&apos;re on HTMLRadar Pro{untilStr ? ` through ${untilStr}` : ''}. Thanks for the
          support.
        </p>
      </div>
    </div>
  );
}

// A key is generated, hashed, and the hash is what is written. The plaintext
// exists only in this function's return value and in the browser tab that
// asked for it — there is deliberately no way to read it back afterwards.
//
// The insert goes through the cookie-scoped client, so the api_keys RLS
// policies (schema/034) are what bind the row to this user; the service role
// is not involved and cannot be talked into writing a key for someone else.
async function createApiKeyAction(
  label: string,
  scope: 'full' | 'read_only' = 'full',
): Promise<{
  ok: boolean;
  key?: string;
  error?: string;
}> {
  'use server';
  const user = await requireUser();
  const cleanLabel = label.trim().slice(0, 60) || 'API key';
  // 'full' and 'read_only' are the only two values the column may hold, and
  // this fails closed the same way authenticateApiKey does: anything that is
  // not exactly 'full' makes the weaker key. A typo must never quietly hand
  // out a key stronger than the one that was asked for.
  const cleanScope = scope === 'full' ? 'full' : 'read_only';
  const key = generateApiKey();

  // One insert, and it always names the scope. A retry that dropped the column
  // would answer "created" to somebody who asked for a read-only key and hand
  // them a full-access one, which is the failure worth being loud about: if
  // this write cannot be made as asked, it is not made at all.
  const { error } = await serverClient()
    .from('api_keys')
    .insert({
      user_id: user.id,
      key_hash: await hashApiKey(key),
      key_prefix: apiKeyPrefix(key),
      label: cleanLabel,
      scope: cleanScope,
    });
  if (error) {
    // The ten-live-keys cap is a trigger on api_keys (schema/034), because the
    // insert policy lets a signed-in session write key rows straight through
    // PostgREST — a check here alone would be one anyone could walk around.
    // So the limit arrives as an exception, and this turns it into a sentence.
    if (error.message.includes('api_key_daily_limit')) {
      return {
        ok: false,
        error: 'You have created 20 keys today. Try again tomorrow.',
      };
    }
    if (error.message.includes('api_key_limit')) {
      return {
        ok: false,
        error: 'You already have 10 active keys. Revoke one to create another.',
      };
    }
    await logServerError({
      source: 'settings.api_key_create',
      message: error.message,
      userId: user.id,
      route: '/settings',
    });
    return { ok: false, error: 'Could not create the key. Try again.' };
  }

  // Label only. A key or any part of one must never reach the event stream.
  await captureServerEvent({
    event: 'api_key.created',
    distinctId: user.id,
    userId: user.id,
    properties: { label: cleanLabel, scope: cleanScope },
  });
  return { ok: true, key };
}

async function revokeApiKeyAction(id: string): Promise<{ ok: boolean; error?: string }> {
  'use server';
  const user = await requireUser();
  // RLS scopes this to the caller's own keys, so an id belonging to somebody
  // else updates nothing rather than revoking their key.
  const { error } = await serverClient()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('revoked_at', null);
  if (error) {
    await logServerError({
      source: 'settings.api_key_revoke',
      message: error.message,
      userId: user.id,
      route: '/settings',
    });
    return { ok: false, error: 'Could not revoke the key. Try again.' };
  }
  await captureServerEvent({
    event: 'api_key.revoked',
    distinctId: user.id,
    userId: user.id,
    properties: { api_key_id: id },
  });
  return { ok: true };
}

async function signOut() {
  'use server';
  const supabase = serverClient();
  // Capture before signOut so we still have the user context.
  // Awaited — captureServerEvent never throws, and un-awaited fetches
  // get cancelled on the edge runtime (see auth/callback).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await captureServerEvent({
      event: 'user.signed_out',
      distinctId: user.id,
      userId: user.id,
    });
  }
  await supabase.auth.signOut();
  // Bust the router cache so back-button on /sign-in or / doesn't
  // flash the previous-user's authed pages before middleware re-checks.
  revalidatePath('/', 'layout');
  redirect('/');
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const isPostUpgrade = params.upgraded === '1';
  const user = await requireUser();
  const supabase = serverClient();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  const quota = await readQuota(supabase, user.id);
  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('id, label, key_prefix, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false });
  const keyRows = (apiKeys ?? []) as ApiKeyRow[];
  const connectorKeys = keyRows.filter((key) => key.label.startsWith(CONNECTOR_LABEL_PREFIX));

  const tier = profile?.tier === 'pro' ? 'pro' : 'free';
  let subState: ActiveSubscription | null = null;
  if (tier === 'pro') {
    try {
      subState = await getActiveSubscription(user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      await logServerError({
        source: 'settings.render',
        message: `getActiveSubscription failed: ${msg}`,
        userId: user.id,
        route: '/settings',
      });
      // Render Cancel link anyway; the real error surfaces on click.
    }
  }
  const offerAnnual = shouldOfferAnnualSwitch({
    tier,
    sub: subState,
    annualProductId: process.env['POLAR_PRODUCT_ID_ANNUAL'],
  });
  const accountCreated = new Date(profile?.created_at ?? user.created_at).toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    },
  );

  return (
    <div className="py-8">
      <SectionMark>Settings</SectionMark>
      <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[44px]">
        Your account.
      </h1>

      {isPostUpgrade && tier === 'pro' && (
        <div className="mt-8">
          <ProSuccessBanner proUntil={profile?.pro_until ?? null} />
        </div>
      )}
      {isPostUpgrade && tier === 'free' && (
        <div className="mt-8">
          <UpgradePending userId={user.id} proUntil={profile?.pro_until ?? null} />
        </div>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          <Row label="Email" value={profile?.email ?? user.email ?? '—'} />
          <Row
            label="Plan"
            value={
              tier === 'pro' ? (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-signal/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-signal-dark">
                    Pro
                  </span>
                  <span className="text-[13px] text-ink-soft">Unlimited tracked links</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-paper-3 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                    Free
                  </span>
                  <span className="text-[13px] text-ink-soft">
                    <span className="tabular-nums">{quota.used}</span> of {quota.cap} free links
                    used
                  </span>
                </span>
              )
            }
          />
          {tier === 'pro' ? (
            <Row
              label="Subscription"
              value={
                <SubscriptionControls
                  canceling={subState?.canceling ?? false}
                  proUntil={profile?.pro_until ?? null}
                  cancelAction={cancelSubscriptionAction}
                  resumeAction={resumeSubscriptionAction}
                />
              }
            />
          ) : null}
          {offerAnnual ? (
            <Row label="Billing" value={<AnnualSwitch switchAction={switchToAnnualAction} />} />
          ) : null}
          <Row label="Account created" value={accountCreated} />
        </dl>

        {tier === 'free' && (
          <Link
            href="/upgrade"
            className="group inline-flex items-center gap-2 self-start rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
          >
            Upgrade to Pro
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      <ApiKeys
        keys={keyRows.filter((key) => !key.label.startsWith(CONNECTOR_LABEL_PREFIX))}
        createAction={createApiKeyAction}
        revokeAction={revokeApiKeyAction}
      />

      <ConnectedApps keys={connectorKeys} revokeAction={revokeApiKeyAction} />

      <form action={signOut} className="mt-12 border-t border-line pt-8">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-md border border-line bg-paper px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.16em] text-graphite transition hover:border-alert hover:text-alert"
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
        <p className="mt-3 text-[12.5px] text-graphite">
          You'll be redirected to the public site. Past read sessions for your shares stay tracked.
        </p>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-8 gap-y-1 px-5 py-4 sm:grid-cols-[200px_1fr]">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">{label}</dt>
      <dd className="text-[14.5px] text-ink">{value}</dd>
    </div>
  );
}
