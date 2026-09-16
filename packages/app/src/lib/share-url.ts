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

// A share created after handle links are switched on stores its own hostname
// label in `document_shares.host_handle` (schema/043), and it is served from
// `{host_handle}.{SHARE_HOST}` instead of the apex. Routing follows the value
// stored on the share, never the owner's current handle, so a link that has
// already been sent never moves — which is why every caller passes the share's
// own column here rather than looking the owner up.
//
// Null, absent, or a share created before the switch: the apex, byte for byte
// what this file has always returned.
//
// A share created on the owner's own domain (schema/052) stores that domain
// instead, and `customHostname` is its hostname read off the same row. It wins
// over the handle because the two are mutually exclusive on the row, and it is
// a whole hostname rather than a label — it belongs to the customer, not to
// us, so nothing of ours is prefixed to it. The scheme still comes from
// SHARE_BASE, so a self-hoster running plain HTTP gets plain HTTP here too.
const SCHEME = SHARE_BASE.startsWith('http://') ? 'http://' : 'https://';

const baseFor = (hostHandle?: string | null, customHostname?: string | null): string => {
  if (customHostname) return `${SCHEME}${customHostname}`;
  return hostHandle ? SHARE_BASE.replace('://', `://${hostHandle}.`) : SHARE_BASE;
};

/** The public address of a share. */
export const shareUrl = (
  slug: string,
  hostHandle?: string | null,
  customHostname?: string | null,
): string => `${baseFor(hostHandle, customHostname)}/r/${slug}`;

/**
 * The same address without the scheme, for the places that print a link
 * rather than link to one.
 *
 * It exists so nothing has to assemble `${SHARE_HOST}/r/${slug}` by hand: a
 * hand-built label would keep saying the apex after a share moved to a handle
 * host, and the customer would copy an address that is not the one on the
 * button beside it.
 */
export const shareUrlLabel = (
  slug: string,
  hostHandle?: string | null,
  customHostname?: string | null,
): string => shareUrl(slug, hostHandle, customHostname).replace(/^https?:\/\//, '');
