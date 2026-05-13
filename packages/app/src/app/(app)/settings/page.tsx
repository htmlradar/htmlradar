// /settings — Profile + plan + sign out. v4 register.
//
// Sign-out also revalidates the layout cache so back-button doesn't
// briefly show the previous user's documents (Next App Router router
// cache pre-deletion bug). See UX audit Critical #7.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { SectionMark } from '@/components/SectionMark';
import { ArrowRight, LogOut } from 'lucide-react';
import Link from 'next/link';

export const runtime = 'edge';

async function signOut() {
  'use server';
  const supabase = serverClient();
  await supabase.auth.signOut();
  // Bust the router cache so back-button on /sign-in or / doesn't
  // flash the previous-user's authed pages before middleware re-checks.
  revalidatePath('/', 'layout');
  redirect('/');
}

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = serverClient();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

  const tier = profile?.tier === 'pro' ? 'pro' : 'free';
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
                  <span className="text-[13px] text-ink-soft">Unlimited documents</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-paper-3 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                    Free
                  </span>
                  <span className="text-[13px] text-ink-soft">10 documents lifetime</span>
                </span>
              )
            }
          />
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
