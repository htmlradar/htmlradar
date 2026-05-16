'use client';

// Two-step inline confirmation before deleting a document. Single click
// arms the confirmation; second click within 8 seconds executes the
// server action. Resets state if the user moves away or waits too long.
// No modal — the inline state shift is faster + lower friction than a
// dialog for what's still a recoverable action (soft delete).

import { useEffect, useRef, useState, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DeleteDocumentButtonProps {
  documentId: string;
  documentTitle: string;
  shareCount: number;
  action: (formData: FormData) => Promise<void>;
}

export function DeleteDocumentButton({
  documentId,
  documentTitle,
  shareCount,
  action,
}: DeleteDocumentButtonProps) {
  const [armed, setArmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timeoutRef.current = setTimeout(() => setArmed(false), 8000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [armed]);

  const handle = (e: React.FormEvent<HTMLFormElement>) => {
    if (!armed) {
      e.preventDefault();
      setArmed(true);
      return;
    }
    const fd = new FormData(e.currentTarget);
    e.preventDefault();
    startTransition(() => action(fd));
  };

  const shareLine =
    shareCount === 0
      ? `"${documentTitle}"`
      : `"${documentTitle}" and its ${shareCount} ${shareCount === 1 ? 'share' : 'shares'}`;
  // Make the analytics consequence explicit — feedback during testing was
  // "I didn't realise deleting the doc would hide the analytics too."
  // Soft delete means the rows still exist in Postgres (recoverable by
  // support), but the per-share dashboards filter `documents.deleted_at`
  // and stop rendering once the doc is gone.
  const analyticsLine =
    shareCount === 0 ? '' : ' Analytics for past reads will stop being visible.';

  return (
    <form onSubmit={handle} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="document_id" value={documentId} />
      {armed && (
        <span className="inline-flex max-w-md items-start gap-1.5 text-[12px] leading-snug text-alert">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Delete {shareLine}?{analyticsLine} Click again to confirm.
          </span>
        </span>
      )}
      <button
        type="submit"
        disabled={isPending}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium shadow-[0_1px_0_rgba(31,17,8,0.04)] transition disabled:cursor-not-allowed disabled:opacity-60',
          armed
            ? 'border border-alert bg-alert text-paper hover:bg-alert/90'
            : 'border border-ink/15 bg-paper text-ink hover:border-alert hover:text-alert',
        )}
      >
        <AlertTriangle aria-hidden className="size-3.5" />
        {isPending ? 'Deleting…' : armed ? 'Confirm delete' : 'Delete'}
      </button>
    </form>
  );
}
