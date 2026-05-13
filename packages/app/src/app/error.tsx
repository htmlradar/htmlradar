'use client';

// Error boundary for uncaught render errors. Same editorial register as
// the 404 — calm, not panicked. Surfaces a "try again" action and a way
// home. The actual error text is only shown in development; in
// production we keep it generic so we don't leak stack traces.

import { useEffect } from 'react';
import Link from 'next/link';
import { HeroRadar } from '@/components/HeroRadar';
import { SectionMark } from '@/components/SectionMark';
import { ArrowLeft, RefreshCcw } from 'lucide-react';

export const runtime = 'edge';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('HTMLRadar error boundary:', error);
    }
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-80px] top-1/2 -translate-y-1/2 opacity-35"
      >
        <HeroRadar size={420} />
      </div>

      <div className="relative mx-auto w-full max-w-3xl px-6">
        <SectionMark>Something went sideways</SectionMark>
        <h1 className="text-letterpress mt-8 max-w-[20ch] font-serif text-[44px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[60px]">
          That page hit{' '}
          <span className="italic text-signal" style={{ fontVariationSettings: '"opsz" 144' }}>
            a snag.
          </span>
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-soft">
          The render failed before it could finish. Try once more — if it happens again, drop a line
          to{' '}
          <a
            href="mailto:hello@htmlradar.com"
            className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
          >
            hello@htmlradar.com
          </a>
          {error.digest ? (
            <>
              {' '}
              and include this id:{' '}
              <code className="font-mono text-[14px] text-graphite">{error.digest}</code>.
            </>
          ) : (
            '.'
          )}
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
          <button
            type="button"
            onClick={reset}
            className="group inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
          >
            <RefreshCcw className="size-4 transition group-hover:rotate-[-12deg]" />
            Try again
          </button>
          <Link
            href="/"
            className="link-slide inline-flex items-center gap-2 text-[14px] text-ink-soft hover:text-signal-dark"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
