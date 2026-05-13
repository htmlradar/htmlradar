import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl } from '../src/fetch-html.js';

describe('isPublicHttpUrl public-host guard', () => {
  it('accepts ordinary public HTTPS URLs', () => {
    expect(isPublicHttpUrl('https://example.com')).toBe(true);
    expect(isPublicHttpUrl('https://docs.example.com/path')).toBe(true);
    expect(isPublicHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects loopback', () => {
    expect(isPublicHttpUrl('http://localhost')).toBe(false);
    expect(isPublicHttpUrl('http://localhost:8787')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://machine.local')).toBe(false);
  });

  it('rejects RFC-1918 private ranges', () => {
    expect(isPublicHttpUrl('http://10.0.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://172.31.255.255')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254')).toBe(false); // AWS IMDS
  });

  it('allows 172.x outside the private block', () => {
    expect(isPublicHttpUrl('http://172.15.0.1')).toBe(true);
    expect(isPublicHttpUrl('http://172.32.0.1')).toBe(true);
  });

  it('rejects non-HTTP schemes', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isPublicHttpUrl('not a url')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
  });
});
