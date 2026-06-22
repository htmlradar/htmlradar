// Single source of truth for "what counts as a valid HTML source" — shared by
// the create form (client UX), the create server action (authoritative
// re-validation), and the replace flow. Previously each had its own copy:
// the create form accepted .htm but the replace picker didn't [P-a], and the
// server enforced neither file-type nor URL-format despite the form promising
// it [24].

// File-picker `accept` attribute. Include .htm — it's valid HTML.
export const HTML_ACCEPT = '.html,.htm,text/html';

export const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);

// A file is HTML if its MIME type says so OR its name ends in .html/.htm.
// (Browsers often report an empty MIME for local .html files, so the name
// check is load-bearing.)
export function isHtmlFile(name: string, type: string): boolean {
  return HTML_MIME_TYPES.has(type) || /\.html?$/i.test(name);
}

// Validate a pasted source URL. Returns an error message, or null if valid.
export function validateSourceUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return 'URL must start with http:// or https://';
  try {
    const u = new URL(trimmed);
    if (!u.hostname.includes('.')) return "That doesn't look like a valid hostname.";
  } catch {
    return 'Not a valid URL.';
  }
  return null;
}
