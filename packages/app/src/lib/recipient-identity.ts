// Recipient identity resolution for list views (left rail, viewer
// table, global /dashboard). One source of truth so the three views
// can't drift.
//
// Rule, simple version: the sender's `recipient_label` ALWAYS wins
// as the primary identifier when it exists. That's what the sender
// chose; the dashboard should respect their choice. The viewer
// emails go on the secondary line so the sender can still see who
// opened it.
//
// Why this is the right hierarchy:
//   - A label like "Investor list" or "Marc at Example Ventures" is a
//     deliberate group/person identifier. Demoting it under
//     "first-viewer-email +N" reads as the dashboard ignoring the
//     sender's own taxonomy, especially when the share went to a
//     group where no individual viewer is "more important".
//   - When the sender did NOT label the share, viewer emails (or
//     "Viewer N" fallbacks) take over the primary line.
//   - The viewer email information is never lost — it's either
//     primary (no label) or secondary (label present).
//
// Rules in priority order:
//
//   1. If a recipient_label exists, primary = label.
//      Secondary lines based on viewer count:
//        - 0 viewers: secondary = null ("not opened yet")
//        - 1 viewer with email: secondary = that email
//        - N viewers with email: secondary = "first@example.com +N-1"
//        - N viewers no email: secondary = "N viewers"
//      Exception: when label matches the only viewer's email
//      case-insensitively, drop secondary to avoid duplication.
//
//   2. If no label:
//        - 0 viewers: primary = "Unlabeled", secondary = null
//        - ≥1 viewer with email: primary = email or "first +N-1"
//        - ≥1 viewer no email: primary = "Viewer 1" or "Viewer 1 +N-1"

import type { Viewer } from './types';

export interface RecipientIdentity {
  primary: string;
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
  const sortedViewers = [...viewers].sort((a, b) =>
    (a.first_seen ?? '').localeCompare(b.first_seen ?? ''),
  );
  const withEmail = sortedViewers.filter((v) => !!v.email?.trim());
  const totalViewers = sortedViewers.length;

  // Label-driven path: sender's choice wins.
  if (label) {
    if (totalViewers === 0) {
      return { primary: label, secondary: null };
    }
    if (withEmail.length > 0) {
      const first = withEmail[0]!.email!;
      // If the label is just the same email, suppress the redundant
      // secondary line.
      if (label.toLowerCase() === first.toLowerCase()) {
        const extra = withEmail.length - 1;
        return {
          primary: extra > 0 ? `${first} +${extra}` : first,
          secondary: null,
        };
      }
      const extra = withEmail.length - 1;
      const secondary = extra > 0 ? `${first} +${extra}` : first;
      return { primary: label, secondary };
    }
    // Viewers exist but none with email yet — show count.
    return {
      primary: label,
      secondary: totalViewers === 1 ? '1 viewer' : `${totalViewers} viewers`,
    };
  }

  // No label — fall back to viewer info as primary.
  if (withEmail.length > 0) {
    const first = withEmail[0]!.email!;
    const extra = withEmail.length - 1;
    return {
      primary: extra > 0 ? `${first} +${extra}` : first,
      secondary: null,
    };
  }
  if (totalViewers > 0) {
    return {
      primary: totalViewers === 1 ? 'Viewer 1' : `Viewer 1 +${totalViewers - 1}`,
      secondary: null,
    };
  }
  return { primary: 'Unlabeled', secondary: null };
}
