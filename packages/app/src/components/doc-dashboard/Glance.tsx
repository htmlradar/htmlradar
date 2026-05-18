// "At a glance" stat grid for /docs/[id]. One dark feature card + three
// paper cards. Replaces the prior 5-card paper-only stat strip on
// ViewerInsights. Per a designer's reference design.
//
// Pure presentation — every metric value is computed by the caller and
// passed in. Sparkline points are precomputed too (12 buckets, 24h).
//
// Critical: the feature value is "total active read time" — the SUM of
// per-viewer section dwell across visible viewers. This is the honest
// "engaged with content" total. NEVER source from session.active_time,
// which inflates on idle-but-foregrounded mobile tabs (audit F-7,
// idle-foreground-tab incident, post-mortem 2026-05-17).

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { PulsingDot } from './PulsingDot';
import { Sparkline } from './Sparkline';

interface FeatureCardProps {
  label: string;
  value: string;
  unit?: string;
  liveReaders?: number;
  sparkline?: number[];
}

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  delta?: ReactNode;
}

export function FeatureStatCard({
  label,
  value,
  unit,
  liveReaders = 0,
  sparkline,
}: FeatureCardProps) {
  return (
    <div className="relative flex min-h-[180px] flex-col justify-between rounded-2xl border border-ink bg-ink p-6 text-paper">
      {liveReaders > 0 && (
        <span className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-pop px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-pop-ink">
          <PulsingDot tone="good" />
          {liveReaders} reading
        </span>
      )}
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper/55">
        {label}
      </div>
      <div className="mt-3">
        <div className="font-serif text-[56px] font-normal leading-none tracking-tightest text-paper md:text-[64px]">
          {value}
          {unit && <span className="ml-1.5 text-[24px] text-paper/60">{unit}</span>}
        </div>
        {sparkline && sparkline.length > 0 && (
          <div className="mt-3 opacity-90">
            <Sparkline points={sparkline} />
          </div>
        )}
      </div>
    </div>
  );
}

export function StatCard({ label, value, unit, delta }: StatCardProps) {
  return (
    <div className="flex min-h-[180px] flex-col justify-between rounded-2xl border border-line bg-paper p-6">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-graphite">
        {label}
      </div>
      <div className="mt-3">
        <div className="font-serif text-[48px] font-normal leading-none tracking-tightest text-ink md:text-[56px]">
          {value}
          {unit && <span className="ml-1.5 text-[20px] text-graphite">{unit}</span>}
        </div>
        {delta && (
          <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-graphite">
            {delta}
          </div>
        )}
      </div>
    </div>
  );
}

interface GlanceGridProps {
  feature: FeatureCardProps;
  cards: StatCardProps[];
  className?: string;
}

export function GlanceGrid({ feature, cards, className }: GlanceGridProps) {
  return (
    <div
      className={cn(
        // 4-col on desktop with the feature card slightly wider; collapses
        // to 2-col on tablet (feature spans both), single col on mobile.
        'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]',
        className,
      )}
    >
      <div className="sm:col-span-2 lg:col-span-1">
        <FeatureStatCard {...feature} />
      </div>
      {cards.map((c) => (
        <StatCard key={c.label} {...c} />
      ))}
    </div>
  );
}

// Helper — bucket session start times into N evenly-spaced buckets
// over the past `hoursBack` hours. Returns counts per bucket, oldest
// first. Pure function; safe to call in a Server Component.
export function sparklineFromSessionStarts(
  startedAt: Array<string | Date>,
  bucketCount = 12,
  hoursBack = 24,
): number[] {
  const now = Date.now();
  const windowMs = hoursBack * 60 * 60 * 1000;
  const bucketMs = windowMs / bucketCount;
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const ts of startedAt) {
    const t = typeof ts === 'string' ? new Date(ts).getTime() : ts.getTime();
    const age = now - t;
    if (age < 0 || age >= windowMs) continue;
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, bucketCount - 1 - Math.floor(age / bucketMs)),
    );
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return buckets;
}
