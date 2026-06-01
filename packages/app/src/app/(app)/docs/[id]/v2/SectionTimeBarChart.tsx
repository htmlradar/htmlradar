// Aggregated "Where readers spend time" bar chart for the Analytics tab.
//
// Pure presentational — takes pre-aggregated section rows and renders
// the maroon-bar visualisation from a designer's mockup
// (document-page-redesign.html .sectime block). Sorted by the section's
// minimum ordinal so the narrative reads top→bottom the way the deck
// was written, not by who-spent-most-time-where (matches the existing
// per-share logic in page.tsx).

import { cn } from '@/lib/cn';

export interface SectionTotal {
  id: string;
  title: string;
  totalSeconds: number;
  ordinal: number | null;
}

interface SectionTimeBarChartProps {
  sections: SectionTotal[];
}

export function SectionTimeBarChart({ sections }: SectionTimeBarChartProps) {
  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-paper/40 px-8 py-10 text-center">
        <p className="font-serif text-[20px] font-normal leading-tight tracking-tight text-ink">
          No section data yet.
        </p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-ink-soft">
          The tracker captures section dwell automatically — bars appear here once recipients start
          reading.
        </p>
      </div>
    );
  }
  const max = Math.max(...sections.map((s) => s.totalSeconds), 1);
  return (
    <div className="rounded-2xl border border-line bg-paper p-6">
      <h3 className="font-serif text-[18px] font-semibold leading-tight tracking-tight text-ink">
        Where readers spend time
      </h3>
      <p className="mt-1 max-w-[64ch] text-[12.5px] leading-relaxed text-ink-soft">
        Total active reading time across every viewer, section by section. Bars are scaled to the
        longest-held section.
      </p>
      <div className="mt-5 space-y-3">
        {sections.map((s) => (
          <div key={s.id} className="grid items-center gap-3 sm:grid-cols-[180px_1fr_80px]">
            <div className="truncate font-sans text-[13.5px] font-medium text-ink">{s.title}</div>
            <div className="h-3.5 overflow-hidden rounded-full border border-line bg-paper-2/60">
              <div
                aria-hidden
                className={cn('h-full rounded-full bg-signal')}
                style={{ width: `${Math.max((s.totalSeconds / max) * 100, 3)}%` }}
              />
            </div>
            <div className="text-right font-serif text-[16px] tabular-nums text-ink">
              {formatDuration(s.totalSeconds)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem ? `${m}m ${String(rem).padStart(2, '0')}s` : `${m}m`;
}
