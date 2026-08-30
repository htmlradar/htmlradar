'use client';

// ShareStack — mock for §04 claim 01 (each recipient gets a unique link).
// Three share cards stacked with a 14px Y-offset. On hover, they fan out
// to 56px spacing so the per-recipient nature reads at a glance. Pure
// React state + CSS transitions, no animation library.

import { useState } from 'react';
import { cn } from '@/lib/cn';

interface ShareCard {
  initial: string;
  name: string;
  org: string;
  slug: string;
  status: 'live' | 'opened' | 'pending';
}

const SHARES: ShareCard[] = [
  {
    initial: 'M',
    name: 'Marc',
    org: 'Example Ventures',
    slug: 'swift-falcon-a3f2',
    status: 'opened',
  },
  {
    initial: 'S',
    name: 'Sarah',
    org: 'Example Partners',
    slug: 'cobalt-ember-9b21',
    status: 'live',
  },
  {
    initial: 'T',
    name: 'Tom',
    org: 'Example Capital',
    slug: 'iris-meadow-1e74',
    status: 'pending',
  },
];

export function ShareStack() {
  const [hovered, setHovered] = useState(false);
  const baseSpacing = 14;
  const fannedSpacing = 56;
  const spacing = hovered ? fannedSpacing : baseSpacing;

  return (
    <div
      className="group relative h-[210px] w-full select-none md:h-[230px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {SHARES.map((s, i) => (
        <div
          key={s.slug}
          className={cn(
            'absolute left-0 right-0 rounded-xl border border-line bg-paper px-4 py-3',
            'shadow-[0_18px_30px_-24px_rgba(31,17,8,0.22)]',
            'transition-[top,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
          )}
          style={{
            top: `${i * spacing}px`,
            zIndex: 30 - i,
            opacity: 1 - i * 0.08,
          }}
        >
          <ShareRow share={s} />
        </div>
      ))}
    </div>
  );
}

function ShareRow({ share }: { share: ShareCard }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-3 font-mono text-[12px] font-medium text-ink-soft">
        {share.initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {share.name} · {share.org}
          </span>
          <StatusPip status={share.status} />
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-graphite">/r/{share.slug}</div>
      </div>
    </div>
  );
}

function StatusPip({ status }: { status: ShareCard['status'] }) {
  const label = status === 'opened' ? 'Opened' : status === 'live' ? 'Live' : 'Pending';
  const dot =
    status === 'opened' ? 'bg-signal' : status === 'live' ? 'bg-signal-soft' : 'bg-paper-3';
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}
