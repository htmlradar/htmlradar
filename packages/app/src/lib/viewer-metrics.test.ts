import { describe, it, expect } from 'vitest';
import { countDistinctViewers } from './viewer-metrics';

describe('countDistinctViewers', () => {
  it('dedupes by case-insensitive, trimmed email', () => {
    expect(
      countDistinctViewers([{ email: 'A@x.com' }, { email: 'a@x.com' }, { email: ' a@x.com ' }]),
    ).toBe(1);
  });

  it('counts each anonymous (no-email) viewer individually', () => {
    expect(countDistinctViewers([{ email: null }, { email: null }, { email: '' }])).toBe(3);
  });

  it('mixes deduped emails with anonymous rows', () => {
    expect(
      countDistinctViewers([
        { email: 'a@x.com' },
        { email: 'a@x.com' },
        { email: 'b@x.com' },
        { email: null },
      ]),
    ).toBe(3);
  });

  it('returns 0 for no viewers', () => {
    expect(countDistinctViewers([])).toBe(0);
  });
});
