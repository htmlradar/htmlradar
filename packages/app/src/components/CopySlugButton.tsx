'use client';

// Small clipboard-copy button for share URLs. Used in ShareAnalytics
// (the "Waiting for first read" panel) and could be reused anywhere we
// need to expose a share URL with a one-click copy.

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { captureClientEvent } from '@/lib/events-client';
import { shareUrl } from '@/lib/share-url';

export function CopySlugButton({ slug, hostHandle }: { slug: string; hostHandle: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const fullUrl = shareUrl(slug, hostHandle);
    void captureClientEvent('share.copied', { slug });
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // navigator.clipboard fails in non-secure contexts; fall back to
      // a hidden textarea trick.
      const el = document.createElement('textarea');
      el.value = fullUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite transition hover:border-signal hover:text-signal-dark"
    >
      {copied ? (
        <>
          <Check aria-hidden className="size-3 text-signal" />
          Copied
        </>
      ) : (
        <>
          <Copy aria-hidden className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}
