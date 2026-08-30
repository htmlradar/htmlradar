/* eslint-env node */
/* eslint-disable no-console -- printing the tool list is the whole point */
// Starts the built server as a real subprocess and speaks MCP over stdio:
// initialize -> initialized -> tools/list. Proves the shebang, the bundle and
// the transport all work outside vitest. No network: the key is fake and no
// tool is called.

import { spawn } from 'node:child_process';

const child = spawn('node', ['dist/index.js'], {
  env: { ...process.env, HTMLRADAR_API_KEY: 'hr_live_' + '0'.repeat(40) },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
const pending = new Map();
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  }
});

const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 10_000).unref();
    send({ jsonrpc: '2.0', id, method, params });
  });

const init = await request(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'htmlradar-smoke', version: '0.0.0' },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const list = await request(2, 'tools/list', {});
child.kill();

const server = init.result.serverInfo;
console.log(
  `initialize: ${server.name} ${server.version} (protocol ${init.result.protocolVersion})`,
);
for (const tool of list.result.tools) {
  const hints = Object.entries(tool.annotations ?? {})
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`- ${tool.name} — "${tool.annotations?.title ?? ''}" [${hints}]`);
  console.log(
    `    input: ${Object.keys(tool.inputSchema?.properties ?? {}).join(', ') || '(none)'}`,
  );
}
if (list.result.tools.length !== 3) {
  console.error(`expected 3 tools, got ${list.result.tools.length}`);
  process.exit(1);
}
