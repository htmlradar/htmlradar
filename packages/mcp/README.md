# htmlradar-mcp

An MCP server that turns the HTML your agent just wrote into a tracked link — and lets the same
agent ask, a day later, whether anyone read it.

Most publish-from-an-agent servers stop at "here is a URL". This one keeps the other half: who
opened the page, how long they stayed, how far they scrolled, and which sections held their
attention. So "put this deck online" and "did Acme read the deck?" are both things you can just ask
for.

Three tools, one required environment variable, no telemetry.

---

## Before you start

You need an HTMLRadar API key. Sign in at [htmlradar.com](https://htmlradar.com), open
[Settings](https://htmlradar.com/settings), and create one under **API keys**. Keys look like
`hr_live_…`. The free tier covers two tracked links; after that the server returns an upgrade
message that the agent will relay to you rather than retrying.

> **npm publish is pending.** The `npx -y htmlradar-mcp` lines below are the form to use once the
> package is on npm. Until then, use the from-repo line in each section: clone this repository, run
> `pnpm install && pnpm --filter ./packages/mcp build`, and point your client at the built file.

---

## Install

### Claude Code

Put the key in your shell environment first, so the key itself never becomes a command-line argument:
arguments end up in your shell history and, on most systems, are visible in the process list to
anyone else on the machine.

```
export HTMLRADAR_API_KEY=hr_live_…      # or read it from your password manager
claude mcp add htmlradar -e HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp
```

Or install the Claude Code plugin, which wires the same thing up and adds a skill that teaches
Claude when to offer a tracked link. It reads `HTMLRADAR_API_KEY` from your environment, so there is
nothing to paste at all:

```
/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar
```

The literal form — `-e HTMLRADAR_API_KEY=hr_live_xxx` — works too, and is fine for a throwaway key
you are about to revoke. For a key you intend to keep, prefer the environment variable.

### Cursor

Put this in `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` to make it global:

```json
{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": {
        "HTMLRADAR_API_KEY": "hr_live_xxx"
      }
    }
  }
}
```

Cursor resolves `${env:NAME}` inside `env`, so write
`"HTMLRADAR_API_KEY": "${env:HTMLRADAR_API_KEY}"` and export the key in your shell — that keeps it
out of a file you might commit. The literal `hr_live_xxx` above is the fallback if you would rather
not.

### Codex CLI

```
export HTMLRADAR_API_KEY=hr_live_…
codex mcp add htmlradar --env HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp
```

Or write it into `~/.codex/config.toml` yourself:

```toml
[mcp_servers.htmlradar]
command = "npx"
args = ["-y", "htmlradar-mcp"]
env = { HTMLRADAR_API_KEY = "hr_live_xxx" }
```

Again, a key passed as a literal argument lands in your shell history; a key read from the
environment does not.

### Any other MCP client

It is a plain stdio server. Run `npx -y htmlradar-mcp` (or `node dist/index.js`) with
`HTMLRADAR_API_KEY` set.

---

## Configuration

| Variable            | Required | Default                 | What it does                                           |
| ------------------- | -------- | ----------------------- | ------------------------------------------------------ |
| `HTMLRADAR_API_KEY` | yes      | —                       | Your API key from htmlradar.com/settings.              |
| `HTMLRADAR_API_URL` | no       | `https://htmlradar.com` | Point at your own instance if you self-host HTMLRadar. |

---

## Tools

### `share_html`

Publishes HTML as a tracked link. Pass the markup itself in `html`, up to 5 MB. The tool does not
read files: if the document is already on disk, the agent reads it with its own file tools and
passes the contents, so whatever permissions you set on those tools still apply. Everything else is
optional: `title`, `recipient_label`, `require_email` (on by default), `password`,
`allowed_email_domains`, `expires_in_hours`, `slug`.

Returns the tracked link, the sender dashboard link, the share id, and a reminder of what the
recipient sees — the document, and nothing about the tracking.

> Share this deck with Acme as a tracked link, email gate on.

> Read ./proposal.html and turn it into a tracked link for hello@acme.com, expiring in 72 hours.

### `get_share_activity`

Takes a `share_id` and reports whether the link was opened, by whom, when they first opened it, how
long they were actively reading, how far they scrolled, and which sections took the most time. The
raw JSON is appended after the summary so the agent can compute on it.

> Did anyone read the proposal I shared yesterday?

> Which sections of the Acme deck did they actually spend time on?

### `whoami`

Reports the account, its plan, and how many free tracked links are used. Useful before creating a
share on a free account.

> How many free HTMLRadar links do I have left?

---

## What the recipient sees

The document, as written. They are asked for an email address first unless you pass
`require_email: false`. They never see the tracking, the dashboard, or anyone else who opened the
link. HTMLRadar stores no raw IP address, no keystrokes, no mouse positions and no session replay,
and recipients can opt out with `window.HTMLRadar.optOut()`.

## Privacy of the server itself

No telemetry, no analytics, no phoning home. The only network calls this server makes are to
`HTMLRADAR_API_URL` — by default `https://htmlradar.com` — and only when you call a tool.

---

## Development

```bash
pnpm --filter ./packages/mcp build      # bundles src/ into dist/index.js
pnpm --filter ./packages/mcp typecheck
pnpm --filter ./packages/mcp test       # vitest, fetch mocked, no network
pnpm --filter ./packages/mcp smoke      # starts the built server and lists its tools over stdio
```

To run an unpublished build, point your client at `node /path/to/htmlradar/packages/mcp/dist/index.js`
instead of `npx -y htmlradar-mcp`.

Licensed AGPL-3.0-or-later, like the rest of HTMLRadar.
