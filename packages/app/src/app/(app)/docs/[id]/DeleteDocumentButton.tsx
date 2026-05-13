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

  return (
    <form onSubmit={handle} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="document_id" value={documentId} />
      {armed && (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-alert">
          <AlertTriangle aria-hidden className="size-3.5" />
          Delete {shareLine}? Click again to confirm.
        </span>
      )}
      <button
        type="submit"
        disabled={isPending}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-60',
          armed
            ? 'border border-alert bg-alert text-paper hover:bg-alert/90'
            : 'border border-line bg-paper text-graphite hover:border-alert hover:text-alert',
        )}
      >
        {isPending ? 'Deleting…' : armed ? 'Confirm delete' : 'Delete document'}
      </button>
    </form>
  );
}
