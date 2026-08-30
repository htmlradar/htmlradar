// DirectAnswer — the 40–60 word answer that sits directly under an H1
// on every search-facing page, with a visible "Updated" date.
//
// Why: answer engines (ChatGPT search, Perplexity, Google AI Mode) lift
// their citation from the first third of a page and prefer a short,
// quotable answer next to a fresh date. This is the one block on each
// page written to be quoted verbatim.

import type { ReactNode } from 'react';

export function DirectAnswer({
  updated,
  children,
  label = 'Updated',
}: {
  updated: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="mt-6 max-w-2xl border-l-2 border-signal pl-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
        {label} {updated}
      </p>
      <p className="mt-2 text-[17px] leading-relaxed text-ink">{children}</p>
    </div>
  );
}
