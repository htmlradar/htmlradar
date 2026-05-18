// Hybrid relative/absolute timestamp formatter used across the
// dashboard. Two modes drive the same underlying split:
//
//   'recent'  → always relative. "Last seen" semantics — recency IS
//               the answer, so relative reads better even at days/weeks
//               out ("23d ago" still tells you "this lead is cold").
//   'auto'    → relative under 24h, absolute date beyond. "First seen"
//               semantics — once the event is more than a day old,
//               you want the actual date, not "1d ago" stripping
//               precision (was it 25h or 47h?).
//
// Both modes ALWAYS return a `full` field with the complete locale-
// formatted timestamp so the caller can render it as a hover tooltip
// via the `title` attribute. That gives precise reads on demand
// without cluttering the cell.
//
// `null` / empty / invalid input returns `{ display: '—', full: '' }`
// so the table column stays aligned without a JS branch at every call.

export interface FormattedTimestamp {
  display: string;
  full: string;
}

export function formatTimestamp(
  iso: string | null | undefined,
  mode: 'recent' | 'auto' = 'recent',
): FormattedTimestamp {
  if (!iso) return { display: '—', full: '' };
  const then = new Date(iso);
  const t = then.getTime();
  if (!Number.isFinite(t)) return { display: '—', full: '' };

  // Full timestamp for the tooltip — verbose enough that the caller
  // never has to compose their own. Locale defaults to user's; falls
  // back to ISO if `toLocaleString` returns something weird.
  let full: string;
  try {
    full = then.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    full = then.toISOString();
  }

  const diff = Math.max(0, Date.now() - t);
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return { display: 'just now', full };
  if (minutes < 60) return { display: `${minutes}m ago`, full };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { display: `${hours}h ago`, full };

  if (mode === 'auto') {
    // > 24h ago in 'auto' mode — switch to absolute date. Suppress
    // the year when same calendar year (cleaner cells in the common
    // case); include it when it differs (older history).
    const sameYear = then.getFullYear() === new Date().getFullYear();
    try {
      return {
        display: then.toLocaleDateString(
          undefined,
          sameYear
            ? { month: 'short', day: 'numeric' }
            : { month: 'short', day: 'numeric', year: 'numeric' },
        ),
        full,
      };
    } catch {
      return { display: then.toISOString().slice(0, 10), full };
    }
  }

  // 'recent' mode — keep relative up to 30 days, then fall back to
  // a short date so "Last seen 73d ago" doesn't end up unreadable.
  const days = Math.floor(hours / 24);
  if (days < 30) return { display: `${days}d ago`, full };
  try {
    return { display: then.toLocaleDateString(), full };
  } catch {
    return { display: then.toISOString().slice(0, 10), full };
  }
}
