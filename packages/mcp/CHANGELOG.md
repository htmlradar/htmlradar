# Changelog

All notable changes to `htmlradar-mcp`. The plugin at `plugins/htmlradar` pins one of these versions
in its `.mcp.json`; direct installs (`npx -y htmlradar-mcp`) always run the latest.

## 0.2.0 — 2026-08-31

The server could publish and it could report. It could not find anything it had not just made, make
a second link for a document, put new contents behind links already sent, or take a link down.
This release is those four.

### Added

- `create_share` makes another tracked link for a document that already exists, with its own
  recipient label, gate, password, expiry and address. Sending one deck to twenty people is now one
  stored document and twenty links rather than twenty copies, which is also how the dashboard was
  designed to read. It uploads nothing.
- `list_shares` lists the account's links, newest first, fifty at a time with a cursor for older
  ones: the slug, the recipient label, the document title, whether it has been opened and when, and
  the share and document ids the other tools take. Without it, `get_share_activity` only worked in
  the conversation that created the link.
- `revoke_share` switches a link off, and back on again with `revoked: false`. It is the undo a
  tool that can publish needed. There is no delete tool and there will not be one: revoking is
  reversible, deleting is not, and deleting stays on the website.
- `replace_document` puts new contents behind every existing link. Same addresses, same settings,
  same reading history, and the recipient sees the new version the next time they open the link
  they already have. The new HTML goes through the same phishing screen every upload does, and the
  previous version is kept in the document's history. Two replacements racing for the same version
  do not overwrite each other: the second one is told that nothing was replaced and that the
  document changed underneath it.
- `get_share_activity` takes `include_detail`, which adds each reader's country, city, device and
  referrer. Off by default on purpose: that is a named person's location and device, and the
  ordinary question — was it read, and which parts — is answered without it.
- API keys can be read-only. A key created as read-only on
  [htmlradar.com/settings](https://htmlradar.com/settings) can list and read activity and is
  refused, with an explanation, on creating, revoking and replacing. Give a watching or reporting
  assistant one of those.

### Changed

- The hourly creation limit is 75 links an hour on Pro, up from 30. Free stays at 30. A hundred
  personalised links now fit inside ninety minutes.
- The Claude Code plugin pins `htmlradar-mcp@0.2.0`.
- The bundle manifest's author URL is now `https://github.com/htmlradar`.

## 0.1.2 — 2026-08-30

### Added

- `share_html` takes `lock_deck`, an optional boolean that defaults to true. Locking a deck blocks
  save and print and adds a watermark; it has always been on for every link made through the API,
  and the setting could only be changed afterwards from the dashboard. Pass `false` for a document
  the recipient is meant to keep a copy of.

### Fixed

- The readable summary no longer disagrees with the raw JSON printed beneath it. Section times were
  rounded to the nearest second, each on its own, so two sections of 2.5 seconds inside a
  five-second visit read as "3s, 3s" — a summary claiming more reading than the visit contained.
  Every figure now rounds down, once, and a section time under a minute keeps its tenth.

### Changed

- The MCP registry name is now `com.htmlradar/share`, a domain-verified namespace, replacing the
  placeholder `io.github.htmlradar/share`.
- `get_share_activity`'s `share_id` parameter and the README now document that a share's slug (the
  part after `/r/` in its link) or the link itself work as well as the plain id — the server has
  accepted all three since the 0.1.1 follow-up fix (`636a76d`).
- The Claude Code plugin pins `htmlradar-mcp@0.1.2`.

## 0.1.1 — 2026-08-30

### Fixed

- The server refuses to start unless `HTMLRADAR_API_KEY` holds a well-formed key, and says which
  of three things is wrong: the variable is not set, it is an unresolved placeholder such as
  `${HTMLRADAR_API_KEY}` (the value Claude Code passes through when the variable was never
  exported), or it is set to something that is not a key. Before this, a missing key surfaced only
  on the first tool call, as "HTMLRadar rejected the API key".
- The README no longer says that publication to npm is pending.

### Changed

- No runtime dependencies. `@modelcontextprotocol/sdk` and `zod` were already bundled into
  `dist/index.js` but were also listed under `dependencies`, so `npx` installed 95 packages that
  were never loaded. They are now pinned devDependencies.
- The Claude Code plugin pins `htmlradar-mcp@0.1.1`.

## 0.1.0 — 2026-08-30

First release.

- Three tools over the public HTMLRadar API: `share_html` publishes HTML as a tracked link,
  `get_share_activity` reports who opened it, for how long, how far they scrolled and which
  sections held them, and `whoami` reports the account, plan and free links used.
- `share_html` takes HTML markup inline and nothing else. There is no file-path argument and the
  server never reads the filesystem; documents over 5 MB are refused before any network call.
- `get_share_activity` puts a notice above the viewer-supplied text (recipient labels, gate
  emails, section titles) saying it is data, not instructions.
- The API key is read from the `HTMLRADAR_API_KEY` environment variable only. `HTMLRADAR_API_URL`
  points the server at a self-hosted instance.
- Ships as one bundled file with a shebang, `mcpName` set to `io.github.htmlradar/share` for the
  official MCP registry, and a `server.json` for the registry publisher.
- The Claude Code plugin (`/plugin marketplace add htmlradar/htmlradar`) runs this package through
  `npx` and adds a skill that teaches Claude when to offer a tracked link.
