// The built binary, launched the way a client launches it.
//
// tools.test.ts calls the handlers in process, which cannot catch the failure
// this release exists to remove: a server that exits at startup. Claude Code's
// plugin forwards `${HTMLRADAR_API_KEY}` verbatim when the variable was never
// exported, and until 0.3.0 that killed the process while the client went on
// reporting the server as connected (Sol, 0.3.0 review, 2).

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(packageRoot, 'dist/index.js');

const WELL_FORMED_KEY = `hr_live_${'0'.repeat(40)}`;
const PLACEHOLDER = '${HTMLRADAR_API_KEY}';

/** Only the parts of a JSON-RPC response these tests read. */
interface JsonRpcResponse {
  id?: number;
  result: {
    serverInfo?: { name: string; version: string };
    tools?: { name: string }[];
    isError?: boolean;
    content?: { text: string }[];
  };
}

const TOOL_NAMES = [
  'create_share',
  'get_share_activity',
  'list_shares',
  'replace_document',
  'revoke_share',
  'share_html',
  'whoami',
];

/** One live server, spoken to over stdio exactly as a client would. */
class Server {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: JsonRpcResponse) => void>();
  private buffer = '';
  stderr = '';

  constructor(env: Record<string, string>) {
    // The key is deleted first so this machine's own exported value, if any,
    // cannot leak into a test that is about not having one.
    const base = { ...process.env } as Record<string, string>;
    delete base['HTMLRADAR_API_KEY'];
    this.child = spawn('node', [entry], {
      env: { ...base, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child.stderr.on('data', (chunk) => (this.stderr += String(chunk)));
    this.child.stdout.on('data', (chunk) => {
      this.buffer += String(chunk);
      let index: number;
      while ((index = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line) as JsonRpcResponse;
        if (message.id !== undefined) this.pending.get(message.id)?.(message);
      }
    });
  }

  request(id: number, method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve_, reject) => {
      this.pending.set(id, resolve_);
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 15_000);
      timer.unref();
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  get running(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  stop(): void {
    this.child.kill();
  }
}

let server: Server | undefined;

beforeAll(() => {
  // Always rebuilt, never reused: CI runs `pnpm test` without building first,
  // and a stale dist/index.js would let this file pass against code that is
  // no longer the code under test.
  const build = spawnSync('node', ['esbuild.config.mjs'], { cwd: packageRoot, stdio: 'inherit' });
  expect(build.status, 'esbuild').toBe(0);
  expect(existsSync(entry), `${entry} exists`).toBe(true);
}, 60_000);

afterEach(() => {
  server?.stop();
  server = undefined;
});

async function handshake(env: Record<string, string>) {
  server = new Server(env);
  const init = await server.request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'process-test', version: '0.0.0' },
  });
  server.notify('notifications/initialized');
  const list = await server.request(2, 'tools/list', {});
  return { init, list, server };
}

describe('the built server, launched as a client launches it', () => {
  it.each([
    ['with no HTMLRADAR_API_KEY at all', {}, /HTMLRADAR_API_KEY is not set/],
    [
      "with the plugin's unexpanded ${HTMLRADAR_API_KEY}",
      { HTMLRADAR_API_KEY: PLACEHOLDER },
      /unresolved placeholder/,
    ],
    ['with a key that is not a key', { HTMLRADAR_API_KEY: 'nonsense' }, /does not look like/],
  ])(
    'stays alive %s, lists seven tools, and answers with the next step',
    async (_name, env, expected) => {
      const { init, list, server: live } = await handshake(env);

      expect(init.result.serverInfo?.name).toBe('htmlradar');
      expect((list.result.tools ?? []).map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);

      // Every one of the seven, over the wire, with arguments the schema accepts.
      const calls: [string, Record<string, unknown>][] = [
        ['whoami', {}],
        ['list_shares', {}],
        ['get_share_activity', { share_id: 'shr_1' }],
        ['share_html', { html: '<p>hello</p>' }],
        ['create_share', { document_id: 'doc_1' }],
        ['revoke_share', { share_id: 'shr_1' }],
        ['replace_document', { document_id: 'doc_1', html: '<p>hello</p>' }],
      ];
      let id = 10;
      for (const [name, args] of calls) {
        const response = await live.request(id++, 'tools/call', { name, arguments: args });
        expect(response.result.isError, name).toBe(true);
        const text = response.result.content?.[0]?.text ?? '';
        expect(text, name).toMatch(expected);
        expect(text, name).toMatch(/htmlradar\.com\/settings/);
      }

      // The diagnostic goes to stderr, where it cannot corrupt the JSON-RPC
      // stream on stdout, and the process is still serving.
      expect(live.stderr).toMatch(expected);
      expect(live.running, 'still running').toBe(true);
    },
    30_000,
  );

  it('handshakes normally with a well-formed key and prints nothing to stderr', async () => {
    const { init, list, server: live } = await handshake({ HTMLRADAR_API_KEY: WELL_FORMED_KEY });
    expect(init.result.serverInfo?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(list.result.tools).toHaveLength(7);
    expect(live.stderr).toBe('');
    expect(live.running).toBe(true);
  }, 30_000);
});
