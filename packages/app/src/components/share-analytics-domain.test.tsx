// The waiting panel must not invite the owner to send a link that cannot open.
//
// With no reads yet, ShareAnalytics renders "Send the link to <recipient>" with
// the address and a copy button under it. On a share whose own domain has
// stopped answering that is an invitation to send a dead link, so the panel
// says what is wrong INSTEAD — one sentence, the same one the share card and
// the share table use. What this pins is the substitution: the note appears,
// the invitation does not, and a live domain is untouched.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ShareAnalytics } from './ShareAnalytics';
import { domainDisconnectedNote } from '@/lib/share-url';

const HOSTNAME = 'decks.acme.com';

const render = (domainDown: boolean) =>
  renderToStaticMarkup(
    <ShareAnalytics
      shareSlug="quick-glass"
      hostHandle={null}
      customHostname={HOSTNAME}
      domainDown={domainDown}
      recipientLabel="Acme"
      viewers={[]}
      sessions={[]}
      sections={[]}
    />,
  );

describe('the waiting panel on a domain that has stopped answering', () => {
  it('says what is wrong instead of inviting the owner to send the link', () => {
    const html = render(true);
    expect(html).toContain(domainDisconnectedNote(HOSTNAME));
    expect(html).not.toContain('Send the link to');
    expect(html).not.toContain('Waiting for first read');
  });

  it('leaves the invitation alone while the domain is live', () => {
    const html = render(false);
    expect(html).toContain('Send the link to');
    expect(html).not.toContain('is no longer connected');
  });
});
