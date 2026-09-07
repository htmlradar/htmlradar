# Deck-sharing capture — 7 September 2026

The final re-check behind
[What deck-sharing tools record](https://htmlradar.com/blog/what-deck-sharing-tools-record),
run the day before the article was posted to Hacker News. Same script, same seven
links, same window as the earlier runs.

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
| DocSend | `https://docsend.com/view/58em2uebezhisqvy` | 2026-09-07T06:04:07Z |
| Papermark | `https://www.papermark.com/view/cmkz9p9de0014js04sf4ex5u8` | 2026-09-07T06:04:25Z |
| Peony | `https://app.peony.ink/view/daa6031a-a4d2-42bd-a85b-e3f1dc345b82` | 2026-09-07T06:04:41Z |
| Stacktree | `https://example-brand-audit.stacktr.ee/` | 2026-09-07T06:04:57Z |
| Tiiny.host | `https://ai-agents-guide.tiiny.site/` | 2026-09-07T06:05:14Z |
| HummingDeck | `https://hummingdeck.com/r/mt3uu5qwv7kpxb3g` | 2026-09-07T06:05:31Z |
| HTMLRadar | `https://htmlradar.com/r/lumenforge-demo` | 2026-09-07T06:05:48Z |

## What this run found

No change from the findings published in the article. All seven links returned 200.
Every host, cookie name and storage key that the article records was still present,
and no product gained one. Peony's Mixpanel Session Replay upload through
`app.peony.ink/mp/record` answered `200`, the same as the 2 September run the article
already reports, rather than the `402` recorded on 30 and 31 August.

Two immaterial differences, neither touching a published finding: Peony's Hotjar
scripts loaded as before but no `content.hotjar.io` upload went out inside this
particular window, and asset filenames with build hashes in them (Calendly's
bundles, the Cloudflare Insights beacon) differ because the vendors redeployed.

## Dates

The article's table is the **30 August 2026** run; the re-check is
[`deck-sharing-2026-08-31/`](../deck-sharing-2026-08-31/); this folder is the final
**7 September 2026** run.

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
