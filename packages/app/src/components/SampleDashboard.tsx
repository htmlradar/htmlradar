// SampleDashboard — placeholder shown on /dashboard and /dashboard/[slug]
// when the user has no real sessions yet. Wraps the marketing-page
// DashboardMock in a clearly-labeled "sample data" frame so visitors
// don't mistake the fake numbers for their own. The frame uses a
// dashed oxblood border + a header bar with an uppercase mono label,
// so the placeholder is unambiguous at a glance.
//
// When the user has even one real session, the parent page renders the
// real dashboard instead — this component disappears entirely.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DashboardMock } from '@/components/mocks/DashboardMock';

interface SampleDashboardProps {
  /** Action shown in the header bar; defaults to "Upload your first doc". */
  ctaLabel?: string;
  ctaHref?: string;
  /** Headline below the frame's header bar — context-specific. */
  headline?: string;
  /** Sub-headline / explanation. */
  subhead?: string;
}

export function SampleDashboard({
  ctaLabel = 'Upload your first document',
  ctaHref = '/new',
  headline = 'Your reads will land here.',
  subhead = 'Create your first share. The dashboard fills in real time as recipients open the link and dwell on sections.',
}: SampleDashboardProps) {
  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-letterpress max-w-2xl font-serif text-[32px] font-normal leading-[1.08] tracking-tightest text-ink md:text-[40px]">
          {headline}
        </h2>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-soft">{subhead}</p>
      </header>

      <div className="overflow-hidden rounded-2xl border-2 border-dashed border-signal/35 bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-signal/30 bg-signal/[0.04] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
              <span aria-hidden className="size-1.5 rounded-full bg-signal" />
              Sample data
            </span>
            <span className="text-[12.5px] text-ink-soft">
              Your real dashboard replaces this after the first read.
            </span>
          </div>
          <Link
            href={ctaHref}
            className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-signal-dark transition hover:text-signal"
          >
            {ctaLabel}
            <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="p-4 md:p-6">
          <div className="relative">
            <DashboardMock />
            {/* Faint diagonal "SAMPLE" wash across the mock — reinforces
                that the data is illustrative, without obscuring detail. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-2xl"
            >
              <div className="absolute -left-1/4 top-1/2 w-[150%] -translate-y-1/2 -rotate-12 text-center font-serif text-[110px] font-medium uppercase tracking-[0.04em] text-signal/[0.045] md:text-[140px]">
                Sample
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
