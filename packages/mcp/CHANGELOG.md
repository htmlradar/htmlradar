# Changelog

All notable changes to `htmlradar-mcp`. The plugin at `plugins/htmlradar` pins one of these versions
in its `.mcp.json`; direct installs (`npx -y htmlradar-mcp`) always run the latest.

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
