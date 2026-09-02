'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import type { ApiKeyRow } from './ApiKeys';

type RevokeResult = { ok: boolean; error?: string };

export function ConnectedApps({
  keys,
  revokeAction,
}: {
  keys: ApiKeyRow[];
  revokeAction: (id: string) => Promise<RevokeResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="font-serif text-[24px] leading-tight tracking-tightest text-ink">
        Connected apps
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft">
        Apps you allowed to use HTMLRadar through the remote connector. Revoking one stops its API
        key immediately.
      </p>

      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 text-[12.5px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {keys.length === 0 ? (
        <p className="mt-5 text-[13.5px] text-graphite">No connected apps.</p>
      ) : (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="break-words text-[14.5px] text-ink">
                  {key.label}
                  {key.revoked_at ? (
                    <span className="ml-2 rounded-full bg-paper-3 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                      Revoked
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-graphite">
                  Connected{' '}
                  {new Date(key.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              {key.revoked_at ? null : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await revokeAction(key.id);
                      if (!result.ok) {
                        setError(result.error ?? 'Could not revoke the connection. Try again.');
                        return;
                      }
                      router.refresh();
                    });
                  }}
                  className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite underline decoration-line decoration-2 underline-offset-4 transition hover:text-alert hover:decoration-alert disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
