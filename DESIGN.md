---
name: HTMLRadar
description: Warm paper and oxblood ink for tracked HTML documents — a letterpress ledger, not a dashboard.
colors:
  signal: '#7A1F2E'
  signal-dark: '#5A1521'
  signal-soft: '#D9B5B0'
  bg: '#F4ECDE'
  paper: '#FBF1E8'
  paper-2: '#F4E1CB'
  paper-3: '#EDD5BD'
  ink: '#2A1812'
  ink-soft: '#3A2818'
  graphite: '#876959'
  line: '#E8D5BD'
  good: '#1F7A3A'
  alert: '#5A1521'
  pop: '#C9E4A5'
  pop-ink: '#2F4118'
typography:
  display:
    fontFamily: "var(--font-serif), Georgia, 'Times New Roman', serif"
    fontSize: 'clamp(24px, 3vw, 44px)'
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: '-0.025em'
  headline:
    fontFamily: 'var(--font-serif), Georgia, serif'
    fontSize: '40px'
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: '-0.04em'
  title:
    fontFamily: 'var(--font-serif), Georgia, serif'
    fontSize: '24px'
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: '-0.04em'
  body:
    fontFamily: 'var(--font-sans), system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'var(--font-mono), ui-monospace, monospace'
    fontSize: '10px'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: '0.16em'
rounded:
  sm: '2px'
  md: '6px'
  lg: '8px'
  xl: '12px'
  2xl: '16px'
  full: '9999px'
components:
  button-primary:
    backgroundColor: '{colors.signal}'
    textColor: '{colors.paper}'
    rounded: '{rounded.md}'
    padding: '10px 20px'
  button-primary-hover:
    backgroundColor: '{colors.signal-dark}'
  input:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '12px 16px'
  card:
    backgroundColor: '{colors.paper}'
    rounded: '{rounded.2xl}'
    padding: '32px'
  badge:
    textColor: '{colors.signal-dark}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '2px 10px'
  corner-pill:
    backgroundColor: '{colors.signal}'
    textColor: '{colors.paper}'
    rounded: '{rounded.full}'
    padding: '12px 16px 12px 14px'
  corner-pill-hover:
    backgroundColor: '{colors.signal-dark}'
---

# Design System: HTMLRadar

## 1. Overview

**Creative North Star: "The Letterpress Ledger"**

HTMLRadar reads as a well-set document, not a dashboard. Warm paper underneath, oxblood ink on top, a mono typeface stamping the facts (read times, percentages, hostnames) the way a ledger stamps a date, and a serif carrying every heading like a headline in a broadsheet. The voice is calm, precise, editorial: every number on screen is something the reader can act on, never a vanity metric dressed up to look busy.

The system explicitly rejects the generic SaaS-dashboard look: no purple gradients, no glassmorphism, no playful startup illustration, no confetti. Depth comes from tone and a single hairline border, not from stacked panels and drop shadows. Where the codebase already leans this way — flat cards, a crisp 1px "crease" instead of a floating shadow, a mono badge instead of a colored banner — that is the system working as intended, not an accident to fix.

**Key Characteristics:**

- Warm paper background (`#F4ECDE`) with a lighter paper surface (`#FBF1E8`) for anything that sits "on" the page — cards, inputs, pills.
- One accent color, oxblood (`#7A1F2E`), used for primary actions, live/active state, and focus — never as decoration.
- Newsreader serif for anything read as a heading; Geist sans for body and controls; JetBrains Mono, uppercase and letter-spaced, for every fact, stamp, and label.
- Flat by default. A hairline border (`#E8D5BD`) does the work a shadow would do elsewhere; shadow shows up only in response to state.
- Every success moment is a small check that draws in — never a banner, never a toast.

## 2. Colors

The palette is a single warm-paper family lit by one accent. There is no secondary or tertiary color; restraint is the point.

### Primary

- **Oxblood** (`#7A1F2E`, key `signal`): the one accent. Primary buttons, links inside content, focus rings, live/active indicators, the corner brand pill on every recipient-facing page.
- **Oxblood Dark** (`#5A1521`, key `signal-dark`): hover/active state for oxblood surfaces. Also doubles as the `alert` token (error text, invalid-input border) — the system deliberately does not carry a second red for errors.
- **Oxblood Soft** (`#D9B5B0`, key `signal-soft`): the quietest tint — inactive progress dots, soft dividers where a full hairline would be too loud.

### Neutral

