# Privacy

How HTMLRadar handles the data it collects. This is the policy that applies to the hosted version at htmlradar.com.

## What we collect

When a recipient opens a tracked share, we record:

- The **email address** they enter at the gate (if the share requires one).
- A **random fingerprint** (a UUID we generate and store in their browser's `localStorage` — no cross-site value).
- **Session metrics**: start time, total active time, max scroll depth, sections read with dwell.
- **Coarse network metadata**: IP-derived country and city (we never store the IP itself), user-agent-derived device / OS / browser strings, referrer URL.

We do **not** collect: keystrokes, mouse positions, third-party trackers, anything from outside the document, or anything that identifies the recipient beyond the email they provided.

## Where data lives

- Document HTML you upload — Cloudflare R2 (encrypted at rest, in the region of your bucket).
- All other data — Supabase Postgres (encrypted at rest).
- Sentry receives crash data only (no personal data in error contexts).

## Who can see your data

Only the document owner (you, the sender) can see analytics about their shares. We enforce this with Postgres Row Level Security — even an authenticated user querying the database directly cannot see another user's data.

Operators of the hosted service have technical access to the underlying database for support and abuse investigation; this access is logged and limited.

## Data retention

By default, sessions and section events are retained for 365 days. You can configure shorter retention per document. Deleting a document removes all of its sessions, section events, and uploaded HTML within 24 hours.

## Right to delete

Recipients can have their data removed by emailing `privacy@htmlradar.com` with their email address. We will remove all viewer rows and associated sessions linked to that email within 14 days.

## Opt-out

A recipient can opt out of tracking by calling `window.HTMLRadar.optOut()` in the browser console of a tracked page. The opt-out persists in their `localStorage` and applies to all future HTMLRadar links they open in that browser, regardless of who sent them.

## Cookies

The hosted service uses session cookies for authentication (set when you sign in). Tracked share links may set a temporary cookie when a password is required, scoped to that share. We do not use third-party analytics or advertising cookies.

## Open source

HTMLRadar is AGPL-3.0 open source. You can audit exactly what data the tracker collects and how it's transmitted at [github.com/htmlradar/htmlradar](https://github.com/htmlradar/htmlradar).

## Contact

`privacy@htmlradar.com`
