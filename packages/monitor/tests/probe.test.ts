import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHECKS, probe } from '../src/index.js';

// The uptime probe, and what it is pointed at.
//
// The content domain (htmlradar.page) serves every recipient document. It is
// the half of production the founder never looks at, because he only ever
// opens the dashboard, so an outage there is silent to him and total for the
// reader holding the link. These are the checks that make it loud.

// Answers the given responses in order, then repeats the last one, so a retry
// test does not have to spell out three identical answers. Each call gets a
// clone: production returns a fresh Response every time, and a retry would
// otherwise be handed a body the previous attempt had already read.
const stubFetch = (...responses: Response[]) => {
  const queue = [...responses];
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => (queue.length > 1 ? queue.shift()! : queue[0]!).clone());
};

afterEach(() => vi.restoreAllMocks());

describe('the content domain is watched', () => {
  const urls = CHECKS.map((c) => c.url);

  it('probes a share path on it, where a missing share is the healthy answer', () => {
    expect(CHECKS).toContainEqual({
      url: 'https://htmlradar.page/r/nonexistent-smoke-test',
      status: 404,
    });
  });

  it('probes its robots.txt, which has to keep every crawler out', () => {
    expect(CHECKS).toContainEqual({
      url: 'https://htmlradar.page/robots.txt',
      status: 200,
      body: 'Disallow: /',
    });
  });

  it('still watches the four application routes', () => {
    for (const path of ['/', '/pricing', '/docs', '/sign-in']) {
      expect(urls).toContain(`https://htmlradar.com${path}`);
    }
  });
});

describe('probe', () => {
  it('is quiet when a 404-expecting target answers 404', async () => {
    stubFetch(new Response('gone', { status: 404 }));
    expect(await probe({ url: 'https://htmlradar.page/r/x', status: 404 }, 0)).toBeNull();
  });

  it('complains when the share path answers 200, which means the route came loose', async () => {
    stubFetch(new Response('marketing site', { status: 200 }));
    expect(await probe({ url: 'https://htmlradar.page/r/x', status: 404 }, 0)).toBe(
      'returned HTTP 200 (expected 404)',
    );
  });

  it('complains when robots.txt answers 200 without the Disallow line', async () => {
    stubFetch(new Response('User-agent: *\nAllow: /\n', { status: 200 }));
    const problem = await probe(
      { url: 'https://htmlradar.page/robots.txt', status: 200, body: 'Disallow: /' },
      0,
    );
    expect(problem).toBe("returned 200 but the body no longer contains 'Disallow: /'");
  });

  it('is quiet when robots.txt still carries it', async () => {
    stubFetch(new Response('User-agent: *\nDisallow: /\n', { status: 200 }));
    const problem = await probe(
      { url: 'https://htmlradar.page/robots.txt', status: 200, body: 'Disallow: /' },
      0,
    );
    expect(problem).toBeNull();
  });

  it('lets a blip heal: a bad answer followed by a good one is no alert', async () => {
    const spy = stubFetch(new Response('', { status: 503 }), new Response('', { status: 200 }));
    expect(await probe({ url: 'https://htmlradar.com/pricing', status: 200 }, 0)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports a real outage after spending every attempt', async () => {
    const spy = stubFetch(new Response('', { status: 503 }));
    expect(await probe({ url: 'https://htmlradar.com/pricing', status: 200 }, 0)).toBe(
      'returned HTTP 503 (expected 200)',
    );
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('reports a thrown fetch, which is what a timeout looks like', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('The operation was aborted'));
    expect(await probe({ url: 'https://htmlradar.page/robots.txt', status: 200 }, 0)).toBe(
      'fetch threw: The operation was aborted',
    );
  });
});
