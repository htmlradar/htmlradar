# Deck-sharing capture — 31 August 2026

Raw network and browser-state captures behind
[What deck-sharing tools record](https://htmlradar.com/blog/what-deck-sharing-tools-record).
One JSON file per product, plus the script that produced them.

## What the script does

`recapture.js` opens each link in headless Chromium through Playwright. Per subject
it launches a fresh browser and a brand-new context — no profile, no cookies carried
in — at viewport 1512×982 with a normal desktop Chrome user-agent string. It then
waits **ten seconds**, records the page state, scrolls to the bottom, waits **five
more seconds**, and records the page state again. That is the **fifteen-second
window** referred to in the article. Nothing is typed and nothing is clicked; no
e-mail address is entered anywhere.

Each JSON file holds:

- `nav` — the navigation response status
- `hosts` — every host contacted, with a request count
- `reqs` — every request in order: method, URL, response status
- `afterLoad` / `afterScroll` — `document.cookie`, `localStorage` and
  `sessionStorage` key names, `script[src]` values, `iframe` sources, and the first
  1200 characters of body text

## The links

One public link per product. Six belong to other people; one is ours.

| Product | Link | Captured (UTC) |
| --- | --- | --- |
| DocSend | `https://docsend.com/view/58em2uebezhisqvy` | 2026-08-31T05:25:38Z |
| Papermark | `https://www.papermark.com/view/cmkz9p9de0014js04sf4ex5u8` | 2026-08-31T05:25:56Z |
| Peony | `https://app.peony.ink/view/daa6031a-a4d2-42bd-a85b-e3f1dc345b82` | 2026-08-31T05:26:13Z |
| Stacktree | `https://example-brand-audit.stacktr.ee/` | 2026-08-31T05:26:29Z |
| Tiiny.host | `https://ai-agents-guide.tiiny.site/` | 2026-08-31T05:26:46Z |
| HummingDeck | `https://hummingdeck.com/r/mt3uu5qwv7kpxb3g` | 2026-08-31T05:27:03Z |
| HTMLRadar | `https://htmlradar.com/r/lumenforge-demo` | 2026-08-31T05:27:20Z |

## Dates

The article's table is the **30 August 2026** run. This folder is the **31 August
2026** re-check with the same script and the same window. A third run on
**7 September 2026** is in the sibling folder
[`deck-sharing-2026-09-07/`](../deck-sharing-2026-09-07/).

## What was removed before publishing

Cookie values, signed-URL signatures and credentials, and any query-string value
carrying an authorization token, API key, session or device identifier, or e-mail
address were replaced with `[redacted]`. Key and parameter **names** are kept, so
the shape of what was set is still readable. Nothing else was changed.

## Re-running it

```sh
npm install playwright
npx playwright install chromium
node recapture.js      # writes ./recapture/{product}.json
```

Results will differ from these files: vendors change what they load, and a
fifteen-second window on one day is one sample, not a steady state.
