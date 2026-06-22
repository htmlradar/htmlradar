'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase-browser';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

type State = 'pending' | 'success' | 'timeout' | 'signed_out';

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 60_000;

export function UpgradePending({ userId, proUntil }: { userId: string; proUntil: string | null }) {
  const [state, setState] = useState<State>('pending');
  const [resolvedProUntil, setResolvedProUntil] = useState<string | null>(proUntil);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const sb = browserClient();
    const startedAt = Date.now();

    async function check() {
      if (cancelled) return;
      // If the session is gone (user signed out in another tab), bail
      // immediately — RLS would otherwise return null silently and we'd
      // poll uselessly until the 60s timeout.
      const { data: authData } = await sb.auth.getUser();
      if (cancelled) return;
      if (!authData.user) {
        setState('signed_out');
        return;
      }
      const { data, error } = await sb
        .from('profiles')
        .select('tier, pro_until')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Network / RLS / transient — keep polling until timeout.
      } else if (data?.tier === 'pro') {
        setResolvedProUntil(data.pro_until);
        setState('success');
        router.refresh();
        return;
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setState('timeout');
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [userId, router]);

  if (state === 'success') {
    const untilStr = resolvedProUntil
      ? new Date(resolvedProUntil).toLocaleDateString(undefined, {
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

  if (state === 'signed_out') {
    return (
      <div className="mb-8 flex items-start gap-3 rounded-2xl border border-alert/40 bg-alert/5 p-5">
        <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-alert" />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-alert">Signed out</p>
          <p className="mt-1 text-[14.5px] text-ink">
            You&apos;re signed out, so we can&apos;t check your Pro status here. Sign back in
            &mdash; if your payment went through, Pro will be active when you return.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'timeout') {
    return (
      <div className="mb-8 flex items-start gap-3 rounded-2xl border border-alert/40 bg-alert/5 p-5">
        <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-alert" />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-alert">
            Activation taking longer than usual
          </p>
          <p className="mt-1 text-[14.5px] text-ink">
            If you completed payment, activation is taking longer than usual. Refresh this page in a
            minute, or email{' '}
            <a
              href="mailto:hello@htmlradar.com"
              className="text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal"
            >
              hello@htmlradar.com
            </a>{' '}
            with the email you paid from and we&apos;ll sort it manually.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex items-start gap-3 rounded-2xl border border-line bg-paper-3 p-5">
      <Loader2 aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-graphite" />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Payment received
        </p>
        <p className="mt-1 text-[14.5px] text-ink">
          Activating your Pro account. This usually takes 10&ndash;30 seconds &mdash; you can stay
          on this page.
        </p>
      </div>
    </div>
  );
}
