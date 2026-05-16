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
    startTransition(async () => {
      const fd = new FormData();
      fd.set('document_id', documentId);
      const res = await action(fd);
      if (res.ok) {
        // Hard navigation. Browser GETs the proxy URL directly,
        // bypassing the Next.js router.
        window.location.href = res.url;
      } else {
        // Surface the action's error via the same URL-param channel the
        // page already renders into a banner.
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
