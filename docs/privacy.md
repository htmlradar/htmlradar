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

- **Product events**: when you sign in, upload a document, create or revoke a share, hit the free-tier cap, view the upgrade page, click a CTA, or submit feedback. These events are stored in the `app_events` table. The monitor worker sends a server-side copy to PostHog for product analytics; the browser does not load a PostHog script. Your account email is added to your PostHog user profile after sign-in. Owner-scoped share events can include a first open, gate outcome, country, device, or email domain, but not a recipient's raw email address.
- **Page views**: when your browser loads a page on htmlradar.com. Path, referrer, and a random fingerprint (generated client-side, never linked to your email unless you're signed in).
- **Crash and error reports**: JavaScript errors captured to an `error_log` table. We do not use Sentry or any third-party error service.
- **Feedback**: anything submitted through `/feedback` is stored in a `feedback` table and emailed directly to the founder. Email field is optional.

No third-party tracking scripts. No third-party analytics or advertising cookies. No session replay.

## Where data lives

- Document HTML you upload — Cloudflare R2 (encrypted at rest, in the region of your bucket).
- Primary application data — Supabase Postgres (encrypted at rest).
- Product analytics events — PostHog, sent server-side from the monitor worker.

## Who can see your data

Only the document owner (you, the sender) can see analytics about their shares. We enforce this with Postgres Row Level Security — even an authenticated user querying the database directly cannot see another user's data.

Operators of the hosted service have technical access to the underlying database for support and abuse investigation; this access is logged and limited.

## Data retention

Sessions and section events are currently retained indefinitely. Permanently deleting an individual share removes its viewers, sessions, section events, and attachment-download records from Supabase immediately. The in-app Delete document action archives the document: it removes document and share access, but retains the database rows and uploaded HTML for recovery.

## Right to delete

Recipients and account holders can request permanent deletion by emailing `privacy@htmlradar.com`. Include the email address tied to the data and, for account holders, the affected document. We complete verified requests within 14 days, including matching data in Supabase, R2, and PostHog where applicable.

## Opt-out

A recipient can opt out of tracking by calling `window.HTMLRadar.optOut()` in the browser console of a tracked page. The opt-out persists in their `localStorage` and applies to all future HTMLRadar links they open in that browser, regardless of who sent them.

## Cookies

The hosted service uses session cookies for authentication (set when you sign in). Tracked share links may set a temporary cookie when a password is required, scoped to that share. We do not use third-party analytics or advertising cookies.

## Open source

HTMLRadar is AGPL-3.0 open source. You can audit exactly what data the tracker collects and how it's transmitted at [github.com/htmlradar/htmlradar](https://github.com/htmlradar/htmlradar).

## Contact

`privacy@htmlradar.com`
