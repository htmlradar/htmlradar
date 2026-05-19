# Privacy

How HTMLRadar handles the data it collects. This is the policy that applies to the hosted version at htmlradar.com.

## What we collect

When a recipient opens a tracked share, we record:

- The **email address** they enter at the gate (if the share requires one).
- A **random fingerprint** (a UUID we generate and store in their browser's `localStorage` — no cross-site value).
- **Session metrics**: start time, total active time (with a 5-second idle watchdog so a parked tab doesn't inflate the number), max scroll depth, sections read with per-section dwell.
- **Coarse network metadata**: IP-derived country and city (we never store the IP itself), user-agent-derived device / OS / browser strings, referrer URL.
- **Attachment downloads**, if you click any attached file: which file, its size, your viewer ID, and your session ID. Stored in `attachment_downloads`. The file bytes are served from R2 but the download event is what we log.

We do **not** collect: keystrokes, mouse positions, third-party trackers, anything from outside the document, or anything that identifies the recipient beyond the email they provided.

## What we collect when you use the app yourself

Separately from share-tracking above, the hosted app records first-party usage data:

- **Product events**: when you sign in, upload a document, create or revoke a share, hit the free-tier cap, view the upgrade page, click a CTA, or submit feedback. Stored in an `app_events` table (PostHog-compatible schema — if we wire PostHog later we replay this table over).
- **Page views**: when your browser loads a page on htmlradar.com. Path, referrer, and a random fingerprint (generated client-side, never linked to your email unless you're signed in).
- **Crash and error reports**: JavaScript errors captured to an `error_log` table. We do not use Sentry or any third-party error service.
- **Feedback**: anything submitted through `/feedback` is stored in a `feedback` table and emailed directly to the founder. Email field is optional.

No third-party trackers (no Google Analytics, no Segment, no Mixpanel). No advertising cookies. No session replay.

## Where data lives

- Document HTML you upload — Cloudflare R2 (encrypted at rest, in the region of your bucket).
- All other data — Supabase Postgres (encrypted at rest).

## Who can see your data

Only the document owner (you, the sender) can see analytics about their shares. We enforce this with Postgres Row Level Security — even an authenticated user querying the database directly cannot see another user's data.

Operators of the hosted service have technical access to the underlying database for support and abuse investigation; this access is logged and limited.

## Data retention

By default, sessions and section events are retained indefinitely. Deleting a share removes all of its sessions, viewers, section events, and attachment-download records immediately (via Postgres `on delete cascade`). Deleting a document removes the document row, its `document_versions` history, and its uploaded HTML from R2 within 24 hours.

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
