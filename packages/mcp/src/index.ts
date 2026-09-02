// stdio entry point. Nothing may be written to stdout except JSON-RPC frames —
// diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, NO_API_KEY_MESSAGE } from './api.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.apiKey) console.error(`htmlradar-mcp: ${NO_API_KEY_MESSAGE}`);
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(`htmlradar-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
