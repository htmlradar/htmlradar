// Where a recipient's link lives.
//
// Recipient documents are served from their own registrable domain, not from
// the application's. A customer's HTML therefore never shares an origin with
// a signed-in session, and a phishing page pushed through the product cannot
// wear the application domain's certificate or spend its reputation with the
// blocklists. The proxy worker owns that host; this file is the one place the
// rest of the app agrees with it.
//
// NEXT_PUBLIC_SHARE_BASE is read at build time by Next.js, so it is baked
// into both the server and the browser bundle. Self-hosters set it to
// whatever they gave the worker as SHARE_HOST.
//
// Links created before the move still point at the application domain. They
// are not rewritten in the database — the worker answers them with a
// permanent redirect to here, which costs one hop and nothing else.
//
// The trailing slash is trimmed because pasting a base straight out of a
// browser address bar is the normal way to get one, and it would otherwise
// produce //r/.
export const SHARE_BASE = (process.env.NEXT_PUBLIC_SHARE_BASE ?? 'https://htmlradar.page').replace(
  /\/+$/,
  '',
);

// The same thing without the scheme, for the places that print a link rather
// than link to one. A plain string operation, not `new URL`, so a malformed
// value degrades to an odd-looking label instead of throwing at import time.
export const SHARE_HOST = SHARE_BASE.replace(/^https?:\/\//, '');

/** The public address of a share. */
export const shareUrl = (slug: string): string => `${SHARE_BASE}/r/${slug}`;
