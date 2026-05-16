// File-type allowlist + filename sanitisation for supporting materials.
//
// Security posture:
//   - Allowlist by EXTENSION, not by user-provided MIME type. MIME types
//     in the upload payload are advisory; we re-derive Content-Type at
//     serve time from the extension lookup below.
//   - Filename sanitisation strips path separators, control characters,
//     and falls back to a generic name if the result is empty. The
//     stored filename is what we put in the Content-Disposition header
//     when the recipient downloads; bad input would let an attacker
//     inject CR/LF and forge headers.
//   - Anything outside the allowlist is rejected. We deliberately do
//     NOT support scripts (.js/.mjs/.html as attachments — they'd
//     execute in the recipient's browser if served inline), nor
//     executables. This is intentional: HTMLRadar serves the primary
//     HTML deck with tracking; attachments are downloadable files,
//     never inline-rendered, but extra paranoia is cheap.
//
// If you need to add an extension, add it here AND verify the recipient
// download flow forces Content-Disposition: attachment (it does — see
// packages/proxy/src/index.ts handleAttachmentDownload).

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const MAX_ATTACHMENTS_PER_DOC = 20;
export const MAX_TOTAL_BYTES_PER_DOC = 100 * 1024 * 1024; // 100 MB total

// Extension → server-controlled Content-Type. The proxy uses this map at
// download time so we never echo back the user-provided MIME. Keys are
// lowercase, dot-prefixed.
//
// What's NOT here (intentional): .html / .htm / .js / .mjs / .svg /
// .xhtml — these can execute script when opened or referenced; better
// to refuse the upload than risk an XSS / file-confusion attack.
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  // Archives — treated as opaque blobs. We don't unpack.
  '.zip': 'application/zip',
};

export interface ValidatedFile {
  filename: string;
  mimeType: string;
  size: number;
  extension: string;
}

export interface ValidationError {
  filename: string;
  reason: string;
}

/**
 * Lowercase, dot-prefixed extension. Empty string if the filename has
 * none (e.g. "Makefile"). Does NOT trust the last segment if it follows
 * a known-archive extension — `.tar.gz` returns `.gz` which is fine
 * because we'd reject it on the allowlist anyway.
 */
export function getExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return '';
  return lower.slice(dot);
}

/**
 * Sanitise a filename so it's safe to embed in a Content-Disposition
 * header AND safe to store in an R2 key.
 *
 * Rules:
 *   - Strip directory separators (`/`, `\`) and null bytes
 *   - Strip CR/LF/tab and any other ASCII control characters (header
 *     injection vector if echoed back to a recipient)
 *   - Strip leading dots (no `.htaccess`-style names)
 *   - Cap length at 200 chars (R2 key total is 1024; need room for the
 *     attachment-id prefix + path)
 *   - Fallback "untitled" if empty after sanitisation
 *
 * Returns ASCII-only output by stripping anything outside 0x20-0x7E.
 * Recipients who need non-ASCII filenames can read the original from
 * the Content-Disposition `filename*` UTF-8 parameter if we ever add it
 * (v1.5: ASCII-only is acceptable for the data-room use case).
 */
export function sanitizeFilename(input: string): string {
  // Take only the last path segment in case the input is something like
  // "../etc/passwd" or "C:\\Windows\\System32\\evil.exe".
  const baseRaw = input.split(/[/\\]/).pop() ?? '';
  const stripped = baseRaw
    // ASCII-printable only (drops control characters AND non-ASCII)
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '')
    // Defensive: header break sequences if they somehow slipped in
    .replace(/[\r\n]/g, '')
    // No leading dots — avoids hidden-file conventions
    .replace(/^\.+/, '')
    .trim();
  const truncated = stripped.slice(0, 200);
  return truncated || 'untitled';
}

/**
 * Validate one File. Returns either a `ValidatedFile` or a
 * `ValidationError` with a recipient-friendly reason string.
 */
export function validateFile(file: File): ValidatedFile | ValidationError {
  const filename = sanitizeFilename(file.name);
  const ext = getExtension(filename);
  if (!ext) {
    return { filename: file.name, reason: 'No file extension — give the file a clear type.' };
  }
  const mime = ALLOWED_EXTENSIONS[ext];
  if (!mime) {
    return {
      filename: file.name,
      reason: `Type ${ext} isn't allowed. Use PDF, Office docs, images, CSV, TXT, MD, or ZIP.`,
    };
  }
  if (file.size === 0) {
    return { filename: file.name, reason: 'File is empty.' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      filename: file.name,
      reason: `File is ${formatBytes(file.size)} — over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit.`,
    };
  }
  return { filename, mimeType: mime, size: file.size, extension: ext };
}

export function isValidationError(
  result: ValidatedFile | ValidationError,
): result is ValidationError {
  return 'reason' in result;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * R2 key for an attachment. The key is unique-by-attachment-id (we
 * include the random UUID prefix) so the table's UNIQUE constraint on
 * r2_key catches any accidental collision, and a recipient knowing one
 * attachment's path can't enumerate the rest.
 */
export function r2KeyForAttachment(
  ownerId: string,
  docId: string,
  attachmentId: string,
  sanitisedFilename: string,
): string {
  return `attachments/${ownerId}/${docId}/${attachmentId}-${sanitisedFilename}`;
}
