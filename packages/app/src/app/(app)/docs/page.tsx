// /docs — Document library. Lists every non-deleted document the user
// owns. Empty state renders a clean "upload your first" card with the
// brand radar instead of the plain dashed border — keeps the v4
// register consistent.

import Link from 'next/link';
import { ArrowRight, FileText, Link2 } from 'lucide-react';
import { requireUser, serverClient } from '@/lib/supabase-server';
import { SectionMark } from '@/components/SectionMark';
import { HeroRadar } from '@/components/HeroRadar';

export const runtime = 'edge';

export default async function DocumentsPage() {
  await requireUser();
  const supabase = serverClient();

  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, source_type, current_version, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const hasDocs = (docs?.length ?? 0) > 0;

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionMark>Documents</SectionMark>
          <h1 className="text-letterpress mt-4 font-serif text-[36px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[44px]">
            Your library.
          </h1>
        </div>
        <Link
          href="/new"
          className="group inline-flex items-center gap-2 rounded-md bg-signal px-5 py-2.5 text-[14px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
        >
          New document
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>

      {!hasDocs ? (
        <EmptyDocs />
      ) : (
        <ul className="mt-10 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {docs!.map((d) => (
            <li key={d.id}>
              <Link
                href={`/docs/${d.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-paper-2/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-3 text-signal-dark">
                    {d.source_type === 'upload' ? (
                      <FileText aria-hidden className="size-4" />
                    ) : (
                      <Link2 aria-hidden className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif text-[18px] text-ink">{d.title}</div>
                    <div className="mt-1 font-mono text-[11px] text-graphite">
                      {d.source_type === 'upload' ? 'Uploaded' : 'URL source'} · v
                      {d.current_version} · {new Date(d.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-graphite transition group-hover:translate-x-0.5 group-hover:text-signal-dark"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyDocs() {
  return (
    <div className="relative mt-10 overflow-hidden rounded-2xl border border-dashed border-signal/30 bg-paper px-8 py-14 text-center md:px-12 md:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-60px] top-1/2 -translate-y-1/2 opacity-30"
      >
        <HeroRadar size={260} />
      </div>

      <div className="relative mx-auto max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-dark">
          Empty library
        </p>
        <h2 className="text-letterpress mt-4 font-serif text-[28px] leading-[1.1] tracking-tightest text-ink md:text-[34px]">
          Upload your first document.
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          A single HTML file or a URL you already host. Once uploaded, you create per-recipient
          share links and watch reads land in the dashboard.
        </p>
        <Link
          href="/new"
          className="group mt-8 inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
        >
          Upload an HTML file
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
