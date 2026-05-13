// New document — the upload + URL-paste entry point. v4.1 styling.
// Server Component renders the editorial chrome (SectionMark + serif
// heading); the interactive form lives in NewDocumentForm.tsx so we can
// keep the toggle state client-side without making the whole page a
// client component.

import { SectionMark } from '@/components/SectionMark';
import { createDocument } from './actions';
import { NewDocumentForm } from './NewDocumentForm';

export const runtime = 'edge';

export default function NewDocumentPage() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <SectionMark>New document</SectionMark>
      <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[48px]">
        Upload an HTML file, <span className="italic text-signal">or paste a URL.</span>
      </h1>
      <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
        Give it a title, drop the file (or point at a URL you already host), and you'll land on the
        document page to create your first per-recipient share.
      </p>

      <div className="mt-10">
        <NewDocumentForm action={createDocument} />
      </div>
    </div>
  );
}
