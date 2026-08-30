import { afterEach, describe, expect, it, vi } from 'vitest';

// Where a recipient's link points. Read once at module load, because Next.js
// inlines NEXT_PUBLIC_* at build time — so each case re-imports the module.

const ORIGINAL = process.env.NEXT_PUBLIC_SHARE_BASE;

async function load(base?: string) {
  vi.resetModules();
  if (base === undefined) delete process.env.NEXT_PUBLIC_SHARE_BASE;
  else process.env.NEXT_PUBLIC_SHARE_BASE = base;
  return import('./share-url');
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SHARE_BASE;
  else process.env.NEXT_PUBLIC_SHARE_BASE = ORIGINAL;
});

describe('with no configuration', () => {
  it('builds links on the content domain, not the application domain', async () => {
    const { shareUrl, SHARE_BASE, SHARE_HOST } = await load(undefined);
    expect(SHARE_BASE).toBe('https://htmlradar.page');
    expect(SHARE_HOST).toBe('htmlradar.page');
    expect(shareUrl('acme-proposal')).toBe('https://htmlradar.page/r/acme-proposal');
  });
});

describe('with a self-hoster’s own base', () => {
  it('uses it for the full link', async () => {
    const { shareUrl } = await load('https://docs.example.org');
    expect(shareUrl('acme-proposal')).toBe('https://docs.example.org/r/acme-proposal');
  });

  it('prints the host without the scheme', async () => {
    const { SHARE_HOST } = await load('https://docs.example.org');
    expect(SHARE_HOST).toBe('docs.example.org');
  });

  // Copying the base out of a browser address bar is how you end up with one.
  it('tolerates a trailing slash', async () => {
    const { shareUrl, SHARE_HOST } = await load('https://docs.example.org/');
    expect(SHARE_HOST).toBe('docs.example.org');
    expect(shareUrl('x-y-z')).toBe('https://docs.example.org/r/x-y-z');
  });
});
