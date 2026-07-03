import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { captureServerEvent } from '@/lib/events';
import { logServerError } from '@/lib/error-log';
import { readQuota } from '@/lib/quota';
import { SectionMark } from '@/components/SectionMark';
import { UpgradePending } from '@/components/UpgradePending';
import { SubscriptionControls } from '@/components/SubscriptionControls';
import { ArrowRight, CheckCircle2, LogOut } from 'lucide-react';
import Link from 'next/link';

export const runtime = 'edge';

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

type PolarSubLite = { id: string; status: string; cancel_at_period_end: boolean };

async function getActiveSubscription(
  externalId: string,
): Promise<{ id: string; canceling: boolean } | null> {
  type CustomersResp = { items: Array<{ id: string }> };
  type SubsResp = { items: PolarSubLite[] };
  const customers = await polarGet<CustomersResp>(
    `/v1/customers/?external_id=${encodeURIComponent(externalId)}&limit=1`,
  );
  const customerId = customers.items?.[0]?.id;
  if (!customerId) return null;
  const subs = await polarGet<SubsResp>(
    `/v1/subscriptions/?customer_id=${customerId}&active=true&limit=1`,
  );
  const sub = subs.items?.[0];
  if (!sub) return null;
  return { id: sub.id, canceling: sub.cancel_at_period_end === true };
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

  const tier = profile?.tier === 'pro' ? 'pro' : 'free';
  let subState: { id: string; canceling: boolean } | null = null;
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
