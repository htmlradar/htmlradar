/* eslint-env node */
// Builds dist/htmlradar.mcpb, an MCP Bundle: a zip of the bundled server plus a
// manifest.json, per https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md.
// Claude Desktop installs one with a click and asks for the API key itself.
// Run `pnpm build:mcpb`. The bundle is staged in dist/mcpb and packed by the
// official mcpb CLI, which also validates the manifest.

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const stage = 'dist/mcpb';
const out = 'dist/htmlradar.mcpb';
const TOOL_NAMES = [
  'share_html',
  'create_share',
  'list_shares',
  'get_share_activity',
  'revoke_share',
  'replace_document',
  'whoami',
];

// Smithery's release API rejects a manifest whose tools have no inputSchema.
// Rather than re-deriving JSON Schema from the zod shapes in src/server.ts
// (a second copy that could drift), ask the built server itself: tools/list
// runs the exact same zod-to-JSON-schema conversion a real MCP client sees,
// so this cannot go stale.
async function readToolSchemas() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { HTMLRADAR_API_KEY: `hr_live_${'0'.repeat(40)}` },
  });
  const client = new Client({ name: 'build-mcpb', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const schemas = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
    for (const name of TOOL_NAMES) {
      if (!schemas[name]) throw new Error(`tools/list did not return a schema for "${name}"`);
    }
    return schemas;
  } finally {
    await client.close();
  }
}

const toolSchemas = await readToolSchemas();

const manifest = {
  manifest_version: '0.3',
  name: 'htmlradar',
  display_name: 'HTMLRadar',
  version: pkg.version,
  description: 'Share HTML as a tracked link, then ask who read it and which sections held them.',
  long_description:
    'Turns an HTML deck, proposal or report into a tracked HTMLRadar link, and reports back who ' +
    'opened it, how long they read, how far they scrolled and which sections held their ' +
    'attention. Needs an HTMLRadar API key from https://htmlradar.com/settings. Free for two ' +
    'tracked links.',
  // The directories that read this expect the author URL to be the place the
  // source lives, not the product's marketing page.
  author: { name: 'HTMLRadar', email: 'hello@htmlradar.com', url: 'https://github.com/htmlradar' },
  repository: { type: 'git', url: 'https://github.com/htmlradar/htmlradar' },
  homepage: 'https://htmlradar.com/mcp',
  documentation: 'https://htmlradar.com/mcp',
  support: 'https://github.com/htmlradar/htmlradar/issues',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: { HTMLRADAR_API_KEY: '${user_config.api_key}' },
    },
  },
  tools: [
    {
      name: 'share_html',
      description: 'Publish an HTML document as a tracked link.',
      inputSchema: toolSchemas.share_html,
    },
    {
      name: 'create_share',
      description: 'Make another tracked link for a document that already exists.',
      inputSchema: toolSchemas.create_share,
    },
    {
      name: 'list_shares',
      description: "List the account's tracked links, newest first.",
      inputSchema: toolSchemas.list_shares,
    },
    {
      name: 'get_share_activity',
      description: 'Report who opened a tracked link, for how long, and which sections they read.',
      inputSchema: toolSchemas.get_share_activity,
    },
    {
      name: 'revoke_share',
      description: 'Switch a tracked link off, or back on. Never deletes anything.',
      inputSchema: toolSchemas.revoke_share,
    },
    {
      name: 'replace_document',
      description: 'Replace a document, keeping every existing link working.',
      inputSchema: toolSchemas.replace_document,
    },
    {
      name: 'whoami',
      description: 'Show the HTMLRadar account, plan and free links used.',
      inputSchema: toolSchemas.whoami,
    },
  ],
  keywords: ['html', 'tracked-link', 'read-tracking', 'docsend', 'deck', 'proposal'],
  license: pkg.license,
  privacy_policies: ['https://htmlradar.com/privacy'],
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18' } },
  user_config: {
    api_key: {
      type: 'string',
      title: 'HTMLRadar API key',
      description:
        'Created at https://htmlradar.com/settings under "API keys". Starts with hr_live_.',
      sensitive: true,
      required: true,
    },
  },
};

await rm(stage, { recursive: true, force: true });
await mkdir(`${stage}/server`, { recursive: true });
await cp('dist/index.js', `${stage}/server/index.js`);
await writeFile(`${stage}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = (...args) => {
  const result = spawnSync('npx', ['-y', '@anthropic-ai/mcpb@2.1.2', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// @anthropic-ai/mcpb's own manifest schema (unchanged through 2.1.2, the
// current latest) has no tools[].inputSchema field and rejects the key
// outright, so `mcpb pack` refuses to build this bundle as-is -- even though
// Smithery's publish step reads tools[].inputSchema straight out of
// manifest.json and rejects a tool that lacks it. Validate a copy with just
// that field stripped, so every other manifest mistake still gets caught,
// then zip the staged directory ourselves: a .mcpb file is nothing more
// than a zip of manifest.json plus the server, per the MANIFEST.md spec
// linked above.
const strippedManifest = {
  ...manifest,
  tools: manifest.tools.map(({ inputSchema: _inputSchema, ...tool }) => tool),
};
const checkPath = `${stage}/manifest.check.json`;
await writeFile(checkPath, JSON.stringify(strippedManifest, null, 2));
mcpb('validate', checkPath);
await rm(checkPath);

await rm(out, { force: true });
const zipResult = spawnSync('zip', ['-rqX', resolve(out), '.'], { cwd: stage });
if (zipResult.status !== 0) {
  process.stderr.write(zipResult.stderr ?? '');
  process.exit(zipResult.status ?? 1);
}
// eslint-disable-next-line no-console -- replaces the pack summary `mcpb pack` used to print
console.log(`Packed ${out}`);
