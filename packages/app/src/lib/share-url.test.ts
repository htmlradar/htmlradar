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

// ---------------------------------------------------------------------------
// The handle link shape (schema/043, the trust layer's Gate 2).
//
// Every one of these is about the SAME property: the second argument is the
// share's own stored hostname, and without one the address is byte for byte
// what this module returned before handles existed. That is the whole of the
// gate-off guarantee on the application side — with the gate off nothing ever
// stamps `host_handle`, so nothing ever passes a second argument, so no link
// changes.
// ---------------------------------------------------------------------------

describe('a share that stores no hostname', () => {
  it('is byte-identical to the apex link, however the absence is spelled', async () => {
    const { shareUrl } = await load(undefined);
    const apex = 'https://htmlradar.page/r/acme-proposal';
    expect(shareUrl('acme-proposal')).toBe(apex);
    expect(shareUrl('acme-proposal', null)).toBe(apex);
    expect(shareUrl('acme-proposal', undefined)).toBe(apex);
    expect(shareUrl('acme-proposal', '')).toBe(apex);
  });

  it('prints the apex label, exactly as the pages built it by hand before', async () => {
    const { shareUrlLabel, SHARE_HOST } = await load(undefined);
    expect(shareUrlLabel('acme-proposal', null)).toBe(`${SHARE_HOST}/r/acme-proposal`);
  });
});

describe('a share that stores a hostname', () => {
  it('is served from the owner’s own subdomain', async () => {
    const { shareUrl } = await load(undefined);
    expect(shareUrl('acme-proposal', 'lumenforge')).toBe(
      'https://lumenforge.htmlradar.page/r/acme-proposal',
    );
  });

  it('prints the same address without the scheme', async () => {
    const { shareUrlLabel } = await load(undefined);
    expect(shareUrlLabel('acme-proposal', 'lumenforge')).toBe(
      'lumenforge.htmlradar.page/r/acme-proposal',
    );
  });

  // A self-hoster who never turns handles on never gets one, but the shape
  // must not be wired to our own domain or theirs would be wrong the day
  // they do.
  it('follows a self-hoster’s own base and scheme', async () => {
    const { shareUrl } = await load('http://docs.example.org/');
    expect(shareUrl('x-y-z', 'acme')).toBe('http://acme.docs.example.org/r/x-y-z');
  });
});

// ---------------------------------------------------------------------------
// One builder, and only one
//
// A hand-built `${SHARE_HOST}/r/${slug}` is how the dashboard ends up showing
// an apex address next to a copy button that copies a handle address. Three
// pages did exactly that before this lane; the property is cheap to keep, so
// it is checked rather than remembered.
// ---------------------------------------------------------------------------

describe('every share address in the app', () => {
  it('is assembled here and nowhere else', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');

    const root = fileURLToPath(new URL('../', import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
          sources.push(full);
      }
    };
    walk(root);

    // The two knowingly hand-built addresses, each named rather than pattern-
    // matched so a third cannot join them quietly:
    //   share-url.ts   — the builder itself.
    //   ShareCardList  — the prefix beside the "name your link" field, which
    //                    describes a share that does not exist yet and so has
    //                    no stored hostname to build from. Deferred with a
    //                    ponytail marker at the source.
    const ALLOWED = ['lib/share-url.ts', 'docs/[id]/v2/ShareCardList.tsx'];

    const offenders = sources.filter((file) => {
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) return false;
      return readFileSync(file, 'utf8')
        .split('\n')
        .some(
          (line) =>
            /SHARE_BASE|SHARE_HOST/.test(line) &&
            line.includes('/r/') &&
            // The sender-side raw-document preview. Not a share, so it has no
            // stored hostname and stays on the apex by construction.
            !line.includes('/r/_doc/'),
        );
    });

    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });
});
