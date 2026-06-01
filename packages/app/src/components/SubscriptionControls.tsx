'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, X } from 'lucide-react';

const REASONS = [
  { value: 'too_expensive', label: 'Too expensive for what I get' },
  { value: 'low_volume', label: "I don't send enough docs to justify it" },
  { value: 'missing_feature', label: 'Missing a feature I need' },
  { value: 'switched', label: 'Switched to another tool' },
];

type CancelResult = { ok: boolean; error?: string };

export function SubscriptionControls({
  canceling,
  proUntil,
  cancelAction,
  resumeAction,
}: {
  canceling: boolean;
  proUntil: string | null;
  cancelAction: (reason: string, comment: string) => Promise<CancelResult>;
  resumeAction: () => Promise<CancelResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const untilStr = proUntil
    ? new Date(proUntil).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  if (canceling) {
    return (
      <div className="flex flex-col items-start gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          Canceling{untilStr ? ` on ${untilStr}` : ''}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await resumeAction();
              if (!r.ok) {
                setError(r.error ?? 'Could not resume — try again.');
                return;
              }
              router.refresh();
            });
          }}
          className="text-[13.5px] text-signal-dark underline decoration-line decoration-2 underline-offset-2 hover:decoration-signal disabled:opacity-60"
        >
          {isPending ? 'Resuming…' : 'Resume subscription'}
        </button>
        {error ? <p className="text-[12px] text-alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason('');
          setComment('');
          setError(null);
          setOpen(true);
        }}
        className="text-[13.5px] text-graphite underline decoration-line decoration-2 underline-offset-2 hover:text-alert hover:decoration-alert"
      >
        Cancel subscription
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-paper p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h2 className="font-serif text-[22px] leading-tight tracking-tightest text-ink">
                Cancel Pro?
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
              {untilStr
                ? `You'll keep Pro through ${untilStr}. After that you drop back to the free tier (10-document lifetime cap).`
                : "You'll keep Pro through the rest of this billing period, then drop back to the free tier."}
            </p>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Quick — why?
            </p>
            <fieldset className="mt-3 space-y-2" disabled={isPending}>
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-start gap-3 rounded-lg border border-line bg-paper-3 px-4 py-2.5 has-[:checked]:border-signal has-[:checked]:bg-signal/5"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 size-3.5 accent-signal-dark"
                  />
                  <span className="text-[14px] text-ink">{r.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="mt-4 block">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                Anything else? (optional)
              </span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isPending}
                rows={3}
                placeholder={
                  reason === 'missing_feature'
                    ? 'Which feature?'
                    : reason === 'switched'
                      ? 'Which tool?'
                      : ''
                }
                className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-graphite focus:border-signal focus:outline-none"
              />
            </label>
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
                  if (!reason) {
                    setError('Pick one so we know what to fix.');
                    return;
                  }
                  setError(null);
                  startTransition(async () => {
                    const r = await cancelAction(reason, comment);
                    if (!r.ok) {
                      setError(r.error ?? 'Cancel failed. Try again or email hello@htmlradar.com.');
                      return;
                    }
                    setOpen(false);
                    router.refresh();
                  });
                }}
                disabled={isPending}
                className="rounded-md bg-alert px-5 py-2 text-[14px] font-medium text-paper hover:bg-alert/90 disabled:opacity-60"
              >
                {isPending ? 'Canceling…' : 'Cancel subscription'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
