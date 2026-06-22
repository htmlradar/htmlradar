// Single source of truth for sanitizing the externally-controlled post-auth
// redirect target (`?next=`). `next` is the only attacker-influenced redirect
// destination on the site: accepting `next=//evil.com` or `next=/\evil.com`
// (which browsers treat as protocol-relative) would turn the auth flow into an
// open-redirect / phishing gateway. Anything that isn't a clean in-app path
// collapses to /docs.
//
// Used by BOTH /sign-in (already-authed short-circuit) and /auth/callback
// (post-exchange redirect). They previously each had their own copy and
// drifted — the sign-in page accepted `/\evil.com` that the callback rejected.
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/docs';
  if (!raw.startsWith('/')) return '/docs';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/docs';
  return raw;
}
