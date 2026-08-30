import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGlobalApi } from '../src/api.js';
import { isOptedOut } from '../src/identity.js';
import type { Session } from '../src/session.js';

// window.HTMLRadar.optOut().
//
// The local flag it writes cannot be trusted to survive: documents served
// through the proxy run under a `sandbox` CSP with no allow-same-origin, so
// localStorage throws there. The durable half of the opt-out is the reload
// with ?optout=1 — the proxy answers that with a cookie and a copy of the
// document that has no tracker in it at all.

const realLocation = window.location;

function stubLocation(href: string): ReturnType<typeof vi.fn> {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, replace },
  });
  return replace;
}

function fakeSession(): Session {
  return { stop: vi.fn(), flush: vi.fn(async () => undefined) } as unknown as Session;
}

function install(session: Session) {
  return installGlobalApi({ session, ready: Promise.resolve(null), version: 'test' });
}

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  localStorage.clear();
  vi.clearAllMocks();
});

describe('optOut()', () => {
  it('reloads the current page with optout=1', () => {
    const replace = stubLocation('https://htmlradar.com/r/acme-proposal');
    install(fakeSession()).optOut();
    expect(replace).toHaveBeenCalledWith('https://htmlradar.com/r/acme-proposal?optout=1');
  });

  it('keeps the other query parameters on the way', () => {
    const replace = stubLocation('https://htmlradar.com/r/acme-proposal?page=3&ref=email');
    install(fakeSession()).optOut();
    expect(replace).toHaveBeenCalledWith(
      'https://htmlradar.com/r/acme-proposal?page=3&ref=email&optout=1',
    );
  });

  it('does not stack a second optout param when one is already there', () => {
    const replace = stubLocation('https://htmlradar.com/r/acme-proposal?optout=0');
    install(fakeSession()).optOut();
    expect(replace).toHaveBeenCalledWith('https://htmlradar.com/r/acme-proposal?optout=1');
  });

  it('stops in-page tracking immediately, before the reload lands', () => {
    stubLocation('https://htmlradar.com/r/acme-proposal');
    const session = fakeSession();
    install(session).optOut();
    expect(session.stop).toHaveBeenCalled();
    expect(isOptedOut()).toBe(true);
  });
});
