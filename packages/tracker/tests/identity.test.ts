import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_REGEX,
  getFingerprint,
  isOptedOut,
  optOut,
  setStoredEmail,
  getStoredEmail,
} from '../src/identity.js';

describe('EMAIL_REGEX', () => {
  it('accepts conventional addresses', () => {
    expect(EMAIL_REGEX.test('alice@example.com')).toBe(true);
    expect(EMAIL_REGEX.test('alice+filter@example.co.uk')).toBe(true);
    expect(EMAIL_REGEX.test('a.b.c@x.y.z')).toBe(true);
  });

  it('rejects junk that audit F-27 used to accept', () => {
    expect(EMAIL_REGEX.test('a.@b')).toBe(false); // no TLD
    expect(EMAIL_REGEX.test('@.')).toBe(false);
    expect(EMAIL_REGEX.test('a@b.')).toBe(false);
    expect(EMAIL_REGEX.test('a b@c.com')).toBe(false); // whitespace
  });
});

describe('identity storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the same fingerprint across calls', () => {
    const fp1 = getFingerprint();
    const fp2 = getFingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBeGreaterThan(10);
  });

  it('persists email + reads it back', () => {
    setStoredEmail('marc@example-ventures.test');
    expect(getStoredEmail()).toBe('marc@example-ventures.test');
  });

  it('optOut clears fingerprint+email and sets flag', () => {
    setStoredEmail('marc@example-ventures.test');
    getFingerprint();
    optOut();
    expect(isOptedOut()).toBe(true);
    expect(getStoredEmail()).toBe(null);
  });
});
