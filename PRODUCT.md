# Product

## Register

product (app) · brand (marketing site)

## Users

Founders, agencies, and sales teams who send decks, proposals, and reports and need to know whether — and how — the recipient actually read them. They send a link instead of an attachment, then check back to see who opened it, how long they stayed, and which sections they lingered on. The job to be done: replace the silence after "I sent it over" with a fact.

## Product Purpose

HTMLRadar turns an HTML document — a pitch deck, a proposal, a client report — into a tracked link. The sender uploads a file or pastes a URL; HTMLRadar wraps it, hands back a link, and shows the sender who read what: opens, dwell time, section-by-section attention, device and location. Success looks like a sender walking into their next call already knowing what the reader cared about.

## Brand Personality

Calm, precise, editorial. Every number on the page is a fact the reader can act on, not a vanity metric. The product should feel like reading a well-set document — a "Letterpress Ledger" — not operating a dashboard: warm paper, oxblood ink, a mono typeface for facts and stamps (read times, percentages, hostnames), a serif for headings.

## Anti-references

Generic SaaS dashboards. Purple gradients. Glassmorphism. Playful startup illustration. Confetti.

## Design Principles

- **Quiet and exact.** Every component — button, input, badge — does one thing plainly; nothing carries decoration beyond its function.
- **Flat by default, depth by tone.** Surfaces sit flat with a single hairline border; shadow appears only as a response to state (hover, open, focus), never as ambient decoration.
- **Motion conveys state, never decoration.** State changes run 150–250ms with ease-out curves; the one exception per flow is a signature moment; nothing animates on page load.
- **Identity is fixed.** The warm paper background and oxblood accent are the committed brand — not defaults to reconsider, even against generic guidance that treats cream as a common fallback.
- **The reader is a real person.** Recipient-facing surfaces (the access gate, the error pages) get the same typographic care as the marketing site, with none of its weight — a well-typeset letter, not a SaaS portal login.

## Accessibility & Inclusion

Every interactive control (buttons, button-shaped links, form fields) gets a visible `:focus-visible` ring — 2px solid oxblood at 78% opacity, meeting WCAG AA non-text contrast (3:1) against the paper background. `prefers-reduced-motion: reduce` is honored globally (all animation and transition durations collapse to near-zero), and the signature "check-in" success animation is separately gated behind `motion-safe:`. Recipient-facing form inputs hold a 16px minimum font size to avoid iOS Safari's zoom-on-focus.
