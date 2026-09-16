// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ConvertPanel, restoreConvertedDeck } from './ConvertPanel';
import { SampleReport } from './SampleReport';
import {
  convertPdfToDeck,
  assembleDeckHtml,
  type PdfDeck,
  type PdfDeckOptions,
} from '@/lib/pdf-to-deck';
import { readStagedFile, stageFile } from '@/lib/staged-file';
import { HANDOFF_MESSAGES } from '@/lib/staged-handoff';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const { push } = router;
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/events-client', () => ({ captureClientEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/pdf-to-deck', async (original) => ({
  ...(await original<typeof import('@/lib/pdf-to-deck')>()),
  convertPdfToDeck: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;
let counter = 0;
const action = vi.fn(async () => ({ ok: true as const, documentId: 'saved-document' }));
const makeDeck = (): PdfDeck => ({
  filename: 'deck.html',
  html: new Blob(['<h2>Local deck</h2>'], { type: 'text/html' }),
  bytes: 100,
  slides: ['Slide 1: Our company', 'Slide 2: Next steps'].map((title) => ({
    title,
    width: 1600,
    height: 1000,
    image: new Blob(['image'], { type: 'image/png' }),
  })),
});
async function settle(work: () => void | Promise<void>) {
  await act(async () => {
    await work();
  });
}
async function waitFor(assertion: () => void) {
  // Keep each IndexedDB wait inside React's act scope, including the time
  // between assertions. Vitest's retry interval would run callbacks outside it.
  const deadline = Date.now() + 1000;
  let failure: unknown;
  do {
    await settle(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
    }
  } while (Date.now() < deadline);
  throw failure;
}

async function render(props: Partial<Parameters<typeof ConvertPanel>[0]> = {}) {
  await settle(() => root.render(<ConvertPanel action={action} {...props} />));
}
async function choose(files: File[]) {
  const input = host.querySelector('input')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await settle(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('indexedDB', new IDBFactory());
  URL.createObjectURL = vi.fn(() => `blob:local-${counter++}`);
  URL.revokeObjectURL = vi.fn();
  push.mockClear();
  action.mockClear();
  vi.mocked(convertPdfToDeck).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await settle(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('converter page states', () => {
  it('shows the agreed empty copy and rejects multiple PDFs without starting conversion', async () => {
    await render();
    expect(host.textContent).toContain('Choose a PDF deck');
    expect(host.textContent).toContain(
      'Or drop one here. Landscape slides, 2–60 pages, up to 30 MB.',
    );
    expect(host.textContent).toContain(
      'Slides become pictures: text is not selectable or fully accessible to screen readers, links and comments are removed, and fonts, colours and detected titles may differ.',
    );
    expect(host.textContent).toContain('Only convert and share decks you have permission to use.');
    await choose([new File(['pdf'], 'a.pdf'), new File(['pdf'], 'b.pdf')]);
    expect(host.textContent).toContain('Choose one PDF at a time.');
    expect(button('Choose another PDF')).toBeDefined();
    expect(convertPdfToDeck).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
  });
  it.each([
    ['iPhone Safari', 'iPhone Version/18.0 Mobile Safari/604.1', 'iPhone', 5, true],
    ['iPad Safari', 'iPad Version/18.0 Mobile Safari/604.1', 'iPad', 5, true],
    ['iPad desktop mode', 'Macintosh Version/18.0 Safari/605.1', 'MacIntel', 5, true],
    ['desktop Safari', 'Macintosh Version/18.0 Safari/605.1', 'MacIntel', 0, false],
    ['iPhone Chrome', 'iPhone CriOS/140.0 Mobile Safari/604.1', 'iPhone', 5, false],
    ['iPhone Firefox', 'iPhone FxiOS/140.0 Mobile Safari/604.1', 'iPhone', 5, false],
    ['iPhone Edge', 'iPhone EdgiOS/140.0 Mobile Safari/604.1', 'iPhone', 5, false],
    ['Android Chrome', 'Android Chrome/140.0 Mobile Safari/537.36', 'Linux', 5, false],
  ])(
    'limits Safari help to iOS Safari: %s',
    async (_name, userAgent, platform, maxTouchPoints, shown) => {
      vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
      vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
      await render();
      expect(host.textContent?.includes('If Safari closed the page')).toBe(shown);
      await choose([new File(['pdf'], 'a.pdf')]);
      expect(host.textContent?.includes('Use Share, then Save to Files.')).toBe(shown);
    },
  );
  it('keeps a completed download and explains a staging read failure', async () => {
    vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
    vi.spyOn(File.prototype, 'text').mockRejectedValue(new Error('Memory exhausted'));
    await render();
    await choose([new File(['pdf'], 'a.pdf')]);
    expect(host.textContent).toContain('Your HTML file is ready.');
    expect(host.textContent).toContain(HANDOFF_MESSAGES.storage);
    expect(host.textContent).not.toContain('We couldn’t read this PDF');
    expect(host.querySelector('a[download]')?.getAttribute('href')).toMatch(/^blob:/);
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(button('Get a tracked link').disabled).toBe(true);
  });
  it('ignores a late staging failure after choosing another PDF', async () => {
    vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
    let fail!: (error: Error) => void;
    vi.spyOn(File.prototype, 'text').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await render();
    await choose([new File(['pdf'], 'a.pdf')]);
    await settle(() => button('Choose another PDF').click());
    await settle(() => fail(new Error('Late read failure')));
    expect(host.textContent).not.toContain(HANDOFF_MESSAGES.storage);
    expect(host.textContent).not.toContain('Your HTML file is ready.');
  });
  it.each([
    '<main>Old saved format</main>',
    '<main><section class="slide"><h2 id="slide-1">Title</h2><img src="data:image/png;base64,A" width="1600" height="1000"></section><section class="slide"></section></main>',
  ])(
    'explains a saved deck that returns null or throws during preview restoration',
    async (contents) => {
      await stageFile({
        name: 'deck.html',
        contents,
        type: 'text/html',
        path: '/convert',
        stagedAt: Date.now(),
        token: 'unreadable',
      });
      await render({ resumeToken: 'unreadable' });
      await waitFor(() => expect(host.textContent).toContain(HANDOFF_MESSAGES.missing));
      expect(host.querySelector('input[aria-label="Choose a PDF deck"]')).not.toBeNull();
      expect(action).not.toHaveBeenCalled();
      expect(host.querySelector('a[download]')).toBeNull();
    },
  );
  it('announces progress, shows the first preview, and ignores late completion after Cancel', async () => {
    let finish!: (deck: PdfDeck) => void;
    let options!: PdfDeckOptions;
    vi.mocked(convertPdfToDeck).mockImplementation((_file, opts) => {
      options = opts!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await render();
    await choose([new File(['pdf'], 'a.pdf')]);
    expect(host.textContent).toContain('Checking your PDF…');
    await settle(() => {
      options.onProgress?.({ phase: 'rendering', page: 1, total: 2 });
      options.onPreview?.(makeDeck().slides[0]!);
    });
    expect(host.textContent).toContain('Converting slide 1 of 2…');
    expect(host.querySelectorAll('img')).toHaveLength(1);
    await settle(() => button('Cancel').click());
    expect(options.signal?.aborted).toBe(true);
    await settle(() => finish(makeDeck()));
    expect(host.textContent).toContain('Conversion cancelled.');
    expect(host.textContent).not.toContain('Your HTML file is ready.');
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('uses local titles in the report, changes one preview, and only stages on the tracked-link click', async () => {
    vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
    await render();
    await choose([new File(['pdf'], 'a.pdf')]);
    expect(host.textContent).toContain('Your HTML file is ready.');
    expect(host.textContent).toContain('Northgate Capital');
    expect(host.textContent).toContain('Harbour & Co');
    expect(host.textContent).toContain('M. Okafor');
    expect(host.textContent).toContain('sample numbers, your slides');
    expect(host.textContent).toContain('Sign-in is required. Next, you’ll choose how to share it.');
    expect(await readStagedFile()).toBeNull();
    expect(action).not.toHaveBeenCalled();
    await settle(() => button('Next').click());
    expect(host.querySelector('figcaption')?.textContent).toContain('Slide 2: Next steps');
    expect(host.querySelectorAll('img')).toHaveLength(1);
    await settle(() => button('Get a tracked link').click());
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
    expect(push.mock.calls[0]![0]).toMatch(/^\/sign-in\?next=%2Fconvert%3Fresume%3D/);
    expect((await readStagedFile())?.contents).toBe('<h2>Local deck</h2>');
  });
  it('uploads immediately for a signed-in click and retains the output after an uncertain response', async () => {
    const failure = vi.fn(async () => {
      throw new Error('Lost response');
    });
    vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
    await render({ signedIn: true, action: failure });
    await choose([new File(['pdf'], 'a.pdf')]);
    await settle(async () => {
      button('Get a tracked link').click();
      await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    });
    expect(host.textContent).toContain(HANDOFF_MESSAGES.uncertain);
    expect(failure).toHaveBeenCalledOnce();
    expect(host.querySelector('a[download]')).not.toBeNull();
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect((await readStagedFile())?.reserved).toBe(true);
  });
  it('a plain visit restores a converted preview without uploading', async () => {
    const deck = makeDeck();
    const html = await assembleDeckHtml('deck.pdf', deck.slides);
    await stageFile({
      name: 'deck.html',
      contents: await html.text(),
      type: 'text/html',
      path: '/convert',
      stagedAt: Date.now(),
      token: 'resume-1',
    });
    await render({ signedIn: true });
    await waitFor(() => expect(host.textContent).toContain('Your HTML file is ready.'));
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(action).not.toHaveBeenCalled();
  });
  it('refuses remote preview sources from a tampered saved record', () => {
    expect(
      restoreConvertedDeck(
        '<main><section class="slide"><h2 id="slide-1">Secret</h2><img src="https://evil.example/secret" width="1600" height="1000"></section><section class="slide"></section></main>',
        'deck.html',
      ),
    ).toBeNull();
  });
  it('uses at most five report sections with totals equal to the visible times', async () => {
    await settle(() =>
      root.render(
        <SampleReport titles={Array.from({ length: 8 }, (_, i) => `Slide ${i + 1}: Title`)} />,
      ),
    );
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5);
    const times = [...host.querySelectorAll('tbody td > span:first-child')].map(
      (cell) => cell.textContent,
    );
    expect(times.filter((time) => time === '—')).toHaveLength(6);
    expect(times).not.toContain('0s');
    const headers = [...host.querySelectorAll('thead th')].slice(1);
    expect(headers.map((h) => h.textContent)).toEqual([
      'Northgate Capital3 opens4m 36s',
      'Harbour & Co2 opens3m 15s',
      'M. Okafor1 open46s',
    ]);
  });
  it('prefers actual detected titles, keeping their slide numbers and using positional labels only if needed', async () => {
    await settle(() =>
      root.render(
        <SampleReport
          titles={['Slide 1: Untitled', 'Slide 2: Untitled', 'Slide 3: Purpose', 'Slide 4: Team']}
        />,
      ),
    );
    expect([...host.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual([
      'Slide 3: Purpose',
      'Slide 4: Team',
    ]);
    expect(host.querySelector('thead th:nth-child(2)')?.textContent).toBe(
      'Northgate Capital3 opens2m 9s',
    );
    await settle(() =>
      root.render(<SampleReport titles={['Slide 1: Untitled', 'Slide 2: Untitled']} />),
    );
    expect([...host.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual([
      'Slide 1: Untitled',
      'Slide 2: Untitled',
    ]);
  });
  it('two resumed tabs create once under Strict Mode, and a later refresh does not create again', async () => {
    const deck = makeDeck();
    const contents = await (await assembleDeckHtml('deck.pdf', deck.slides)).text();
    await stageFile({
      name: 'deck.html',
      contents,
      type: 'text/html',
      path: '/convert',
      stagedAt: Date.now(),
      token: 'one-resume',
    });
    let finish!: () => void;
    const pending = vi.fn(
      () =>
        new Promise<{ ok: true; documentId: string }>((resolve) => {
          finish = () => resolve({ ok: true, documentId: 'one-document' });
        }),
    );
    await settle(() =>
      root.render(
        <StrictMode>
          <ConvertPanel action={pending} signedIn resumeToken="one-resume" />
          <ConvertPanel action={pending} signedIn resumeToken="one-resume" />
        </StrictMode>,
      ),
    );
    await waitFor(() => expect(pending).toHaveBeenCalledOnce());
    await settle(() => finish());
    await waitFor(() => expect(push).toHaveBeenCalledWith('/docs/one-document'));
    await settle(() =>
      root.render(
        <ConvertPanel key="refreshed" action={pending} signedIn resumeToken="one-resume" />,
      ),
    );
    await waitFor(() => expect(host.textContent).toContain(HANDOFF_MESSAGES.missing));
    expect(pending).toHaveBeenCalledOnce();
  });
  it('a stale sign-in session returns to sign-in with the same creation identifier', async () => {
    const expired = vi.fn(async () => ({ ok: false as const, reason: 'auth' as const }));
    vi.mocked(convertPdfToDeck).mockResolvedValue(makeDeck());
    await render({ signedIn: true, action: expired });
    await choose([new File(['pdf'], 'a.pdf')]);
    await settle(async () => {
      button('Get a tracked link').click();
      await vi.waitFor(() => expect(push).toHaveBeenCalledOnce());
    });
    expect(push.mock.calls[0]![0]).toMatch(/^\/sign-in\?next=%2Fconvert%3Fresume%3D/);
    const ready = await readStagedFile();
    expect(ready?.reserved).toBeUndefined();
    expect(ready?.creationId).toBeTruthy();
    expect(expired).toHaveBeenCalledOnce();
  });
});
