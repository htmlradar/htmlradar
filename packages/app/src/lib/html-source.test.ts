import { describe, it, expect } from 'vitest';
import { isHtmlFile, validateSourceUrl } from './html-source';

describe('isHtmlFile', () => {
  it('accepts .html and .htm by name (incl. empty MIME)', () => {
    expect(isHtmlFile('deck.html', '')).toBe(true);
    expect(isHtmlFile('deck.htm', '')).toBe(true);
    expect(isHtmlFile('DECK.HTML', 'application/octet-stream')).toBe(true);
  });
  it('accepts by MIME type', () => {
    expect(isHtmlFile('noext', 'text/html')).toBe(true);
  });
  it('rejects non-HTML', () => {
    expect(isHtmlFile('deck.pdf', 'application/pdf')).toBe(false);
    expect(isHtmlFile('sheet.xlsx', '')).toBe(false);
  });
});

describe('validateSourceUrl', () => {
  it('accepts http/https with a real hostname', () => {
    expect(validateSourceUrl('https://example.com/deck')).toBeNull();
    expect(validateSourceUrl('  http://my.site.io  ')).toBeNull();
  });
  it('rejects missing/invalid scheme', () => {
    expect(validateSourceUrl('example.com')).toMatch(/http/);
    expect(validateSourceUrl('ftp://example.com')).toMatch(/http/);
    expect(validateSourceUrl('javascript:alert(1)')).toMatch(/http/);
  });
  it('rejects hostnames without a dot', () => {
    expect(validateSourceUrl('https://localhost')).toMatch(/hostname/);
  });
});
