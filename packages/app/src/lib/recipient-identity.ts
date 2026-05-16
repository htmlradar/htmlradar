// Recipient identity resolution for list views (AT A GLANCE, left rail,
// global /dashboard). One source of truth so the three views can't drift.
//
// Why this exists: `recipient_label` is the SENDER's free-form note for
// their own bookkeeping ("Alex", "Marc at Example Ventures", "Someone else").
// When the share is actually opened by a recipient, the dashboard should
// surface WHO opened it — typically the email they entered at the gate —
// not the label the sender wrote weeks earlier.
//
// Rules, in priority order:
//
//   1. If the share is email-gated AND ≥1 viewer entered an email, show
//      that email (or "first@x.com +N" when several entered).
//   2. If viewers exist but none have an email (no_email gate), show
//      "Viewer 1", "Viewer 2", … assigned by `first_seen` order. The
//      caller passes a stable index per share so the numbering matches
//      across renders.
//   3. If no viewers yet, fall back to the sender's `recipient_label`
//      (still useful — that's what the sender wrote it for).
//   4. Last resort: "Unlabeled".
//
// The label is preserved as a SECONDARY line when it exists and the
// primary line wound up being a viewer email or "Viewer N" — so the
// sender's own context isn't lost.

import type { Viewer } from './types';

export interface RecipientIdentity {
  // The primary line shown in the table / rail.
  primary: string;
  // Optional second line — the sender's own label, only when distinct
  // from `primary` (i.e. when `primary` is a viewer email or "Viewer N").
  // Null when the label *is* the primary.
  secondary: string | null;
}

export function resolveRecipientIdentity(
  share: {
    recipient_label: string | null;
    require_email: boolean;
  },
  viewers: Pick<Viewer, 'email' | 'first_seen'>[],
): RecipientIdentity {
  const label = share.recipient_label?.trim() || null;

  // Viewers sorted by first_seen so the "Viewer N" assignment is stable
  // across re-renders. The list comes from the server already filtered
  // to this share's id, but we don't assume sort order.
  const sortedViewers = [...viewers].sort((a, b) =>
    (a.first_seen ?? '').localeCompare(b.first_seen ?? ''),
  );
  const withEmail = sortedViewers.filter((v) => !!v.email?.trim());

  // Email-gated path: prefer the actual emails the recipients typed.
  if (share.require_email && withEmail.length > 0) {
    const first = withEmail[0]!.email!;
    const extra = withEmail.length - 1;
    const primary = extra > 0 ? `${first} +${extra}` : first;
    return {
      primary,
      secondary: label && label.toLowerCase() !== first.toLowerCase() ? label : null,
    };
  }

  // No-email gate (or email gate that nobody has filled yet) with at
  // least one anonymous viewer.
  if (sortedViewers.length > 0) {
    const primary =
      sortedViewers.length === 1 ? 'Viewer 1' : `Viewer 1 +${sortedViewers.length - 1}`;
    return {
      primary,
      secondary: label,
    };
  }

  // No viewers yet — fall through to whatever the sender labelled.
  return {
    primary: label ?? 'Unlabeled',
    secondary: null,
  };
}
