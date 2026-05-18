// Small icon + label chip used inside the SharePane "gate" row.
// Replaces the prior `gateSummary()` single-sentence pattern with
// independent visual tokens — one per gate condition. Easier to scan
// at a glance ("oh, password + 3-domain allowlist, expires in 7d")
// than parsing a comma-separated sentence.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GateTagProps {
  icon?: ReactNode;
  // tone semantics:
  //   default — neutral graphite, used for the "blocking/restricting"
  //             gates (password, allowlist, expiry, download-blocked)
  //   off     — muted dashed border, used for "no gate" / "no expiry"
  //             so the absence reads as deliberate not missing
  //   alert   — alert-bordered, used for expired-and-still-here cases
  tone?: 'default' | 'off' | 'alert';
  children: ReactNode;
  className?: string;
}

export function GateTag({ icon, tone = 'default', children, className }: GateTagProps) {
  const base =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em]';
  const tones: Record<NonNullable<GateTagProps['tone']>, string> = {
    default: 'border border-line bg-paper-2/40 text-ink-soft',
    off: 'border border-dashed border-line bg-transparent text-graphite',
    alert: 'border border-alert/40 bg-alert/5 text-alert',
  };

  return (
    <span className={cn(base, tones[tone], className)}>
      {icon && (
        <span aria-hidden className="flex size-3 items-center justify-center">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
