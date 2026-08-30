// stdio entry point. Nothing may be written to stdout except JSON-RPC frames —
// diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './api.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer(loadConfig());
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(`htmlradar-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
