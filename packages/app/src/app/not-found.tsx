// Custom 404. Quiet editorial register: a single declarative line, a
// faded radar in the background for visual continuity, and one route
// back home. No "Oops!" emoji-driven 404. No flashy 404 SVG.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { HeroRadar } from '@/components/HeroRadar';
import { SectionMark } from '@/components/SectionMark';
import { ArrowLeft } from 'lucide-react';

export const runtime = 'edge';

export const metadata = {
  title: 'Not found',
};

export default function NotFound() {
  return (
    <>
      <NavBar />
      <main className="relative flex min-h-[70vh] items-center overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-80px] top-1/2 -translate-y-1/2 opacity-35"
        >
          <HeroRadar size={420} />
        </div>

        <div className="relative mx-auto w-full max-w-3xl px-6">
          <SectionMark>404</SectionMark>
          <h1 className="text-letterpress mt-8 max-w-[18ch] font-serif text-[44px] font-normal leading-[1.04] tracking-tightest text-ink md:text-[64px]">
            This link didn't{' '}
            <span className="italic text-signal" style={{ fontVariationSettings: '"opsz" 144' }}>
              resolve.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-soft">
            The URL doesn't match any document on this account. If you got here from a tracked share
            link, the share may have been revoked or expired.
          </p>
          <div className="mt-10">
            <Link
              href="/"
              className="link-slide inline-flex items-center gap-2 text-[15px] text-ink-soft hover:text-signal-dark"
            >
              <ArrowLeft className="size-4" />
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
