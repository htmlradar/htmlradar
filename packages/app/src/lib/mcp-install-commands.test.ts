import { describe, expect, it } from 'vitest';
import { mcpInstallCommands } from './mcp-install-commands';

// These strings are what a customer pastes into a terminal or a config file
// straight after creating a key, so they are pinned character for character
// against packages/mcp/README.md. If the README changes a flag, an argument or
// a file name and this file is not changed with it, these cases fail — which
// is the whole point of pinning them.

// Deliberately a repeating pattern rather than random-looking hex. A real key
// is 40 hexadecimal characters, and a realistic fixture has enough entropy that
// the gitleaks step in CI reports it as a leaked credential. Keep the repeat.
const KEY = 'hr_live_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const EXPECTED: Record<string, string> = {
  'claude-code-plugin': `export HTMLRADAR_API_KEY=${KEY}
# then start Claude Code in that same terminal and run:
/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar`,

  'claude-code-add': `claude mcp add htmlradar -e HTMLRADAR_API_KEY=${KEY} -- npx -y htmlradar-mcp`,

  cursor: `{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": { "HTMLRADAR_API_KEY": "${KEY}" }
    }
  }
}`,

  codex: `codex mcp add htmlradar --env HTMLRADAR_API_KEY=${KEY} -- npx -y htmlradar-mcp`,

  'claude-desktop': `{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": { "HTMLRADAR_API_KEY": "${KEY}" }
    }
  }
}`,
};

describe('mcpInstallCommands', () => {
  const rows = mcpInstallCommands(KEY);

  it('leads with the simplest Claude Code path, then covers the four clients', () => {
    expect(rows.map((r) => r.id)).toEqual([
      'claude-code-plugin',
      'claude-code-add',
      'cursor',
      'codex',
      'claude-desktop',
    ]);
  });

  for (const [id, code] of Object.entries(EXPECTED)) {
    it(`builds the ${id} command exactly as packages/mcp/README.md documents it`, () => {
      const row = rows.find((r) => r.id === id);
      expect(row?.code).toBe(code);
    });
  }

  it('puts the real key into every command, never a placeholder', () => {
    for (const row of rows) {
      expect(row.code).toContain(KEY);
      expect(row.code).not.toContain('hr_live_…');
      expect(row.code).not.toContain('$HTMLRADAR_API_KEY');
      expect(row.code).not.toContain('${env:HTMLRADAR_API_KEY}');
    }
  });

  it('gives every row a client name, a paste target and a note', () => {
    for (const row of rows) {
      expect(row.client.length).toBeGreaterThan(0);
      expect(row.where.length).toBeGreaterThan(0);
      expect(row.note.length).toBeGreaterThan(0);
    }
  });
});
