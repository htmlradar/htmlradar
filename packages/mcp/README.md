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
[Settings](https://htmlradar.com/settings), and create one under **API keys**. A key is `hr_live_`
followed by 40 hexadecimal characters, and it is shown once. The free tier covers two tracked links;
after that the server returns an upgrade message that the agent will relay to you rather than
retrying.

The server refuses to start unless `HTMLRADAR_API_KEY` holds a well-formed key, and the message
says which of three things went wrong: the variable is not set, it is an unresolved placeholder
such as `${HTMLRADAR_API_KEY}`, or it is set to something that is not a key. Some clients report a
server as connected even when it exited at startup, so if a tool call fails, run the command by hand
and read what it printed.

---

## Install

The package is on npm. Every client below runs the same command:

```
npx -y htmlradar-mcp
```

Export the key in your shell first, so the key itself never becomes a command-line argument:
arguments end up in your shell history and, on most systems, are visible in the process list to
anyone else on the machine.

```
export HTMLRADAR_API_KEY=hr_live_…      # or read it from your password manager
```

### Claude Code

```
claude mcp add htmlradar -e HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp
```

### Claude Code plugin

The plugin wires up the same server and adds a skill that teaches Claude when to offer a tracked
link. It reads `HTMLRADAR_API_KEY` from the environment Claude Code was started from, so the
`export` above must happen before you start Claude Code; if it does not, the server receives the
literal text `${HTMLRADAR_API_KEY}` and exits with a message saying so.

```
claude plugin marketplace add htmlradar/htmlradar
claude plugin install htmlradar@htmlradar
```

### Cursor

One-click install:
[cursor://anysphere.cursor-deeplink/mcp/install?name=htmlradar&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImh0bWxyYWRhci1tY3AiXSwiZW52Ijp7IkhUTUxSQURBUl9BUElfS0VZIjoiWU9VUl9LRVkifX0=](cursor://anysphere.cursor-deeplink/mcp/install?name=htmlradar&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImh0bWxyYWRhci1tY3AiXSwiZW52Ijp7IkhUTUxSQURBUl9BUElfS0VZIjoiWU9VUl9LRVkifX0=)
(then replace `YOUR_KEY` with your key in Cursor's MCP settings).

Or put this in `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` to make it global:

```json
{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": {
        "HTMLRADAR_API_KEY": "${env:HTMLRADAR_API_KEY}"
      }
    }
  }
}
```

Cursor resolves `${env:NAME}` inside `env` from your shell, which keeps the key out of a file you
might commit. A literal `"HTMLRADAR_API_KEY": "hr_live_…"` works too.

### Codex CLI

```
codex mcp add htmlradar --env HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp
```

Or write it into `~/.codex/config.toml` yourself:

```toml
[mcp_servers.htmlradar]
command = "npx"
args = ["-y", "htmlradar-mcp"]
env = { HTMLRADAR_API_KEY = "hr_live_…" }
```

### Any other MCP client

It is a plain stdio server. Any client that can launch a command with environment variables can
run it:

```json
{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": {
        "HTMLRADAR_API_KEY": "hr_live_…"
      }
    }
  }
}
```

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

## Security

- `share_html` takes HTML markup inline and nothing else. There is no file-path argument and the
  server never reads the filesystem; the agent reads files with its own tools, under the
  permissions you set on those tools.
- Documents over 5 MB are refused before any network call.
- The API key is read from the `HTMLRADAR_API_KEY` environment variable only. It is never taken
  from an argument, a file or a tool call, and never written to stdout.
- The only network destination is `HTMLRADAR_API_URL`, and the built `dist/index.js` has no runtime
  npm dependencies: everything is bundled into one file.

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
