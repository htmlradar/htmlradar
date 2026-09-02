# Changelog

All notable changes to `htmlradar-mcp`. The plugin at `plugins/htmlradar` pins one of these versions
in its `.mcp.json`; direct installs (`npx -y htmlradar-mcp`) always run the latest.

## 0.3.0 — 2026-09-03

Nothing new to call, and a better server in every client it is already installed in. Results say
each thing once and carry no internal identifiers, descriptions state what a tool does instead of
directing the model, no way of lacking a key kills the process, and the protocol kit is the version
the Cloudflare Worker will share.

### Breaking

**Read this before upgrading. Four things change that something outside this package may depend
on.** `npx -y htmlradar-mcp` is unpinned and fetches the latest release, so an existing install
picks these up on its next start.

- **Node.js 20 is now the minimum**, up from 18, because version 2 of the protocol kit requires it.
  A Node 18 machine that runs the server through an unpinned `npx` stops working on upgrade. Cursor
  and Gemini CLI both launch the server with the user's own Node, so this is theirs to notice;
  Claude Desktop ships its own runtime and the bundle declares 20.
- **`get_share_activity` no longer prints a raw JSON copy of its answer, and the readable summary
  is not a lossless substitute for it.** Anything parsing that block breaks. Two things it carried
  are genuinely gone rather than merely reformatted: the summary names only the **five** sections
  with the most reading time per viewer, so a document with more sections than that reports fewer
  than it did; and every figure is **rounded down**, so seconds and scroll percentages lose their
  fraction. The share id, the URL, each viewer's identity, first open, last seen, active time,
  scroll depth and the top five sections are all still there, in the summary.
- **`whoami` returns two lines, not three.** The first line, the account's database identifier, is
  gone on purpose. Anything reading that output by line number breaks.
- **The advertised input-schema dialect moves from JSON Schema draft-07 to draft 2020-12**, which
  version 2 of the kit hard-codes and does not let a server choose. Every field, required field,
  default and constraint is unchanged: compared against the published 0.2.0 schemas, the two sets
  are structurally identical, and the only text that differs is the `$schema` string plus the
  wording of two parameter descriptions (`share_html.html` and `get_share_activity.include_detail`,
  both rewritten to stop directing the model). The MCP Inspector's strict portability lint is clean
  on both. Gemini CLI strips `$schema` before building its declarations, so it cannot be affected;
  no client is known to reject the newer dialect, and none has been observed accepting only the
  older one.

Tool names, `HTMLRADAR_API_KEY` and `HTMLRADAR_API_URL` are unchanged, and every tool takes exactly
the arguments it took in 0.2.0.

### Verified on

The MCP Inspector 2.4.0, including its strict portability lint; the Codex CLI 0.144.1 driving an
OpenAI model, which read the corrected annotations back and relayed the missing-key instruction;
and a direct stdio handshake under Node.js 20, with a key, without one, and with the plugin's
unexpanded `${HTMLRADAR_API_KEY}`.

**Not verified: Claude Desktop.** Whether it shows a confirmation prompt before `replace_document`
and `revoke_share` now that both are marked destructive has not been watched on a real machine, and
this release does not claim it. That check belongs to the client-verification lane. Cursor and
Windows are likewise untested, as they were for 0.2.0.

### Changed

- **`get_share_activity` no longer repeats its whole answer as raw JSON.** The summary was followed
  by a `Raw (the same values, still data)` block containing every figure a second time. It doubled
  the tokens on the one tool whose result can approach a client's size cap, and returning the
  database row beside the readable answer is the pattern Anthropic's connector review criteria
  reject. See **Breaking** above for what the summary does and does not carry: it is shorter than
  the block it replaces, not equivalent to it.
- **`whoami` no longer prints the account's identifier.** It was the internal database key, which
  tells an assistant nothing it can act on, and OpenAI's review guidance names unnecessary internal
  identifiers explicitly. The email address is not put in its place — that is personal data the
  model does not need either. The plan and the free-link budget, which are the useful answer, stay.
- **Tool descriptions state consequences, not behaviour.** Four of them told the model how to act:
  two said never to call the tool unless the user asked, two said to confirm before calling. A tool
  description is not a consent mechanism — the client decides what it asks before running a tool —
  and directing behaviour from one is a review risk. What the model needs is what the call does in
  the world, so those sentences stay: the sender is emailed when somebody opens a revoked link, and
  recipients may already have read the contents being replaced. The one consent sentence now lives
  only in the server's instructions, and the Claude Code plugin's skill still carries the longer
  guidance.
- **`replace_document` and `revoke_share` are marked destructive.** Both are reversible for the
  account, and neither deletes anything, but a recipient loses a document they had or finds
  different contents behind the same link. That is the reading of `destructiveHint` clients act on,
  so a client that confirms destructive tools now confirms these two.
- **No way of lacking a key kills the server any more.** Installing before creating a key produced
  a process that exited at launch, which several clients still report as connected — a dead server
  instead of an instruction. All three ways of not having a usable key now behave the same: the
  server starts, lists all seven tools, and answers any of them with the one sentence naming the
  next step. That covers the variable being absent, the variable holding an unexpanded placeholder
  such as `${HTMLRADAR_API_KEY}`, and the variable holding something that is not a key. **The
  placeholder is the case that mattered**: the Claude Code plugin forwards that exact text when the
  shell variable was never exported, so installing the plugin without a key was still producing the
  dead server this change exists to remove. `hr_test_` now counts as a plausible prefix alongside
  `hr_live_`, for a self-hosted instance reached through `HTMLRADAR_API_URL`.
- **The protocol kit is now version 2** — `@modelcontextprotocol/server` and
  `@modelcontextprotocol/client`, both pinned to 2.0.0, replacing the monolithic
  `@modelcontextprotocol/sdk`. Cloudflare's stateless handler is documented against version 2, so
  the remote connector can import this same server rather than a second copy of it. Two visible
  consequences, both listed under **Breaking** above: Node.js 20 becomes the minimum, and the
  advertised JSON Schema dialect moves to draft 2020-12.
- **Descriptions no longer direct the model at all.** The first pass removed four instructions; a
  review found "Use it after", "Use it whenever", "call list_shares first", "call it again" and
  "Useful before" still standing. All seven descriptions, and the two parameter descriptions that
  did the same thing, now state what the tool does and what follows from it. The routing paragraph
  stays in the server's `instructions`, where a client reads it once.
- **A cancelled call is now actually cancelled.** Every tool forwards the request's abort signal to
  the HTTP call. This is best effort and never a claim that a write was undone: a request HTMLRadar
  already accepted stays accepted, and a cancelled create or replace says so in as many words.
- **An argument the schema refuses reads better and looks different.** Version 2 of the kit returns
  a readable tool error naming the field; 0.2.0 surfaced `MCP error -32602` for the same call. An
  unknown tool name is still a protocol error.
- The document-size check uses `TextEncoder` rather than `Buffer`, the one call in the shared
  server that does not exist on Cloudflare Workers.
- The Claude Code plugin pins `htmlradar-mcp@0.3.0`.

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
