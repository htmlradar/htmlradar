import { describe, it, expect } from 'vitest';
import {
  RESERVED_SHARE_SLUGS,
  SHARE_SLUG_PATTERN,
  SLUG_FORMAT_MESSAGE,
  SLUG_RESERVED_MESSAGE,
  SLUG_REQUIRES_PRO_MESSAGE,
  SLUG_UNAVAILABLE_MESSAGE,
  describeSlugError,
  normalizeSlugInput,
  validateShareSlug,
} from './share-slug';

// These mirror schema/033_custom_share_slug.sql. The database is the control;
// if these ever disagree with the trigger, the customer sees a confusing
// error, so the cases below are deliberately the same cases as the SQL suite
// in schema/033_custom_share_slug_test.sql.

describe('validateShareSlug', () => {
  it('accepts ordinary chosen addresses', () => {
    expect(validateShareSlug('acme-proposal')).toBeNull();
    expect(validateShareSlug('series-b-deck')).toBeNull();
    expect(validateShareSlug('q2-2026')).toBeNull();
    expect(validateShareSlug('abc')).toBeNull();
    expect(validateShareSlug('a'.repeat(60))).toBeNull();
  });

  it('rejects the format cases the trigger rejects', () => {
    expect(validateShareSlug('Acme-Proposal')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('ab')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('a'.repeat(61))).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('-acme')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('acme-')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('acme_proposal')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('acme proposal')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('acme.proposal')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('acme/proposal')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('')).toBe(SLUG_FORMAT_MESSAGE);
    expect(validateShareSlug('_doc')).toBe(SLUG_FORMAT_MESSAGE);
  });

  it('rejects every reserved word', () => {
    for (const word of RESERVED_SHARE_SLUGS) {
      // 'm' and '_doc' are caught by the format rule first — either message
      // is a rejection, which is all that matters.
      expect(validateShareSlug(word)).not.toBeNull();
    }
    expect(validateShareSlug('login')).toBe(SLUG_RESERVED_MESSAGE);
    expect(validateShareSlug('billing')).toBe(SLUG_RESERVED_MESSAGE);
    expect(validateShareSlug('htmlradar')).toBe(SLUG_RESERVED_MESSAGE);
    expect(validateShareSlug('sign-in')).toBe(SLUG_RESERVED_MESSAGE);
  });

  it('still accepts an address that merely contains a reserved word', () => {
    expect(validateShareSlug('admin-onboarding')).toBeNull();
    expect(validateShareSlug('our-api-roadmap')).toBeNull();
  });

  it('accepts every address the generator can produce', () => {
    // Regression guard: the generated shape must never be rejected by the
    // same trigger, or create_share would fail for free users.
    expect(SHARE_SLUG_PATTERN.test('swift-falcon-a3f9c2')).toBe(true);
    expect(SHARE_SLUG_PATTERN.test('steady-compass-000000')).toBe(true);
  });
});

describe('normalizeSlugInput', () => {
  it('lowercases without touching anything else', () => {
    expect(normalizeSlugInput('Acme-Proposal')).toEqual({
      value: 'acme-proposal',
      shortened: false,
    });
  });

  it('leaves illegal characters alone so validation can explain them', () => {
    // Rewriting input under the cursor is worse than an error message.
    expect(normalizeSlugInput('Acme Proposal!')).toEqual({
      value: 'acme proposal!',
      shortened: false,
    });
  });

  it('keeps only the last path segment of a pasted URL, and says so', () => {
    expect(normalizeSlugInput('https://htmlradar.com/r/acme-proposal')).toEqual({
      value: 'acme-proposal',
      shortened: true,
    });
    expect(normalizeSlugInput('htmlradar.com/r/Acme-Proposal')).toEqual({
      value: 'acme-proposal',
      shortened: true,
    });
    expect(normalizeSlugInput('/r/acme-proposal/')).toEqual({
      value: 'acme-proposal',
      shortened: true,
    });
  });

  it('drops a query string or fragment from a pasted URL', () => {
    expect(normalizeSlugInput('https://htmlradar.com/r/acme-proposal?utm_source=x')).toEqual({
      value: 'acme-proposal',
      shortened: true,
    });
    expect(normalizeSlugInput('https://htmlradar.com/r/acme-proposal#top')).toEqual({
      value: 'acme-proposal',
      shortened: true,
    });
  });

  it('does not report a shortening when there was nothing to shorten', () => {
    expect(normalizeSlugInput('acme-proposal').shortened).toBe(false);
    expect(normalizeSlugInput('').shortened).toBe(false);
  });
});

describe('describeSlugError', () => {
  it('translates every exception 033 raises', () => {
    expect(describeSlugError('slug_invalid_format')).toBe(SLUG_FORMAT_MESSAGE);
    expect(describeSlugError('slug_reserved')).toBe(SLUG_RESERVED_MESSAGE);
    expect(describeSlugError('slug_unavailable')).toBe(SLUG_UNAVAILABLE_MESSAGE);
    expect(describeSlugError('slug_requires_pro')).toBe(SLUG_REQUIRES_PRO_MESSAGE);
  });

  it('translates a raw unique-violation on the slug index', () => {
    expect(
      describeSlugError(
        'duplicate key value violates unique constraint "document_shares_slug_key"',
      ),
    ).toBe(SLUG_UNAVAILABLE_MESSAGE);
  });

  it('leaves errors that are not about the address alone', () => {
    expect(describeSlugError('free_tier_share_cap_reached')).toBeNull();
    expect(describeSlugError('password_too_short')).toBeNull();
  });
});
