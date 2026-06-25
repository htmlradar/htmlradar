import { describe, it, expect } from 'vitest';
import { computeAtCap, FREE_TIER_CAP } from './quota';

describe('free-tier link cap', () => {
  it('cap is 2 tracked links', () => {
    expect(FREE_TIER_CAP).toBe(2);
  });

  it('free user under the cap can still create', () => {
    expect(computeAtCap('free', 0)).toBe(false);
    expect(computeAtCap('free', 1)).toBe(false);
  });

  it('free user at or over the cap is blocked', () => {
    expect(computeAtCap('free', 2)).toBe(true);
    expect(computeAtCap('free', 3)).toBe(true);
  });

  it('pro is never at the cap', () => {
    expect(computeAtCap('pro', 0)).toBe(false);
    expect(computeAtCap('pro', 99)).toBe(false);
  });
});
