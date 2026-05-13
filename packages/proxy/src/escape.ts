// HTML escaping for proxy-rendered pages and injected attributes.
// The full set of OWASP-recommended characters; safe in both content and
// double-quoted attribute contexts. Centralized so inject.ts and responses.ts
// share one implementation.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
