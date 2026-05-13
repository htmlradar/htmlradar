// VersionSwap — mock for §04 claim 02 (replace the HTML, keep the link).
// Two version chips with an arrow between, sitting above a stable slug.
// The visual point: the slug doesn't move, the underlying file does.

import { ArrowRight } from 'lucide-react';

export function VersionSwap() {
  return (
    <div className="relative flex h-[210px] w-full flex-col items-center justify-center gap-7 rounded-xl border border-line bg-paper px-6 py-8 md:h-[230px]">
      <div className="flex items-center gap-4">
        <VersionChip label="v1" state="prev" />
        <ArrowRight aria-hidden className="size-4 text-graphite" />
        <VersionChip label="v2" state="current" />
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
          Same share link
        </span>
        <span className="rounded-full border border-line bg-paper-2 px-3 py-1 font-mono text-[12px] text-signal-dark">
          /r/swift-falcon-a3f2
        </span>
      </div>
    </div>
  );
}

function VersionChip({ label, state }: { label: string; state: 'prev' | 'current' }) {
  if (state === 'prev') {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-line bg-paper-2 px-3 py-1.5 font-mono text-[12px] text-graphite line-through">
        deck-{label}.html
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-signal px-3 py-1.5 font-mono text-[12px] text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)]">
      <span aria-hidden className="size-1.5 rounded-full bg-paper" />
      deck-{label}.html
    </span>
  );
}
