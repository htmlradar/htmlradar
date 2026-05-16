'use client';

// "Replace HTML" — sender uploads a fresh version of the deck under the
// SAME document. All existing share slugs auto-serve the new version on
// the next open (no per-share migration needed).
//
// Why client: we want a single-button UX where the file picker opens
// immediately on click, then auto-submits when a file is chosen — no
// extra "click to upload" step. Server Action receives the FormData.

import { useRef, useTransition } from 'react';
import { Upload } from 'lucide-react';

export function ReplaceDocumentButton({
  documentId,
  action,
}: {
  documentId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const onClick = () => fileInputRef.current?.click();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = formRef.current;
    if (!form) return;
    startTransition(() => {
      form.requestSubmit();
    });
  };

  return (
    <form ref={formRef} action={action} encType="multipart/form-data">
      <input type="hidden" name="document_id" value={documentId} />
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        accept=".html,text/html"
        className="hidden"
        onChange={onChange}
        disabled={isPending}
      />
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-paper px-3.5 py-2 text-[13px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark disabled:cursor-wait disabled:opacity-60"
        title="Upload a new HTML file. All existing share links keep working and serve the new version on the next open."
      >
        <Upload aria-hidden className="size-3.5" />
        {isPending ? 'Replacing…' : 'Replace HTML'}
      </button>
    </form>
  );
}
