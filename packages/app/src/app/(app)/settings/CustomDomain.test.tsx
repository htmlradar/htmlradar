// @vitest-environment jsdom
//
// Three things about the card are worth pinning: the words a customer is asked
// to follow, the fact that the page does the waiting for them, and the state it
// is all for — Connected, with nothing left to press.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, describe, it, vi } from 'vitest';
import { CustomDomain, instructionsText, type CustomDomainView } from './CustomDomain';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CLOUDFLARE: CustomDomainView = {
  id: 'domain-1',
  hostname: 'decks.draconic.ai',
  state: 'pending',
  securing: false,
  needsReview: false,
  isDefault: false,
  lastCheckedAt: null,
  shortName: 'decks',
  fullName: 'decks.draconic.ai',
  target: 'customers.htmlradar.page',
  registrable: 'draconic.ai',
  provider: {
    name: 'Cloudflare',
    url: 'https://dash.cloudflare.com',
    steps:
      'Open the Cloudflare dashboard, click draconic.ai, then DNS, then Records, then Add record.',
  },
};

const UNKNOWN: CustomDomainView = {
  ...CLOUDFLARE,
  provider: {
    name: 'your domain provider',
    url: null,
    steps: 'Sign in where you bought your domain and find its DNS settings.',
  },
};

describe('the message for whoever manages the website', () => {
  it('carries the domain, the three fields and the provider steps', () => {
    expect(instructionsText(CLOUDFLARE)).toBe(
      [
        'Please add one DNS record for decks.draconic.ai.',
        '',
        'Type: CNAME',
        'Name: decks (some providers want the whole name instead: decks.draconic.ai)',
        'Target: customers.htmlradar.page',
        '',
        'Where to add it: Open the Cloudflare dashboard, click draconic.ai, then DNS, then Records, then Add record. https://dash.cloudflare.com',
        '',
        'This record tells the internet that decks.draconic.ai should point at HTMLRadar. It does not affect anything else on draconic.ai.',
      ].join('\n'),
    );
  });

  it('says where to sign in when we cannot tell who the provider is', () => {
    const text = instructionsText(UNKNOWN);
    expect(text).toContain(
      'Where to add it: Sign in where you bought your domain and find its DNS settings.',
    );
    expect(text).not.toContain('http');
    expect(text).toContain('Target: customers.htmlradar.page');
  });
});

describe('waiting without pressing anything', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = async (domain: CustomDomainView, checkAction: () => Promise<never>) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CustomDomain
          domain={domain}
          eligible
          connectAction={async () => ({ ok: true, state: 'pending', message: '' })}
          checkAction={checkAction}
          disconnectAction={async () => ({ ok: true, state: 'retired', message: '' })}
        />,
      );
    });
    return { host, root };
  };

  it('checks every thirty seconds while the record is missing, and stops once it is Live', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    const checkAction = vi.fn(async () => ({ ok: true, state: 'pending', message: 'Waiting.' }));

    // The row carries the server's own last look, so the card counts from
    // that rather than from the moment the page happened to render.
    const waiting = await mount(
      { ...CLOUDFLARE, lastCheckedAt: new Date().toISOString() },
      checkAction as never,
    );
    expect(waiting.host.textContent).toContain('Add one record where your domain is managed');
    expect(checkAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(checkAction).not.toHaveBeenCalled();
    expect(waiting.host.textContent).toContain('Checked 29 seconds ago.');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(checkAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(checkAction).toHaveBeenCalledTimes(2);

    await act(async () => waiting.root.unmount());
    waiting.host.remove();

    const live = await mount(
      { ...CLOUDFLARE, state: 'live', isDefault: true },
      checkAction as never,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(checkAction).toHaveBeenCalledTimes(2);
    expect(live.host.textContent).not.toContain('Checked');

    await act(async () => live.root.unmount());
    live.host.remove();
  });
});

describe('the card once the domain is connected', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = async (domain: CustomDomainView) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const show = async (next: CustomDomainView) => {
      await act(async () => {
        root.render(
          <CustomDomain
            domain={next}
            eligible
            connectAction={async () => ({ ok: true, state: 'pending', message: '' })}
            checkAction={async () => ({ ok: true, state: 'live', message: '' })}
            disconnectAction={async () => ({ ok: true, state: 'retired', message: '' })}
          />,
        );
      });
    };
    await show(domain);
    return { host, root, show };
  };

  const LIVE: CustomDomainView = { ...CLOUDFLARE, state: 'live', isDefault: true };

  it('says Connected, shows what a link looks like, and offers nothing to press', async () => {
    const { host, root } = await render(LIVE);

    expect(host.textContent).toContain('Connected');
    expect(host.textContent).toContain('Your links now look like');
    expect(host.textContent).toContain('decks.draconic.ai/r/your-deck');
    expect(host.textContent).toContain(
      'Every new link uses it. Links you have already sent stay where they are.',
    );
    // The monitor re-checks hourly, so there is nothing here to press.
    expect(host.textContent).not.toContain('Check again');
    // The beige pill is gone with it.
    expect(host.textContent).not.toContain('Live');

    const cta = host.querySelector('a[href="/docs"]');
    expect(cta?.textContent).toBe('Create a link');
    // The way out stays, quietly.
    expect(host.textContent).toContain('Disconnect');

    await act(async () => root.unmount());
    host.remove();
  });

  it('draws the check in only when the flip happened in front of somebody', async () => {
    const drawn = (host: HTMLElement) => !!host.querySelector('[class*="animate-check-in"]');

    // Arriving at a page that is already live is not news.
    const arrived = await render(LIVE);
    expect(arrived.host.textContent).toContain('Connected');
    expect(drawn(arrived.host)).toBe(false);
    await act(async () => arrived.root.unmount());
    arrived.host.remove();

    // Watching it happen is.
    const watched = await render(CLOUDFLARE);
    expect(drawn(watched.host)).toBe(false);
    await watched.show(LIVE);
    expect(watched.host.textContent).toContain('Connected');
    expect(drawn(watched.host)).toBe(true);
    await act(async () => watched.root.unmount());
    watched.host.remove();
  });

  // Live and not the account's default is unfinished, whatever the row says:
  // new links are still going out on ours, and the button that fixes it has to
  // be there.
  it('keeps the old wording and the button when a live domain is not the default', async () => {
    const { host, root } = await render({ ...LIVE, isDefault: false });
    expect(host.textContent).not.toContain('Connected');
    expect(host.textContent).toContain('Check again');
    expect(host.textContent).not.toContain('Your links now look like');
    await act(async () => root.unmount());
    host.remove();
  });
});
