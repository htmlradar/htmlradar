// stdio entry point. Nothing may be written to stdout except JSON-RPC frames —
// diagnostics go to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './api.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  // Said once here so somebody running the command by hand sees it at once,
  // and again from every tool call so the assistant can relay it.
  if (config.keyProblem) console.error(`htmlradar-mcp: ${config.keyProblem}`);
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(`htmlradar-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
