// EmailNotificationMock — the email a sender gets when a recipient first
// opens a tracked link. Used in §03 alongside the dashboard mock to show
// the real-time loop, and as the first panel of the RecipientFlow in §05.
// Inbox-row styled (Gmail-like) but in the HTMLRadar warm-cream palette.

import { Radio } from 'lucide-react';

interface EmailNotificationMockProps {
  variant?: 'inbox' | 'card';
}

export function EmailNotificationMock({ variant = 'inbox' }: EmailNotificationMockProps) {
  const isCard = variant === 'card';

  return (
    <div
      className={`flex w-full items-start gap-3 rounded-xl border border-line bg-paper ${
        isCard ? 'p-4' : 'px-4 py-3'
      }`}
    >
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-signal/12 text-signal-dark">
        <Radio aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-signal-dark">
            HTMLRadar
          </span>
          <span className="shrink-0 font-mono text-[10px] text-graphite">4m ago</span>
        </div>
        <p className="mt-1 truncate text-[14px] font-medium text-ink">
          Marc just opened Seed Deck, Q2.
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-soft sm:truncate">
          Halbrook Capital · 2m 41s on §03 The Ask · still active
        </p>
        {isCard && (
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
              View analytics
            </span>
            <span className="font-mono text-[10px] text-signal-dark">→</span>
          </div>
        )}
      </div>
    </div>
  );
}
