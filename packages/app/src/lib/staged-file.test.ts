import { describe, it, expect } from 'vitest';
import {
  canResume,
  isStale,
  restorableStagedFile,
  shouldDiscardStagedRow,
  validateStagedFile,
  MAX_STAGED_BYTES,
  STAGE_MAX_AGE_MS,
} from './staged-file';

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

const good = {
  name: 'deck.html',
  type: 'text/html',
  contents: '<h1>hi</h1>',
  stagedAt: NOW,
  token: 'tok-1',
};

describe('isStale', () => {
  it('keeps a file staged moments ago', () => {
    expect(isStale(NOW, NOW)).toBe(false);
    expect(isStale(NOW - 60_000, NOW)).toBe(false);
  });

  it('keeps a file staged just under 24 hours ago', () => {
    expect(isStale(NOW - STAGE_MAX_AGE_MS + 1, NOW)).toBe(false);
    expect(isStale(NOW - STAGE_MAX_AGE_MS, NOW)).toBe(false);
  });

  it('discards a file staged more than 24 hours ago', () => {
    expect(isStale(NOW - STAGE_MAX_AGE_MS - 1, NOW)).toBe(true);
    expect(isStale(NOW - 7 * STAGE_MAX_AGE_MS, NOW)).toBe(true);
  });
});

describe('validateStagedFile', () => {
  it('accepts a well-formed record and defaults a missing type', () => {
    expect(validateStagedFile(good, NOW)).toEqual(good);
    expect(validateStagedFile({ ...good, type: '' }, NOW)?.type).toBe('text/html');
    expect(validateStagedFile({ ...good, name: 'deck.HTM' }, NOW)?.name).toBe('deck.HTM');
  });

  it('rejects anything that is not an object', () => {
    for (const row of [null, undefined, 'deck.html', 42, []]) {
      expect(validateStagedFile(row, NOW)).toBeNull();
    }
  });

  it('rejects a name that is empty or not HTML', () => {
    for (const name of ['', '.html', 'deck.pdf', 'deck', 42]) {
      expect(validateStagedFile({ ...good, name }, NOW)).toBeNull();
    }
  });

  it('rejects contents that are not a string', () => {
    expect(validateStagedFile({ ...good, contents: undefined }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, contents: { length: 1 } }, NOW)).toBeNull();
  });

  it('rejects contents over the 30 MB cap', () => {
    expect(
      validateStagedFile({ ...good, contents: 'a'.repeat(MAX_STAGED_BYTES) }, NOW),
    ).not.toBeNull();
    expect(
      validateStagedFile({ ...good, contents: 'a'.repeat(MAX_STAGED_BYTES + 1) }, NOW),
    ).toBeNull();
  });

  it('rejects a record with no usable token', () => {
    expect(validateStagedFile({ ...good, token: '' }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, token: undefined }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, token: 1234 }, NOW)).toBeNull();
  });

  it('rejects a timestamp that is missing, unusable, or older than 24 hours', () => {
    expect(validateStagedFile({ ...good, stagedAt: undefined }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, stagedAt: '2026-08-30' }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, stagedAt: NaN }, NOW)).toBeNull();
    expect(validateStagedFile({ ...good, stagedAt: NOW - STAGE_MAX_AGE_MS - 1 }, NOW)).toBeNull();
  });
});

// What the tool panel asks on every mount, and what readStagedFile does with
// the answer: a usable record goes back on screen, an expired one is deleted,
// and a record we don't recognise is left alone.
describe('restore on mount', () => {
  it('hands back a file staged an hour ago, so a back-navigation can show it again', () => {
    expect(restorableStagedFile({ ...good, stagedAt: NOW - 3_600_000 }, NOW)).toEqual({
      ...good,
      stagedAt: NOW - 3_600_000,
    });
  });

  it('has nothing to restore when the record is expired or malformed', () => {
    expect(restorableStagedFile({ ...good, stagedAt: NOW - STAGE_MAX_AGE_MS - 1 }, NOW)).toBeNull();
    expect(restorableStagedFile({ ...good, name: 'deck.pdf' }, NOW)).toBeNull();
  });

  it('discards a record only for being expired', () => {
    expect(shouldDiscardStagedRow({ ...good, stagedAt: NOW - STAGE_MAX_AGE_MS - 1 }, NOW)).toBe(
      true,
    );
  });

  it('keeps a record that merely fails a shape check', () => {
    // Deleting someone's file because a field check said no loses the file for
    // good; ignoring the record costs one wasted read.
    for (const row of [
      { ...good, name: 'deck.pdf' },
      { ...good, token: '' },
      { ...good, contents: 42 },
      { ...good, stagedAt: 'yesterday' },
      { ...good, stagedAt: NaN },
      'not a record',
      null,
    ]) {
      expect(restorableStagedFile(row, NOW)).toBeNull();
      expect(shouldDiscardStagedRow(row, NOW)).toBe(false);
    }
  });
});

describe('canResume', () => {
  it('resumes only when the URL token equals the staged token', () => {
    expect(canResume(good, 'tok-1')).toBe(true);
    expect(canResume(good, 'tok-2')).toBe(false);
    expect(canResume(good, 'TOK-1')).toBe(false);
  });

  it('refuses when either side is missing', () => {
    expect(canResume(null, 'tok-1')).toBe(false);
    expect(canResume(good, null)).toBe(false);
    expect(canResume(good, undefined)).toBe(false);
    expect(canResume(good, '')).toBe(false);
    expect(canResume(null, null)).toBe(false);
  });
});