- **Page** (`#F4ECDE`, key `bg`): the site's actual canvas — `html`/`body` background across every route.
- **Paper** (`#FBF1E8`, key `paper`): the surface color for anything that sits above the page — cards, inputs, the recipient-view corner pill's label text, button labels. Lighter than the page itself, so components read as set-down objects.
- **Paper 2** (`#F4E1CB`) / **Paper 3** (`#EDD5BD`, keys `paper-2`/`paper-3`): deeper paper tones for nested panels (e.g. a segmented control's track) and hover fills.
- **Ink** (`#2A1812`, key `ink`): primary text.
- **Ink Soft** (`#3A2818`, key `ink-soft`): secondary text, lede paragraphs.
- **Graphite** (`#876959`, key `graphite`): tertiary text — mono kickers, labels, placeholder text.
- **Line** (`#E8D5BD`, key `line`): the one hairline border color, used everywhere a divider or card edge is needed instead of a shadow.

### Semantic

- **Good** (`#1F7A3A`, key `good`): success, "live" pulsing dots, positive deltas.
- **Alert** (`#5A1521`, key `alert`): error text and invalid-state borders — the same hex as `signal-dark`, by design (see Named Rule below).
- **Pop** (`#C9E4A5`, key `pop`) / **Pop Ink** (`#2F4118`, key `pop-ink`): a pistachio highlight reserved for live indicators and one "headline stat" per dashboard. Used sparingly — this is the only non-warm hue in the system.

### Named Rules

**The One Oxblood Rule.** `#7A1F2E` (`signal`) is the only accent color a new component should reach for. The codebase currently also contains a second, unreconciled oxblood — `#6B1E2C` (with a lighter `#A23B3B`) — defined as `--brand`/`--brand-2` in `packages/app/src/app/landing-v2.css` and used throughout the marketing home page's hero, pitch, and swiper sections. That value predates the `signal` migration documented in `tailwind.config.ts` and was never carried over. Do not treat it as a second sanctioned accent; new work should converge on `#7A1F2E`.

**The Two Papers Rule.** `bg` (`#F4ECDE`) is the page; `paper` (`#FBF1E8`) is anything sitting on the page. Don't collapse them into one color — the contrast between the two is what gives cards, pills, and inputs their "set on the page" quality instead of blending into the background.

## 3. Typography

**Display Font:** Newsreader (variable serif, optical-size axis; self-hosted via `next/font`) — CSS var `--font-serif`, fallback Georgia / "Times New Roman" / serif.
**Body Font:** Geist Sans — CSS var `--font-sans`, fallback system-ui / sans-serif.
**Label/Mono Font:** JetBrains Mono — CSS var `--font-mono`, fallback ui-monospace / monospace.

**Character:** Newsreader reads as newspaper, not magazine — the codebase's own rationale for picking it over the more common Fraunces/Source Serif pairing seen on competitor sites. JetBrains Mono uppercase, wide-tracked, carries every fact (a read time, a percentage, a hostname) like a stamp on a ledger page.

### Hierarchy

- **Display** (700, `clamp(24px, 3vw, 44px)`, line-height 1.02, letter-spacing `-0.025em`): the marketing home page's hero and section headlines only (`landing-v2.css`'s `.v2-headline`, `.v2-pitch h2`, `.v2-swiper-head h2`).
- **Headline** (400, 40px fixed with a single breakpoint jump to 48–64px, line-height 1.05, letter-spacing `-0.04em`, paired with the `.text-letterpress` shadow): every product page's `<h1>` — dashboard, docs, settings, sign-in, legal pages. Weight stays at 400, not bold; the tightest tracking in the system carries the emphasis instead.
- **Title** (400, 22–28px, line-height tight, letter-spacing `-0.04em`): in-card sub-headings (API keys, custom domain, connected apps panels).
- **Body** (400, 14–16px, line-height 1.5–1.6): paragraph text and form labels; recipient-facing gate copy holds a 16px floor to avoid iOS zoom-on-focus. Editorial measure caps prose at `38rem` (~65ch) via the `.measure` utility.
- **Label** (500–700, 9.5–11px, letter-spacing 0.12–0.18em, uppercase, mono): kickers, section marks (`§ 02`), badges, footer links. Always uppercase — this property isn't expressible in the frontmatter's typography schema but is a constant across every real usage.

### Named Rules

**The Letterpress Rule.** Headline-role text at 32px and above carries `.text-letterpress` — a barely-there double text-shadow (`0 1px 0 rgba(31,17,8,.05)`, `0 0.5px 0 rgba(31,17,8,.03)`) that should be imperceptible unless directly compared to plain text. It reads as printed paper, not a digital heading; never make it heavier or the illusion breaks.

**The Two Headline Systems Rule (flag).** Product pages use the Headline recipe above (400 weight, fixed px + one breakpoint, `-0.04em` tracking). The marketing home page uses the Display recipe (700 weight, fluid `clamp()`, `-0.025em` tracking) and loads Fraunces separately on the proxy-rendered recipient gate/error pages (`packages/proxy/src/responses.ts`) rather than Newsreader. Three different serif treatments for nominally the same "big heading" job exist side by side; new product surfaces should use the Headline recipe, not either of the other two.

