// New document — the upload + URL-paste entry point. v4.1 styling.
// Server Component renders the editorial chrome (SectionMark + serif
// heading); the interactive form lives in NewDocumentForm.tsx so we can
// keep the toggle state client-side without making the whole page a
// client component.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SectionMark } from '@/components/SectionMark';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { readQuota } from '@/lib/quota';
import { createDocument } from './actions';
import { NewDocumentForm } from './NewDocumentForm';

export const runtime = 'edge';

export default async function NewDocumentPage() {
  const user = await requireUser();
  const quota = await readQuota(serverClient(), user.id);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <SectionMark>New document</SectionMark>
      <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[48px]">
        Upload an HTML file, <span className="italic text-signal">or paste a URL.</span>
      </h1>
      <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
        HTMLRadar tracks reads, scroll, and per-section dwell on HTML. Drop the deck here. PDFs,
        Excel, and ZIPs ride along as downloadable files once the HTML is up.
      </p>

      {quota.tier === 'free' && <QuotaStrip quota={quota} />}

      <div className="mt-10">
        {quota.tier === 'free' && quota.atCap ? (
          // At the lifetime cap — don't show an interactive form that can only
          // dead-end in a /upgrade redirect on submit. The server action still
          // enforces the cap (authoritative guard); this just makes the UI
          // honest about it.
          <div className="rounded-2xl border border-line bg-paper p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
              Uploads paused
            </p>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              You&apos;ve used all {quota.cap} free uploads. Upgrade to Pro to keep adding documents
              — your existing documents and analytics stay exactly as they are.
            </p>
            <Link
              href="/upgrade?reason=quota"
              className="group mt-6 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Upgrade to Pro
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        ) : (
          <NewDocumentForm action={createDocument} />
        )}
      </div>
    </div>
  );
}

function QuotaStrip({ quota }: { quota: { used: number; cap: number; atCap: boolean } }) {
  const pct = Math.min(100, Math.round((quota.used / quota.cap) * 100));
  const tone = quota.atCap
    ? 'border-alert/40 bg-alert/5'
    : quota.used >= quota.cap - 2
      ? 'border-signal/40 bg-signal/5'
      : 'border-line bg-paper';
  const barTone = quota.atCap ? 'bg-alert' : 'bg-signal';

  return (
    <div className={`mt-8 rounded-2xl border ${tone} px-5 py-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-graphite">
            Lifetime quota · Free
          </p>
          <p className="mt-1.5 font-serif text-[17px] leading-none text-ink">
            <span className="tabular-nums">{quota.used}</span>{' '}
            <span className="text-graphite">of {quota.cap} uploads used</span>
          </p>
        </div>
        <Link
          href="/upgrade?reason=quota"
          className="link-slide text-[13px] text-signal-dark hover:text-signal"
        >
          {quota.atCap ? 'Upgrade to keep uploading →' : 'Upgrade for unlimited →'}
        </Link>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-3">
        <div
          className={`${barTone} h-full rounded-full transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {quota.atCap ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-alert">
          You're at the lifetime cap. Upgrading to Pro removes the cap and keeps your existing
          documents — nothing is lost.
        </p>
      ) : null}
    </div>
  );
}
