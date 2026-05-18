import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestamp } from './format-timestamp';

// Anchor "now" so the relative ranges are deterministic. Pick a
// mid-year date so same-year/different-year branches are easy to
// exercise alongside it.
const NOW = new Date('2026-06-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function minus(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('formatTimestamp', () => {
  it('returns em-dash for null / undefined / empty', () => {
    expect(formatTimestamp(null).display).toBe('—');
    expect(formatTimestamp(undefined).display).toBe('—');
    expect(formatTimestamp('').display).toBe('—');
    expect(formatTimestamp('not-a-date').display).toBe('—');
  });

  it('< 1 minute → "just now"', () => {
    expect(formatTimestamp(minus(10_000)).display).toBe('just now');
  });

  it('< 1 hour → minutes', () => {
    expect(formatTimestamp(minus(5 * 60_000)).display).toBe('5m ago');
    expect(formatTimestamp(minus(59 * 60_000)).display).toBe('59m ago');
  });

  it('< 24 hours → hours (both modes)', () => {
    expect(formatTimestamp(minus(6 * 60 * 60_000), 'recent').display).toBe('6h ago');
    expect(formatTimestamp(minus(6 * 60 * 60_000), 'auto').display).toBe('6h ago');
    expect(formatTimestamp(minus(23 * 60 * 60_000), 'auto').display).toBe('23h ago');
  });

  it('"recent" mode keeps relative up to 30 days', () => {
    expect(formatTimestamp(minus(1 * 24 * 60 * 60_000), 'recent').display).toBe('1d ago');
    expect(formatTimestamp(minus(7 * 24 * 60 * 60_000), 'recent').display).toBe('7d ago');
    expect(formatTimestamp(minus(29 * 24 * 60 * 60_000), 'recent').display).toBe('29d ago');
  });

  it('"recent" mode falls back to date past 30 days', () => {
    const out = formatTimestamp(minus(60 * 24 * 60 * 60_000), 'recent').display;
    // Locale-dependent format but it should NOT be "60d ago"
    expect(out).not.toMatch(/ago$/);
  });

  it('"auto" mode switches to absolute date at 24h+', () => {
    // 25 hours ago (same calendar year as NOW=2026-06-15) → "Jun 14"
    const out25h = formatTimestamp(minus(25 * 60 * 60_000), 'auto').display;
    expect(out25h).not.toMatch(/ago$/);
    expect(out25h).toMatch(/Jun/);
    expect(out25h).not.toMatch(/2026/); // same year → no year in display

    // 3 days ago → still "Jun 12" form (no relative, no year)
    const out3d = formatTimestamp(minus(3 * 24 * 60 * 60_000), 'auto').display;
    expect(out3d).not.toMatch(/ago$/);
    expect(out3d).toMatch(/Jun/);
  });

  it('"auto" mode includes year when timestamp is from a different year', () => {
    // 200 days ago from 2026-06-15 → 2025-Nov-something. Different year.
    const out = formatTimestamp(minus(200 * 24 * 60 * 60_000), 'auto').display;
    expect(out).toMatch(/2025/);
  });

  it('always returns a non-empty full timestamp for valid input (tooltip use)', () => {
    expect(formatTimestamp(minus(60_000)).full).not.toBe('');
    expect(formatTimestamp(minus(30 * 24 * 60 * 60_000), 'auto').full).not.toBe('');
  });

  it('full timestamp is empty for invalid input', () => {
    expect(formatTimestamp(null).full).toBe('');
    expect(formatTimestamp('not-a-date').full).toBe('');
  });
});
