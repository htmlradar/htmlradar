import { describe, it, expect } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('passes clean in-app paths (incl. query strings) through unchanged', () => {
    expect(safeNext('/docs')).toBe('/docs');
    expect(safeNext('/docs/123?tab=analytics')).toBe('/docs/123?tab=analytics');
    expect(safeNext('/upgrade?reason=quota')).toBe('/upgrade?reason=quota');
    expect(safeNext('/settings')).toBe('/settings');
  });

  it('defaults missing/empty values to /docs', () => {
    expect(safeNext(null)).toBe('/docs');
    expect(safeNext(undefined)).toBe('/docs');
    expect(safeNext('')).toBe('/docs');
  });

  it('rejects protocol-relative and backslash open-redirects', () => {
    expect(safeNext('//evil.com')).toBe('/docs');
    // The exact shape the sign-in short-circuit used to ACCEPT (regression guard):
    expect(safeNext('/\\evil.com')).toBe('/docs');
    expect(safeNext('/\\/\\evil.com')).toBe('/docs');
  });

  it('rejects absolute URLs and non-path values', () => {
    expect(safeNext('https://evil.com')).toBe('/docs');
    expect(safeNext('http://evil.com')).toBe('/docs');
    expect(safeNext('evil.com')).toBe('/docs');
    expect(safeNext('javascript:alert(1)')).toBe('/docs');
  });
});
