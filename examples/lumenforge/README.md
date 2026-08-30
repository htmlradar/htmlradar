# Lumenforge — demo document

A fictional seed-stage company. Used as the canonical demo for HTMLRadar.

- Single-file HTML, ~28 KB, no JavaScript.
- 12 `<h2>` sections with stable `id` anchors. Mixed `<h3>` subheads in Market and Use of Funds.
- Warm light editorial design — deep amber accent (`#b85c1c`), single muted teal swatch.
- The `<!-- HTMLRADAR_EMBED -->` comment near the end of `<head>` marks where the proxy worker injects the tracker.

## How it's used

Once deployed, this lives at `htmlradar.page/r/lumenforge-demo` — a public share with no email gate. The landing page links to it as the live demo.

## Editing

If you change section anchors, do it at the source. Any in-flight share that was opened against the previous version keeps its `section_events` rows; the analytics dashboard joins on `section_id`, so renaming an `id` orphans the old data. Treat anchors as part of the public contract.

Names, numbers, and the patent reference are intentional fiction. Don't ship real customer data anywhere near this file.