## 4. Elevation

Flat by default. The system's primary depth cue is a single hairline border (`line`, `#E8D5BD`) plus a lighter `paper` surface against the darker `bg` page — tonal layering, not shadow-stacking. Where a shadow does appear, it is either a 1px "crease" that reads as a cut paper edge rather than a lifted object, or a soft, wide, negative-spread ambient lift reserved for cards and floating panels.

### Shadow Vocabulary

- **Crease** (`box-shadow: 0 1px 0 rgba(31,17,8,0.15)`): the primary button's resting-state shadow. A flat 0-blur offset, not elevation — reads as an edge, matching the flat-by-default doctrine even though it's present at rest, not just on hover.
- **Focus Ring** (`box-shadow: 0 0 0 3px rgba(122,31,46,0.08)`): the soft oxblood glow on a focused input, paired with a border-color shift to `signal`. The invalid-state variant uses `rgba(90,21,33,0.12)` at the same 3px spread.
- **Card Lift** (`box-shadow: 0 18px 40px -30px rgba(31,17,8,0.18)`): the ambient shadow under raised cards and panels — wide blur, deep negative spread, low opacity, so it reads as a soft shadow cast on paper rather than a hard drop shadow. Observed range across cards: 18–30px blur, -20px to -30px spread, 0.14–0.35 opacity.
- **Pill Lift** (`box-shadow: 0 1px 0 rgba(31,17,8,0.12), 0 6px 18px -8px rgba(122,31,46,0.35)`): the corner brand pill's resting shadow — a crease plus a tinted oxblood glow, so the pill reads as sitting slightly above the page.

### Named Rules

**The Crease, Not Lift Rule.** A shadow with zero blur and a 1px offset is a border in disguise, not elevation — it's permitted at rest. A shadow with blur and negative spread is elevation, and is reserved for a genuine raised surface (a card, a popover, a drawer) or a state response (hover, open, focus). Don't apply a blurred shadow to a resting flat element.

## 5. Components

Buttons, inputs, and badges share one register: quiet and exact, nothing decorated beyond its function.

### Buttons

- **Shape:** `rounded-md` (6px) — the dominant radius for buttons and inputs across the whole product (121 occurrences in the app).
- **Primary:** solid oxblood (`bg-signal`) with a paper-colored label (`text-paper`), `px-5 py-2.5` for standard CTAs or `px-6 py-3` for hero-scale CTAs, plus the Crease shadow at rest.
- **Hover / Focus:** background shifts to `signal-dark` on hover; disabled state drops to 40% opacity and keeps the resting background (no color change on a disabled hover). A tactile 0.5px `translateY` on `:active` gives every button and button-shaped anchor a pressed feel.
- **Ghost:** the product app has no filled secondary-button variant — secondary actions are mono badge-pills or plain text links (see Badges). The one true ghost button is the marketing homepage's `.v2-btn-ghost`: translucent white background, `border-line-2`, `backdrop-filter: blur(6px)`, used only in the hero.

### Chips (Badges)

- **Style:** `rounded-full`, mono, uppercase, `tracking-[0.12em]`–`tracking-[0.18em]`, `text-[9.5px]`–`text-[11px]`. Background is always a tint (10–15% opacity) of the semantic color, never a solid fill.
- **State:** neutral (`bg-paper-3 text-graphite`), accent (`bg-signal/15 text-signal-dark`), success (`border-good/40 bg-good/10 text-good`), off/absent (dashed `border-line`, transparent background, `text-graphite` — used so "no gate" reads as deliberate, not missing), alert (`border-alert/40 bg-alert/5 text-alert`).

### Cards / Containers

- **Corner Style:** `rounded-2xl` (16px) is the dominant card radius (82 occurrences); `rounded-xl` (12px) covers secondary containers like drawers and popovers.
- **Background:** `paper` (`#FBF1E8`), sitting on the `bg` page.
- **Shadow Strategy:** Card Lift (see Elevation) — soft, wide, low-opacity; never a hard drop shadow.
- **Border:** 1px `line` hairline on essentially every card and panel.
- **Internal Padding:** `p-8` (32px) is the standard form-card padding, `p-5` (20px) for tighter notice/callout cards.

### Inputs / Fields

- **Style:** `rounded-md`, 1px `line` border, `paper` background, `px-4 py-3`, ink text, `outline: none` with the browser default replaced entirely.
- **Focus:** border shifts to `signal`, plus the Focus Ring shadow (`0 0 0 3px rgba(122,31,46,0.08)`) — a soft brand-hued glow, never a hard native outline on inputs (native `:focus-visible` outlines are reserved for buttons and button-shaped anchors).
- **Error / Disabled:** invalid inputs get a `signal-dark`-colored border and the Focus Ring shadow re-tinted to `rgba(90,21,33,0.12)`.

