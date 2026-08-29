'use client';

// Monthly → annual switch. Two steps on purpose: the first click only opens
// the confirmation, the second one charges. Same modal pattern as the cancel
// flow in components/SubscriptionControls.tsx.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, X } from 'lucide-react';

type SwitchResult = { ok: boolean; error?: string };

export function AnnualSwitch({ switchAction }: { switchAction: () => Promise<SwitchResult> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        <span className="font-medium text-ink">On monthly.</span> Switch to annual and pay $150 a
        year instead of $180 — two months free. You will be charged today, with credit for the rest
        of this month. Your plan then renews once a year.
      </p>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="text-[13.5px] text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal"
      >
        Switch to annual
      </button>
      {!open && error ? (
        <p className="inline-flex items-start gap-2 text-[12.5px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="font-serif text-[22px] leading-tight tracking-tightest text-ink">
                Switch to annual?
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded p-1 text-graphite hover:text-ink disabled:opacity-50"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
              Your card is charged <span className="font-medium text-ink">today</span>, right now —
              $150 for the year, less credit for the days you have already paid for this month. The
              charge is not refundable. After that your plan renews once a year instead of once a
              month.
            </p>
            {error ? (
              <p className="mt-3 inline-flex items-start gap-2 text-[12.5px] text-alert">
                <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-md px-4 py-2 font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-ink disabled:opacity-50"
              >
                Nevermind
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const r = await switchAction();
                    if (!r.ok) {
                      setError(
                        r.error ??
                          'The switch did not go through and you were not charged for the annual plan. Email hello@htmlradar.com and we will sort it out.',
                      );
                      return;
                    }
                    setOpen(false);
                    router.refresh();
                  });
                }}
                disabled={isPending}
                className="rounded-md bg-signal px-5 py-2 text-[14px] font-medium text-paper hover:bg-signal-dark disabled:opacity-60"
              >
                {isPending ? 'Switching…' : 'Charge me and switch'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
