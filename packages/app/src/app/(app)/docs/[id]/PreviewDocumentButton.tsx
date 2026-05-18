'use client';

// Sender's "Preview document" button. Client-side because the action
// returns the proxy URL and we navigate with window.location.href —
// that's the only way to leave the Next.js app shell and actually hit
// the Worker route. Using a server action redirect would route the
// browser through Next.js's client router, which would treat /r/_doc/...
// as an unknown app route and 404.

import { useTransition } from 'react';
import { ExternalLink } from 'lucide-react';

export function PreviewDocumentButton({
  documentId,
  action,
}: {
  documentId: string;
  action: (formData: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    // Open the preview in a NEW tab so the dashboard tab stays put.
    // window.open must fire synchronously from the click handler —
    // popup blockers reject calls made from inside an async callback.
    // We open about:blank as a placeholder, then set its location once
    // the server action returns the signed proxy URL. If the action
    // errors, the placeholder tab is closed and the error surfaces on
    // the current page.
    const previewTab = window.open('about:blank', '_blank', 'noopener');
    startTransition(async () => {
      const fd = new FormData();
      fd.set('document_id', documentId);
      const res = await action(fd);
      if (res.ok) {
        if (previewTab && !previewTab.closed) {
          previewTab.location.href = res.url;
        } else {
          // Popup blocked or already closed — fall back to same-tab
          // navigation so the user still sees the preview.
          window.location.href = res.url;
        }
      } else {
        previewTab?.close();
        window.location.href = `/docs/${documentId}?preview_error=${encodeURIComponent(res.error)}`;
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-paper px-3.5 py-2 text-[13px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark disabled:cursor-wait disabled:opacity-60"
      title="Open the uploaded HTML as-is — no gate, no tracker."
    >
      <ExternalLink aria-hidden className="size-3.5" />
      {isPending ? 'Opening…' : 'Preview document'}
    </button>
  );
}
