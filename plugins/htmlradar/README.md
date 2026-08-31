# HTMLRadar plugin for Claude Code

Publish the HTML you just generated as a tracked link, then ask who read it.

```
/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar
```

Then set your API key in the shell that launches Claude Code:

```bash
export HTMLRADAR_API_KEY=hr_live_xxx
```

Keys are created at [htmlradar.com/settings](https://htmlradar.com/settings) under **API keys**.

## What you get

- The seven HTMLRadar MCP tools: `share_html` publishes HTML as a tracked link, `create_share`
  makes another link for a document that already exists, `list_shares` lists what you have sent,
  `get_share_activity` reports who read it, `revoke_share` switches a link off, `replace_document`
  puts new contents behind links already sent, and `whoami` reports the account and plan.
- A `share-html` skill that teaches Claude when to offer a tracked link and when to leave it alone.

## How it runs

`.mcp.json` launches the published package with `npx -y htmlradar-mcp@0.2.0` and passes
`HTMLRADAR_API_KEY` through from your environment. Nothing is bundled into the plugin, so a plugin
update and a server update are separate things: bump the pinned version here when you want the
newer server.

The source is [`packages/mcp`](../../packages/mcp) in this repository, AGPL-3.0 like everything else.
