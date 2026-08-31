// The install commands shown once, beside a freshly created API key — the one
// moment the plaintext key exists anywhere outside a hash.
//
// Every string here is the command packages/mcp/README.md documents for that
// client, with the key substituted for the placeholder. mcp-install-commands.test.ts
// pins each one character for character, so if the README moves and this does
// not, the test says so instead of a customer finding out.
//
// Pure string assembly, and deliberately so. It runs in the browser next to a
// key that is already in the tab; nothing here sends, stores, or logs anything.

export type McpInstallCommand = {
  /** Stable id, used as the React key and by the test. */
  id: string;
  /** Client name, as the row's heading. */
  client: string;
  /** Where the copied text is meant to be pasted. */
  where: string;
  /** One sentence of context under the block. */
  note: string;
  /** The exact text the copy button puts on the clipboard. */
  code: string;
};

/** The client config JSON — same shape for Claude Desktop and Cursor. */
function serverJson(key: string): string {
  return `{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": { "HTMLRADAR_API_KEY": "${key}" }
    }
  }
}`;
}

/**
 * The per-client install commands for one key, simplest path first.
 *
 * @param key A plaintext API key, e.g. hr_live_ followed by 40 hex characters.
 */
export function mcpInstallCommands(key: string): McpInstallCommand[] {
  return [
    {
      id: 'claude-code-plugin',
      client: 'Claude Code — plugin',
      where: 'terminal, then Claude Code',
      note: 'The plugin brings the server plus a skill that teaches Claude when to offer a tracked link. It reads the key from the shell that started Claude Code, so the export has to happen first.',
      code: `export HTMLRADAR_API_KEY=${key}
# then start Claude Code in that same terminal and run:
/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar`,
    },
    {
      id: 'claude-code-add',
      client: 'Claude Code — one command',
      where: 'terminal',
      note: 'The server on its own, without the skill. Check it afterwards with claude mcp list.',
      code: `claude mcp add htmlradar -e HTMLRADAR_API_KEY=${key} -- npx -y htmlradar-mcp`,
    },
    {
      id: 'cursor',
      client: 'Cursor',
      where: '.cursor/mcp.json',
      note: 'Project-wide in .cursor/mcp.json, or everywhere in ~/.cursor/mcp.json. Restart Cursor afterwards.',
      code: serverJson(key),
    },
    {
      id: 'codex',
      client: 'Codex CLI',
      where: 'terminal',
      note: 'Writes the entry into ~/.codex/config.toml for you.',
      code: `codex mcp add htmlradar --env HTMLRADAR_API_KEY=${key} -- npx -y htmlradar-mcp`,
    },
    {
      id: 'claude-desktop',
      client: 'Claude Desktop',
      where: 'claude_desktop_config.json',
      note: 'Settings, then Developer, then Edit Config opens the file; paste this in, then quit and reopen Claude Desktop.',
      code: serverJson(key),
    },
  ];
}
