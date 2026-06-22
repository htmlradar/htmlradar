import { describe, it, expect } from 'vitest';
import { localInputToIso } from './datetime-local';

describe('localInputToIso', () => {
  it('returns empty for empty input', () => {
    expect(localInputToIso('', -330)).toBe('');
  });

  it('IST (UTC+5:30, offset -330): 09:00 local -> 03:30 UTC', () => {
    expect(localInputToIso('2026-07-01T09:00', -330)).toBe('2026-07-01T03:30:00.000Z');
  });

  it('UTC (offset 0) keeps the wall-clock', () => {
    expect(localInputToIso('2026-07-01T09:00', 0)).toBe('2026-07-01T09:00:00.000Z');
  });

  it('New York EDT (UTC-4, offset 240): 09:00 local -> 13:00 UTC', () => {
    expect(localInputToIso('2026-07-01T09:00', 240)).toBe('2026-07-01T13:00:00.000Z');
  });

  it('is NOT the naive UTC misparse for non-UTC zones (the bug guard)', () => {
    // The old server path did new Date(local).toISOString() in UTC -> 09:00Z.
    // The correct IST instant is 03:30Z.
    expect(localInputToIso('2026-07-01T09:00', -330)).not.toBe('2026-07-01T09:00:00.000Z');
  });
});
