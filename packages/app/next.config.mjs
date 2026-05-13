import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the workspace-root .env.local so the monorepo has a single source
// of truth for secrets. Next.js by default only looks in the package
// directory; symlinking .env.local in is awkward across permission
// boundaries, so we just read the file here at config-load time and
// inject any vars that aren't already set in the process env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../.env.local');
if (fs.existsSync(rootEnvPath)) {
  for (const line of fs.readFileSync(rootEnvPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && m[2].length > 0 && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '15mb' },
  },
};

export default nextConfig;
