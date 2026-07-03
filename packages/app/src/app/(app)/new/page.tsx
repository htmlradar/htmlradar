// New document — the upload + URL-paste entry point. v4.1 styling.
// Server Component renders the editorial chrome (SectionMark + serif
// heading); the interactive form lives in NewDocumentForm.tsx so we can
// keep the toggle state client-side without making the whole page a
// client component.
//
// Documents are no longer capped (pricing v4) — the free-tier lever is the
// tracked-link cap, surfaced at share creation. So there's no quota strip here;
// uploading is unrestricted.

import { SectionMark } from '@/components/SectionMark';
import { requireUser } from '@/lib/supabase-server';
import { createDocument } from './actions';
import { NewDocumentForm } from './NewDocumentForm';

export const runtime = 'edge';

type SearchParams = Promise<{ upload_error?: string }>;

export default async function NewDocumentPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const uploadError = (await searchParams).upload_error;

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

      {uploadError ? (
        <p className="mt-6 rounded-md border border-signal/30 bg-signal/5 px-4 py-3 text-[14px] leading-relaxed text-signal-dark">
          That upload didn&apos;t go through: {uploadError}
        </p>
      ) : null}

      <div className="mt-10">
        <NewDocumentForm action={createDocument} />
      </div>
    </div>
  );
}
