'use client';

// API keys section on /settings. Create a key, see it once, revoke it later.
//
// The key is returned by the server action and held in component state only.
// It is never re-fetched, because after the INSERT nothing anywhere can
// produce it again — the database has a SHA-256 hash and nothing else. Hence
// the copy button and the warning: this is the one moment it exists.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Copy, KeyRound } from 'lucide-react';
import { formatTimestamp } from '@/lib/format-timestamp';

export interface ApiKeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

type CreateResult = { ok: boolean; key?: string; error?: string };
type RevokeResult = { ok: boolean; error?: string };

export function ApiKeys({
  keys,
  createAction,
  revokeAction,
}: {
  keys: ApiKeyRow[];
  createAction: (label: string) => Promise<CreateResult>;
  revokeAction: (id: string) => Promise<RevokeResult>;
}) {
  const [label, setLabel] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const copy = async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
    } catch {
      // clipboard is unavailable outside a secure context; the key is on
      // screen and selectable, so this is not worth a fallback hack.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="font-serif text-[24px] leading-tight tracking-tightest text-ink">API keys</h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft">
        A key lets a script — or an AI assistant through the HTMLRadar MCP server — turn an HTML
        file into a tracked link on your account. Keys carry the same limits your account has.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor="api-key-label" className="sr-only">
          Key name
        </label>
        <input
          id="api-key-label"
          type="text"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is it for? e.g. Claude Desktop"
          className="w-full max-w-xs rounded-md border border-line bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-graphite focus:border-signal focus:outline-none sm:w-auto"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setFreshKey(null);
            startTransition(async () => {
              const r = await createAction(label);
              if (!r.ok || !r.key) {
                setError(r.error ?? 'Could not create the key. Try again.');
                return;
              }
              setFreshKey(r.key);
              setLabel('');
              router.refresh();
            });
          }}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-[14px] font-medium text-paper transition hover:bg-signal-dark disabled:opacity-60"
        >
          <KeyRound aria-hidden className="size-3.5" />
          {isPending ? 'Working…' : 'Create key'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 inline-flex items-start gap-2 text-[12.5px] text-alert">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {freshKey ? (
        <div className="mt-5 rounded-2xl border border-signal/40 bg-signal/5 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
            Copy this now
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink">
            This is the only time the key is shown. We store a one-way hash of it, so if you lose it
            there is nothing to look up — create a new one and revoke this.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink">
              {freshKey}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:border-signal hover:text-signal-dark"
            >
              {copied ? (
                <>
                  <Check aria-hidden className="size-3 text-signal" />
                  Copied
                </>
              ) : (
                <>
                  <Copy aria-hidden className="size-3" />
                  Copy key
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="mt-5 text-[13.5px] text-graphite">No keys yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {keys.map((k) => {
            const lastUsed = formatTimestamp(k.last_used_at, 'recent');
            return (
              <li
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="text-[14.5px] text-ink">
                    {k.label}
                    {k.revoked_at ? (
                      <span className="ml-2 rounded-full bg-paper-3 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                        Revoked
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 font-mono text-[11.5px] text-graphite">
                    {k.key_prefix}… · created{' '}
                    {new Date(k.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · last used <span title={lastUsed.full}>{lastUsed.display}</span>
                  </p>
                </div>
                {k.revoked_at ? null : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const r = await revokeAction(k.id);
                        if (!r.ok) {
                          setError(r.error ?? 'Could not revoke the key. Try again.');
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
