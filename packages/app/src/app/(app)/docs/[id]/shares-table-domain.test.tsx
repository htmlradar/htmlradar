// The share table has to say what the share card says.
//
// A link on a customer's own domain stops opening the moment that domain stops
// answering, and the owner may be looking at any of three surfaces when it
// happens: the share card, this table, or the per-share dashboard. Until 17
// September only the card said anything, so the same broken link read as
// perfectly healthy here. What this pins is that the sentence appears, that it
// is the SAME sentence (one helper, not three strings), and that a live domain
// gets no warning at all.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SharesTable } from './SharesTable';
import { domainDisconnectedNote } from '@/lib/share-url';
import type { ShareRow } from './DocumentShareManager';

const HOSTNAME = 'decks.acme.com';

const share = (over: Partial<ShareRow>): ShareRow => ({
  id: over.id ?? 'share-1',
  slug: over.slug ?? 'quick-glass',
  recipient_label: 'Acme',
  require_email: false,
  require_password: false,
  allowed_email_domains: null,
  allowed_emails: null,
  lock_deck: false,
  expires_at: null,
  revoked_at: null,
  host_handle: null,
  custom_hostname: null,
  custom_domain_id: null,
  custom_domain_state: null,
  viewCount: 0,
  ...over,
});

// Two rows minimum: the table deliberately renders nothing for one share.
const render = (state: string) =>
  renderToStaticMarkup(
    <SharesTable
      shares={[
        share({
          custom_hostname: HOSTNAME,
          custom_domain_id: 'domain-1',
          custom_domain_state: state,
        }),
        share({ id: 'share-2', slug: 'second-link' }),
      ]}
      analyticsByShareId={{}}
    />,
  );

describe('a share on a domain that has stopped answering', () => {
  it('carries the same one-line warning the share card carries', () => {
    expect(render('disconnected')).toContain(domainDisconnectedNote(HOSTNAME));
  });

  it('says nothing about a domain that is live', () => {
    expect(render('live')).not.toContain('is no longer connected');
  });
});
