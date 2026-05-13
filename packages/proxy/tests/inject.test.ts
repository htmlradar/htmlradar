import { describe, expect, it } from 'vitest';
import { geoFromRequest } from '../src/inject.js';

function reqWith(cf: Record<string, unknown> | undefined, ua: string): Request {
  const r = new Request('https://htmlradar.com/r/x', {
    headers: ua ? { 'user-agent': ua } : {},
  });
  if (cf) (r as { cf?: Record<string, unknown> }).cf = cf;
  return r;
}

describe('geoFromRequest', () => {
  it('extracts country + city from Cloudflare request.cf', () => {
    const r = reqWith({ country: 'US', city: 'San Francisco' }, '');
    const geo = geoFromRequest(r);
    expect(geo?.country).toBe('US');
    expect(geo?.city).toBe('San Francisco');
  });

  it('buckets UA strings into desktop/macOS/Safari', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const geo = geoFromRequest(reqWith(undefined, ua));
    expect(geo?.deviceType).toBe('desktop');
    expect(geo?.os).toBe('macOS');
    expect(geo?.browser).toBe('Safari');
  });

  it('buckets a mobile Chrome on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    const geo = geoFromRequest(reqWith(undefined, ua));
    expect(geo?.deviceType).toBe('mobile');
    expect(geo?.os).toBe('Android');
    expect(geo?.browser).toBe('Chrome');
  });

  it('survives an empty UA without throwing', () => {
    const geo = geoFromRequest(reqWith(undefined, ''));
    expect(geo).toEqual({});
  });
});
