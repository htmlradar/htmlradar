import { describe, it, expect } from 'vitest';
import { countDistinctViewers } from './viewer-metrics';

describe('countDistinctViewers', () => {
  it('dedupes by case-insensitive, trimmed email', () => {
    expect(
      countDistinctViewers([
        { email: 'A@example.com' },
        { email: 'a@example.com' },
        { email: ' a@example.com ' },
      ]),
    ).toBe(1);
  });

  it('counts each anonymous (no-email) viewer individually', () => {
    expect(countDistinctViewers([{ email: null }, { email: null }, { email: '' }])).toBe(3);
  });

  it('mixes deduped emails with anonymous rows', () => {
    expect(
      countDistinctViewers([
        { email: 'a@example.com' },
        { email: 'a@example.com' },
        { email: 'b@example.com' },
        { email: null },
      ]),
    ).toBe(3);
  });

  it('returns 0 for no viewers', () => {
    expect(countDistinctViewers([])).toBe(0);
  });
});
