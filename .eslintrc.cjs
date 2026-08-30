/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  ignorePatterns: [
    'dist/',
    'build/',
    '.next/',
    '.vercel/',
    'node_modules/',
    '*.config.*',
    // Public assets that ship compiled bundles (tracker IIFE etc.)
    'packages/app/public/',
    // Bundled MCP server carried inside the Claude Code plugin — build
    // output of packages/mcp/src, not source.
    'plugins/htmlradar/server/',
  ],
};
