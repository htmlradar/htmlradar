// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EventTracker } from './EventTracker';
vi.mock('next/navigation', () => ({ usePathname: () => '/convert' }));
vi.mock('@/lib/events-client', () => ({ captureClientEvent: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
});
it('never sends raw converter errors, and removes query strings from error URLs elsewhere', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async () => ({}));
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/convert?resume=secret-token');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<EventTracker />);
    });
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'private-deck.pdf',
        error: new Error('private slide title'),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/tools/html-to-link?resume=secret-token');
    window.dispatchEvent(new ErrorEvent('error', { message: 'Ordinary page error' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.url).toBe(`${window.location.origin}/tools/html-to-link`);
    expect(JSON.stringify(body)).not.toContain('secret-token');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
