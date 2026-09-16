// What an assistant is allowed to paste when it names a share.
//
// The share lookup itself is scoped to the caller's own rows by an owner
// filter, so none of this is what keeps one account out of another's shares.
// What it does keep is the property that a hostname which merely LOOKS like
// ours is not read as ours — the case that costs nothing to hold and is
// awkward to notice once lost.

import { describe, expect, it } from 'vitest';
import { slugOf } from './api-share-lookup';

describe('the shapes a share can be named by', () => {
  it('takes a bare slug, a path, and a link on either of our own hosts', () => {
    for (const given of [
      'acme-proposal',
      '/r/acme-proposal',
      'htmlradar.page/r/acme-proposal',
      'https://htmlradar.page/r/acme-proposal',
      'https://lumenforge.htmlradar.page/r/acme-proposal',
      'https://htmlradar.com/r/acme-proposal',
    ]) {
      expect(slugOf(given), given).toBe('acme-proposal');
    }
  });

  // The fourth shape (schema/052): the link is on the customer's own domain,
  // and there is no list of hostnames to match it against — that is the point
  // of the feature.
  it('takes a link on a customer’s own domain', () => {
    for (const given of [
      'https://decks.acme.com/r/acme-proposal',
      'decks.acme.com/r/acme-proposal',
      'https://links.sub.acme.co.uk/r/acme-proposal',
    ]) {
      expect(slugOf(given), given).toBe('acme-proposal');
    }
  });

  // No customer hostname may contain the word (the connect rule in
  // custom-domains.ts and the trigger in 052), so one that does is a lookalike
  // and is not read as a link at all.
  it('refuses a lookalike of our own host', () => {
    for (const given of [
      'https://htmlradar.page.evil.example/r/acme-proposal',
      'https://htmlradar-login.evil.example/r/acme-proposal',
      'https://evil.example/htmlradar.page/r/acme-proposal',
    ]) {
      expect(slugOf(given), given).toBeNull();
    }
  });

  // The rule is about the hostname. A slug is free to say anything the slug
  // format allows.
  it('still reads a slug that contains the word', () => {
    expect(slugOf('https://decks.acme.com/r/htmlradar-review')).toBe('htmlradar-review');
  });

  it('refuses anything that is not a slug', () => {
    for (const given of ['', 'not a slug', '/r/', 'https://decks.acme.com/x/acme-proposal']) {
      expect(slugOf(given), given).toBeNull();
    }
  });
});
