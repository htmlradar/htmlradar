// @vitest-environment jsdom
//
// The prefix of the Link address field IS the choice of host.
//
// There was a "Link domain" section under it with a toggle in it until 17
// September, and the founder read the two together and could not tell what
// pressing the toggle would do to the address printed above it. So the address
// says what it is: one field, one prefix, and the prefix is the only place
// where the choice lives. What this file pins is that there are exactly two
// options, that the account's own domain is the one selected, that an account
// without a domain sees no choice at all, and that the form submits the field
// the server action already reads.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submitted = vi.hoisted(() => ({ forms: [] as FormData[] }));

vi.mock('../actions', () => ({
  createShareFormAction: async (fd: FormData) => {
    submitted.forms.push(fd);
    return undefined;
  },
}));
vi.mock('@/lib/events-client', () => ({ captureClientEvent: vi.fn(async () => undefined) }));

import { ShareCardList } from './ShareCardList';

const DOMAIN = 'decks.draconic.ai';

/** The draft card, open, for an account that is Pro (freeShareCap null). */
async function openDraft(defaultDomainHostname: string | null) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ShareCardList
        documentId="11111111-1111-4111-8111-111111111111"
        shares={[]}
        analyticsByShareId={{}}
        previewShareAction={async () => ({ ok: true, url: '' })}
        editShareAction={async () => undefined}
        toggleShareAction={async () => undefined}
        deleteShareAction={async () => undefined}
        freeShareCap={null}
        defaultDomainHostname={defaultDomainHostname}
      />,
    );
  });
  const open = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Create a new share link'),
  );
  await act(async () => open!.click());
  return { host, root };
}

const prefix = (host: HTMLElement) =>
  host.querySelector<HTMLSelectElement>('select#link-address-prefix');

beforeEach(() => {
  submitted.forms = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Link address prefix', () => {
  it('offers the account’s own domain and ours, in that order, and nothing else', async () => {
    const { host, root } = await openDraft(DOMAIN);

    const select = prefix(host);
    expect(select).not.toBeNull();
    expect([...select!.options].map((o) => o.textContent)).toEqual([
      `${DOMAIN}/r/`,
      'htmlradar.page/r/',
    ]);
    // Their domain is the default; there is no toggle to find.
    expect(select!.value).toBe('off');

    // The section that used to carry the choice is gone.
    expect(host.textContent).not.toContain('Link domain');
    expect(host.textContent).not.toContain('Use htmlradar.page for this link');
    // And the one sentence under the field is still the only helper text.
    expect(host.textContent).toContain('Public — this is the link your recipient receives.');

    // Labelled for a screen reader, which a prefix made of a select needs.
    const label = host.querySelector('label[for="link-address-prefix"]');
    expect(label?.textContent).toBe('Link address prefix');

    await act(async () => root.unmount());
    host.remove();
  });

  it('stays plain text for an account with no domain of its own', async () => {
    const { host, root } = await openDraft(null);
    expect(prefix(host)).toBeNull();
    expect(host.textContent).toContain('htmlradar.page/r/');
    await act(async () => root.unmount());
    host.remove();
  });

  it('submits the choice in the field the creating action reads', async () => {
    const { host, root } = await openDraft(DOMAIN);
    const form = host.querySelector('form')!;

    // Left alone: their domain, which the database picks itself.
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submitted.forms.at(-1)?.get('use_htmlradar_host')).toBe('off');

    const select = prefix(host)!;
    await act(async () => {
      select.value = 'on';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(submitted.forms.at(-1)?.get('use_htmlradar_host')).toBe('on');

    await act(async () => root.unmount());
    host.remove();
  });
});
