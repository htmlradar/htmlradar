import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureClientEvent, stripUrlQuery } from './events-client';
const fetchMock = vi.fn(async () => ({}));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    location: { pathname: '/convert', search: '?resume=secret&utm_content=pdf-text' },
  });
  vi.stubGlobal('location', { pathname: '/convert' });
  vi.stubGlobal('document', { referrer: 'https://htmlradar.com/sign-in?next=secret#secret' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it('allows only fixed converter reason codes, never file content or tokens', async () => {
  await captureClientEvent('converter.rejected', {
    reason: 'format',
    filename: 'secret.pdf',
    title: 'secret',
    token: 'secret',
    text: 'secret',
  });
  const payload = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(payload.properties).toEqual({
    reason: 'format',
    path: '/convert',
    referrer: 'https://htmlradar.com/sign-in',
  });
  expect(JSON.stringify(payload)).not.toContain('secret');
  await captureClientEvent('converter.rejected', { reason: 'secret.pdf' });
  const second = JSON.parse(
    (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
  );
  expect(second.properties.reason).toBeUndefined();
  await captureClientEvent('converter.raw_error', { error: 'secret' });
  await captureClientEvent('cta.clicked', { cta: 'secret' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('strips query strings and fragments from captured URLs', () => {
  expect(stripUrlQuery('https://example.com/deck?resume=secret#title')).toBe(
    'https://example.com/deck',
  );
  expect(stripUrlQuery('')).toBeNull();
});
