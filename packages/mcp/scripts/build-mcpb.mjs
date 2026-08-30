/* eslint-env node */
// Builds dist/htmlradar.mcpb, an MCP Bundle: a zip of the bundled server plus a
// manifest.json, per https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md.
// Claude Desktop installs one with a click and asks for the API key itself.
// Run `pnpm build:mcpb`. The bundle is staged in dist/mcpb and packed by the
// official mcpb CLI, which also validates the manifest.

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const stage = 'dist/mcpb';
const out = 'dist/htmlradar.mcpb';

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
  author: { name: 'HTMLRadar', email: 'hello@htmlradar.com', url: 'https://htmlradar.com' },
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
    { name: 'share_html', description: 'Publish an HTML document as a tracked link.' },
    {
      name: 'get_share_activity',
      description: 'Report who opened a tracked link, for how long, and which sections they read.',
    },
    { name: 'whoami', description: 'Show the HTMLRadar account, plan and free links used.' },
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
mcpb('validate', `${stage}/manifest.json`);
mcpb('pack', stage, out);