### Navigation

- The marketing site's floating pill nav (`.v2-nav`): fixed, centered, `rounded-full` (999px), translucent white with `backdrop-filter: blur(18px)`, sliding out of view on scroll-down via `NavAutoHide`. The nav CTA is solid ink (`#2A1812`/`#1F1108`-family dark, not oxblood), the one place in the system a dark-ink button substitutes for the oxblood primary button.
- Product surfaces (dashboard, docs, settings) don't use a persistent top/side nav chrome of their own; navigation is page-to-page via the same button and link vocabulary as the rest of the product.

### The Corner Pill (signature component)

Every recipient-facing page — the access gate, the error states, the report form, and the document itself — carries a fixed corner element instead of a page-level nav bar:

- **Brand pill** (top-right, on every gate/error/report shell rendered by `packages/proxy/src/responses.ts`): solid oxblood, `rounded-full`, mono uppercase label, the Pill Lift shadow, a 44px minimum tap target on mobile. This is the one place a _solid_ oxblood pill is used — reserved for surfaces HTMLRadar itself owns.
- **Attachments pill** (top-right, on the document view itself, `packages/proxy/src/inject.ts`): a quieter paper-colored pill (`📎 N`), pulses twice on load via `hr-att-pulse`, opens a right-side drawer (`rounded-l` panel, `width: 360px`, slides in over 220ms).
- **"Powered by" credit** (bottom-right, free tier only): translucent cream chip, small mono type, deliberately quiet — the sender's document is the canvas, the brand is a credit, not a billboard. Removing it is the Pro-tier upsell.

### The Read Report (recipient gate shell)

The password/email gate, the "link expired/revoked/not found" states, and the opt-out and report-abuse forms all share one shell (`packages/proxy/src/responses.ts`): warm paper background with a faint 24px dotted texture, a mono kicker above a serif `<h1>`, a lede paragraph, one primary button, and a quiet dotted-underline "Report this document" link below the fold. No dashboard chrome, no sidebar — the recipient's first (and possibly only) HTMLRadar surface reads as a single well-typeset letter.

## 6. Do's and Don'ts

### Do:

- **Do** use `#7A1F2E` (`signal`) as the only accent color for new primary actions, focus states, and live indicators.
- **Do** keep buttons flat at rest — a Crease shadow (`0 1px 0 rgba(31,17,8,0.15)`) at most, never a blurred drop shadow on a resting button.
- **Do** give every focusable control a visible `:focus-visible` treatment: 2px solid oxblood at 78% opacity for buttons/button-shaped anchors, or the soft 3px oxblood glow for inputs.
- **Do** keep state-change motion to 150–250ms with ease-out curves (`cubic-bezier(0.16, 1, 0.3, 1)` and similar), reserving anything longer for one signature moment per flow — the `check-in` keyframe (400ms, draws a small check on success) is the reference example.
- **Do** provide a `prefers-reduced-motion` alternative for every animation; the system's global rule already collapses all durations to near-zero, but a new bespoke animation must still make sense with motion removed.
- **Do** use mono, uppercase, wide-tracked type for anything that is a fact or a stamp: read times, percentages, hostnames, slugs, statuses.
- **Do** treat the warm paper background and oxblood accent as the fixed identity of this product — not a default to swap out, even where generic guidance treats cream as an interchangeable starting point.

### Don't:

- **Don't** build a generic SaaS dashboard, use purple gradients, glassmorphism, playful startup illustration, or confetti — these are named anti-references for this brand.
- **Don't** introduce a second oxblood. `#6B1E2C`/`#A23B3B` exist in `landing-v2.css` as an unreconciled legacy value — treat them as drift to converge away from, not as a sanctioned secondary accent.
- **Don't** reuse the proxy worker's legacy ink value, `#1F1108` (still live in `packages/proxy/src/responses.ts` and `inject.ts`). The canonical ink is `#2A1812`, matching `tailwind.config.ts` and `globals.css`.
- **Don't** load Fraunces for a new heading. The canonical display/headline serif is Newsreader; Fraunces only survives on the proxy's recipient gate pages as an unmigrated legacy choice.
- **Don't** animate anything on page load for new product work. (The existing marketing homepage's staggered hero/chip entrance choreography in `landing-v2.css` predates this doctrine and is not the pattern to replicate.)
- **Don't** animate layout properties (width, height, top/left) for state changes — transform and opacity only.
- **Don't** use a bounce or spring-overshoot easing anywhere; ease-out only.
- **Don't** show success as a banner or a toast — a small check that draws in (`check-in`) is the one success pattern.
- **Don't** touch the tracking beacon, the recipient email gates, or the redirect logic under the banner of a visual or motion change — these are untouchable regardless of design intent.
