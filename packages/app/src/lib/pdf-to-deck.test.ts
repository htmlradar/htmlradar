import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import { degrees, PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextContent,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import { PDF_DECK_SECTIONS, PDF_DECK_TOC } from '../../../tracker/tests/fixtures/pdf-deck';
import { isMetaPattern } from '../../../tracker/src/sections-v2';
import {
  admitPdf,
  downloadFilename,
  assembleDeckHtml,
  convertPdfToDeck,
  extractTitleCandidates,
  finalizeSlideTitles,
  hasOpeningText,
  loadPdfJs,
  MAX_DECK_BYTES,
  MAX_PDF_BYTES,
  PDF_DECK_MESSAGES,
  PDFJS_BASE_URL,
  slideLabel,
  validatePageSize,
  validatePdfFile,
  type DeckSlide,
  type TitleCandidate,
} from './pdf-to-deck';

const require = createRequire(import.meta.url);
let pdfjs: typeof import('pdfjs-dist');
const documents: PDFDocumentProxy[] = [];
const viewports = new Map<number, PageViewport>();
const workers: Array<EventTarget & { terminate: ReturnType<typeof vi.fn> }> = [];

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal(
    'Worker',
    class extends EventTarget {
      terminate = vi.fn();
      constructor() {
        super();
        workers.push(this);
      }
    },
  );
});

beforeAll(async () => {
  // The legacy build supplies DOM shims for Node tests (Node >=22.13).
  // Production imports the self-hosted browser build only after selection.
  const url = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  pdfjs = await import(/* @vite-ignore */ url);
  const source = await PDFDocument.create();
  source.addPage([720, 450]);
  source.addPage([450, 720]).setRotation(degrees(90));
  const loading = pdfjs.getDocument({ data: await source.save(), verbosity: 0 });
  const pdf = await loading.promise;
  viewports.set(0, (await pdf.getPage(1)).getViewport({ scale: 1 }));
  viewports.set(90, (await pdf.getPage(2)).getViewport({ scale: 1 }));
  await loading.destroy();
});

afterEach(async () => {
  await Promise.all(documents.splice(0).map((pdf) => pdf.loadingTask.destroy()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock(`${PDFJS_BASE_URL}pdf.mjs`);
});

async function fixture(
  count = 3,
  edit?: (pdf: PDFDocument) => void | Promise<void>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([720, 450]);
    // Cover is deliberately blank: opening admission needs text on ONE page.
    if (i)
      page.drawText(`Our presentation slide number ${i + 1}`, { x: 40, y: 380, size: 24, font });
  }
  await edit?.(pdf);
  return pdf.save();
}

async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  documents.push(pdf);
  return pdf;
}

describe('PDF admission using generated PDFs', () => {
  it('accepts a two-page deck with a photo cover and a 60-page deck', async () => {
    for (const count of [2, 60]) {
      const pdf = await open(await fixture(count));
      const admitted = await admitPdf(pdf);
      expect(admitted.first.width).toBe(720);
      expect(admitted.candidates).toHaveLength(Math.min(3, count));
      expect(admitted.candidates[0]).toEqual([]);
    }
  });

  it.each([
    [1, 'single'],
    [61, 'pages'],
    [100, 'pages'],
  ] as const)('rejects %i pages before page access', async (count, code) => {
    const pdf = await open(await fixture(count));
    const pages = vi.spyOn(pdf, 'getPage');
    await expect(admitPdf(pdf)).rejects.toMatchObject({ code, message: PDF_DECK_MESSAGES[code] });
    expect(pages).not.toHaveBeenCalled();
  });

  it.each([
    [450, 720, 'portrait'],
    [720, 720, 'aspect'],
    [720, 600, 'aspect'],
    [1000, 450, 'aspect'],
  ] as const)('rejects %i by %i pages', async (width, height, code) => {
    const pdf = await open(
      await fixture(2, (doc) => {
        doc.getPages().forEach((page) => page.setSize(width, height));
      }),
    );
    await expect(admitPdf(pdf)).rejects.toMatchObject({ code, message: PDF_DECK_MESSAGES[code] });
  });

  it('applies page rotation before checking the landscape ratio', async () => {
    const pdf = await open(
      await fixture(2, (doc) => {
        doc.getPages().forEach((page) => {
          page.setSize(450, 720);
          page.setRotation(degrees(90));
        });
      }),
    );
    expect((await admitPdf(pdf)).first.width).toBe(720);
  });

  it('rejects a mixed opening sample and checks later pages against page one', async () => {
    const early = await open(
      await fixture(3, (doc) => {
        doc.getPage(2).setSize(735, 450);
      }),
    );
    await expect(admitPdf(early)).rejects.toMatchObject({ code: 'sizes' });
    const late = await open(
      await fixture(4, (doc) => {
        doc.getPage(3).setSize(720, 460);
      }),
    );
    const admitted = await admitPdf(late);
    const page = await late.getPage(4);
    expect(() => validatePageSize(page.getViewport({ scale: 1 }), admitted.first)).toThrow(
      PDF_DECK_MESSAGES.sizes,
    );
  });

  it('rejects forms and portfolios before rendering any page', async () => {
    for (const [edit, code] of [
      [
        (doc: PDFDocument) => {
          doc.getForm().createTextField('name').addToPage(doc.getPage(0));
        },
        'forms',
      ],
      [
        (doc: PDFDocument) => {
          doc.catalog.set(PDFName.of('Collection'), doc.context.obj({ Type: 'Collection' }));
        },
        'attachments',
      ],
      [
        async (doc: PDFDocument) => {
          await doc.attach(new Uint8Array([1, 2, 3]), 'attached.txt');
        },
        'attachments',
      ],
    ] as const) {
      const pdf = await open(await fixture(2, edit));
      const pages = vi.spyOn(pdf, 'getPage');
      await expect(admitPdf(pdf)).rejects.toMatchObject({ code, message: PDF_DECK_MESSAGES[code] });
      expect(pages).not.toHaveBeenCalled();
    }
  });

  it('rejects an image-only opening even when page four has text', async () => {
    const pdf = await open(
      await fixture(4, (doc) => {
        for (const page of doc.getPages().slice(0, 3)) page.node.delete(PDFName.of('Contents'));
      }),
    );
    await expect(admitPdf(pdf)).rejects.toMatchObject({
      code: 'text',
      message: PDF_DECK_MESSAGES.text,
    });
  });

  it('extracts a real PDF title and releases admission page resources', async () => {
    const pdf = await open(await fixture(2));
    const page = await pdf.getPage(2);
    const cleanup = vi.spyOn(page, 'cleanup');
    const result = await admitPdf(pdf);
    expect(finalizeSlideTitles(result.candidates)).toEqual([
      'Slide 1: Untitled',
      'Slide 2: Our presentation slide number 2',
    ]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([2, 3])('joins %i consecutive title lines from a synthetic PDF', async (count) => {
    const lines = ['Social, the most', 'important trend', 'for growing teams'].slice(0, count);
    const pdf = await open(
      await fixture(2, (doc) => {
        lines.forEach((text, i) =>
          doc.getPage(0).drawText(text, { x: 40, y: 390 - i * 30, size: 24 }),
        );
      }),
    );
    expect(finalizeSlideTitles((await admitPdf(pdf)).candidates)[0]).toBe(
      `Slide 1: ${lines.join(' ')}`,
    );
  });

  it.each([
    ['different left edges', 60, 350, 24],
    ['different font sizes', 40, 350, 23],
    ['nonconsecutive baselines', 40, 310, 24],
    ['separate columns', 400, 380, 24],
  ])(
    'keeps the existing ambiguity fallback for %s in a synthetic PDF',
    async (_name, x, y, size) => {
      const pdf = await open(
        await fixture(2, (doc) => {
          doc.getPage(0).drawText('First heading', { x: 40, y: 380, size: 24 });
          doc.getPage(0).drawText('Second heading', { x, y, size });
        }),
      );
      expect(finalizeSlideTitles((await admitPdf(pdf)).candidates)[0]).toBe('Slide 1: Untitled');
    },
  );

  it('does not turn four lines or a bullet list into a wrapped title in synthetic PDFs', async () => {
    for (const lines of [
      ['First heading', 'Second heading', 'Third heading', 'Fourth heading'],
      ['- First item', '- Second item'],
    ]) {
      const pdf = await open(
        await fixture(2, (doc) => {
          lines.forEach((text, i) =>
            doc.getPage(0).drawText(text, { x: 40, y: 410 - i * 30, size: 24 }),
          );
        }),
      );
      expect(finalizeSlideTitles((await admitPdf(pdf)).candidates)[0]).toBe('Slide 1: Untitled');
    }
  });

  it('keeps hostile text from a generated PDF inert in the assembled HTML', async () => {
    const payload = '</h2><img src="https://evil.example/" alt=\'leak\'>';
    const pdf = await open(
      await fixture(2, (doc) => {
        const page = doc.getPage(0);
        page.drawText(payload, { x: 20, y: 380, size: 18 });
      }),
    );
    const admitted = await admitPdf(pdf);
    const titles = finalizeSlideTitles(admitted.candidates);
    expect(titles[0]).toBe(`Slide 1: ${payload}`);
    const html = await (
      await assembleDeckHtml(
        `${payload}.pdf`,
        titles.map((title) => slide(title)),
      )
    ).text();
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain(
      '&lt;/h2&gt;&lt;img src=&quot;https://evil.example/&quot; alt=&#39;leak&#39;&gt;',
    );
  });

  it('detects real optional-content metadata and suppresses all extracted titles', async () => {
    const pdf = await open(
      await fixture(2, (doc) => {
        const group = doc.context.register(
          doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Hidden layer') }),
        );
        doc.catalog.set(
          PDFName.of('OCProperties'),
          doc.context.obj({ OCGs: [group], D: { Order: [group], OFF: [group] } }),
        );
      }),
    );
    const admitted = await admitPdf(pdf);
    expect(admitted.positional).toBe(true);
    expect(finalizeSlideTitles(admitted.candidates, admitted.positional)).toEqual([
      'Slide 1: Untitled',
      'Slide 2: Untitled',
    ]);
  });
});

describe('admission boundaries', () => {
  it('accepts exactly 30 MiB and rejects one byte more', () => {
    expect(() =>
      validatePdfFile({ name: 'deck.PDF', type: '', size: MAX_PDF_BYTES }),
    ).not.toThrow();
    expect(() =>
      validatePdfFile({ name: 'deck.pdf', type: 'application/pdf', size: MAX_PDF_BYTES + 1 }),
    ).toThrow(PDF_DECK_MESSAGES.size);
    expect(() => validatePdfFile({ name: 'deck.txt', type: 'text/plain', size: 10 })).toThrow(
      PDF_DECK_MESSAGES.format,
    );
  });

  it('includes both aspect boundaries and exactly two percent size variation', () => {
    for (const width of [562.5, 900])
      expect(() => validatePageSize({ width, height: 450 })).not.toThrow();
    const first = { width: 720, height: 450 };
    for (const scale of [0.98, 1.02])
      expect(() =>
        validatePageSize({ width: 720 * scale, height: 450 * scale }, first),
      ).not.toThrow();
    expect(() => validatePageSize({ width: 734.401, height: 450 }, first)).toThrow(
      PDF_DECK_MESSAGES.sizes,
    );
  });

  it('counts Unicode letters and digits, excluding isolated page numbers', () => {
    expect(hasOpeningText(content('A'.repeat(19)))).toBe(false);
    expect(hasOpeningText(content('日本語の文章を二十文字以上含むプレゼンテーションです'))).toBe(
      true,
    );
    expect(hasOpeningText(content('A'.repeat(19), '12'))).toBe(false);
    expect(hasOpeningText(content('A'.repeat(20)))).toBe(true);
  });
});

function content(...strings: string[]): TextContent {
  return { items: strings.map((str) => run(str)), styles: {}, lang: null };
}

function run(str: string, patch: Partial<TextItem> = {}): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [24, 0, 0, 24, 40, 380],
    width: 200,
    height: 24,
    fontName: 'font',
    hasEOL: false,
    ...patch,
  };
}

function viewport(rotation = 0): PageViewport {
  return viewports.get(rotation)!;
}

function labelFor(items: TextItem[], rotation = 0): string {
  return finalizeSlideTitles([
    extractTitleCandidates({ items, styles: {}, lang: null }, viewport(rotation)),
  ])[0]!;
}

function candidate(text: string, size = 24): TitleCandidate {
  return { text, size, x: 40, y: 70, width: 200, dir: 'ltr', ambiguous: false };
}

describe('title catalogue', () => {
  it.each([
    '7',
    '123456',
    'Slide 7',
    'Page 2 of 40',
    '2 / 40',
    '2026',
    '2026-09-09',
    '9 September 2026',
    'Sep 9, 2026',
    'September 2026',
    'September 9',
    '9 Sep',
    '• Our products',
    '1. Our products',
    'a) Our products',
    'A',
    '→',
    '$$$',
  ])('uses Untitled for %s', (text) => expect(labelFor([run(text)])).toBe('Slide 1: Untitled'));

  it.each(['OUR STRATEGY', '日本語の紹介', 'مرحبا بالعالم', '5 ways to grow', 'AI'])(
    'preserves semantic Unicode and case: %s',
    (text) => {
      expect(labelFor([run(text, { dir: text.startsWith('مرحبا') ? 'rtl' : 'ltr' })])).toBe(
        `Slide 1: ${text}`,
      );
    },
  );

  it('uses only horizontal lines at least 12 points tall in the top 40 percent', () => {
    for (const item of [
      run('Small text', { transform: [11, 0, 0, 11, 40, 380] }),
      run('Body text', { transform: [24, 0, 0, 24, 40, 200] }),
      run('Vertical text', { dir: 'ttb' }),
      run('Rotated text', { transform: [0, 24, -24, 0, 40, 380] }),
    ])
      expect(labelFor([item])).toBe('Slide 1: Untitled');
    expect(labelFor([run('Exactly twelve', { transform: [12, 0, 0, 12, 40, 270] })])).toBe(
      'Slide 1: Exactly twelve',
    );
  });

  it('uses rotation-adjusted text coordinates', () => {
    expect(labelFor([run('Rotated deck title', { transform: [0, 24, -24, 0, 60, 40] })], 90)).toBe(
      'Slide 1: Rotated deck title',
    );
  });

  it('joins compatible runs before ranking, including tightly tracked capitals', () => {
    expect(
      labelFor([
        run('Company ', { width: 100 }),
        run('overview', { transform: [24, 0, 0, 24, 140, 381] }),
      ]),
    ).toBe('Slide 1: Company overview');
    expect(
      labelFor(
        Array.from('GROWTH').map((str, i) =>
          run(str, { width: 14, transform: [24, 0, 0, 24, 40 + i * 15, 380] }),
        ),
      ),
    ).toBe('Slide 1: GROWTH');
    expect(
      labelFor(
        Array.from('GROWTH').map((str, i) =>
          run(str, { width: 14, transform: [24, 0, 0, 24, 40 + i * 22, 380] }),
        ),
      ),
    ).toBe('Slide 1: Untitled');
  });

  it('does not combine two columns, misaligned multiline titles, or uncertain RTL order', () => {
    expect(
      labelFor([run('Left title'), run('Right title', { transform: [24, 0, 0, 24, 400, 380] })]),
    ).toBe('Slide 1: Untitled');
    expect(
      labelFor([run('First line'), run('Second line', { transform: [24, 0, 0, 24, 60, 350] })]),
    ).toBe('Slide 1: Untitled');
    expect(
      labelFor([
        run('مرحبا', { dir: 'rtl', width: 100 }),
        run('بالعالم', { dir: 'rtl', transform: [24, 0, 0, 24, 145, 380] }),
      ]),
    ).toBe('Slide 1: Untitled');
  });

  it('removes headers on at least three slides and more than forty percent, then tries the next candidate', () => {
    const pages = Array.from({ length: 5 }, (_, i) => [
      candidate(i % 2 ? 'COMPANY NAME' : 'Company name', 36),
      candidate(`Unique title ${i}`),
    ]);
    expect(finalizeSlideTitles(pages)).toEqual(
      pages.map((_, i) => `Slide ${i + 1}: Unique title ${i}`),
    );
    expect(finalizeSlideTitles(pages.slice(0, 2))[0]).toBe('Slide 1: Company name');
    const boundary = [
      ...pages.slice(0, 4),
      ...Array.from({ length: 6 }, () => [candidate('Different')]),
    ];
    expect(finalizeSlideTitles(boundary)[0]).toBe('Slide 1: Company name');
  });

  it('uses positional labels throughout a deck with switchable layers', () => {
    expect(
      finalizeSlideTitles([[candidate('Hidden secret')], [candidate('Visible title')]], true),
    ).toEqual(['Slide 1: Untitled', 'Slide 2: Untitled']);
  });

  it('caps candidate lists and numbered labels without splitting Unicode', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      run(`Heading ${i}`, {
        transform: [12, 0, 0, 12, 40 + (i % 10) * 65, 420 - Math.floor(i / 10) * 30],
        width: 50,
      }),
    );
    expect(
      extractTitleCandidates({ items, styles: {}, lang: null }, viewport()).length,
    ).toBeLessThanOrEqual(12);
    for (let i = 1; i <= 60; i++) {
      const label = slideLabel(i, '🚀'.repeat(200));
      expect(label.length).toBeLessThanOrEqual(200);
      expect(label.endsWith('🚀')).toBe(true);
      expect(isMetaPattern(label)).toBe(false);
    }
  });
});

const slide = (
  title: string,
  image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
): DeckSlide => ({ title, image, width: 1600, height: 1000 });

describe('HTML assembly', () => {
  it('emits exactly the per-slide markup measured by the tracker fixture', async () => {
    const slides = [
      'Slide 1: Company overview',
      'Slide 2: Untitled',
      'Slide 3: 日本語の紹介',
      'Slide 4: Next steps',
    ].map((title) => ({
      title,
      width: 1600,
      height: 1280,
      image: new Blob([new Uint8Array([0])], { type: 'image/png' }),
    }));
    const html = await (await assembleDeckHtml('deck.pdf', slides)).text();
    expect(html.match(/<details[\s\S]*?<\/details>/)?.[0]).toBe(PDF_DECK_TOC);
    expect(html.match(/<section class="slide">[\s\S]*<\/section>/)?.[0]).toBe(PDF_DECK_SECTIONS);
    expect(html).toContain(`${PDF_DECK_TOC}<main>${PDF_DECK_SECTIONS}`);
    expect(html).not.toMatch(/href="(?!#slide-\d+")/);
    expect(new Blob([html]).size).toBe(new TextEncoder().encode(html).byteLength);
  });

  it.each([0, 1, 2])('omits contents entirely with only %i detected titles', async (named) => {
    const html = await (
      await assembleDeckHtml(
        'deck.pdf',
        Array.from({ length: 4 }, (_, i) =>
          slide(`Slide ${i + 1}: ${i < named ? 'Title' : 'Untitled'}`),
        ),
      )
    ).text();
    expect(html).not.toMatch(/<details|<summary|<a\s/);
    expect(html.match(/<h2 /g)).toHaveLength(4);
  });

  it('sanitises suggested download names', () => {
    expect(downloadFilename('a/b\\c"d\n.pdf')).toBe('abcd.html');
    expect(downloadFilename('/\\.pdf')).toBe('deck.html');
    expect(downloadFilename('日本語.pdf')).toBe('日本語.html');
  });

  it('emits the fixed offline structure, correct labels, dimensions, lazy images, and final credit', async () => {
    const html = await assembleDeckHtml('Agency.pdf', [
      slide('Slide 1: Company overview'),
      slide('Slide 2: Untitled'),
    ]);
    const text = await html.text();
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<title>Agency</title>');
    expect(text).toContain('<meta name="robots" content="noindex">');
    expect(text.match(/<main>/g)).toHaveLength(1);
    expect(text.match(/<section class="slide">/g)).toHaveLength(2);
    expect(text.match(/<h[1-3]\b/g)).toHaveLength(2);
    expect(text).toContain('<h2 id="slide-1" dir="auto">Slide 1: Company overview</h2><img');
    expect(text).toContain(
      'width="1600" height="1000" alt="Image of slide 2; text is not selectable." loading="lazy"',
    );
    expect(text.match(/loading="lazy"/g)).toHaveLength(1);
    expect(text).toContain('Converted with HTMLRadar.</p></section></main>');
    expect(text).toContain('.slide{position:relative}');
    expect(text).toContain('width:1px;height:1px');
    expect(text).not.toMatch(/<script|<iframe|<link|https?:\/\//i);
    expect(html.size).toBe(new TextEncoder().encode(text).byteLength);
  });

  it('escapes the adversarial PDF title and filename as text, including controls and quotes', async () => {
    const payload =
      '</h2></title><img src="https://evil.example/leak?q=\'secret\'" onerror="alert(1)"> & \u0000';
    const extracted = labelFor([run(payload)]);
    const text = await (
      await assembleDeckHtml(`${payload}.pdf`, [slide(extracted), slide('Slide 2: Untitled')])
    ).text();
    expect(text).not.toContain('<img src="https:');
    expect(text).not.toContain('\u0000');
    expect(text).toContain(
      '&lt;/h2&gt;&lt;/title&gt;&lt;img src=&quot;https://evil.example/leak?q=&#39;secret&#39;&quot;',
    );
    expect(text.match(/<img /g)).toHaveLength(2);
    expect(text.match(/<h2 /g)).toHaveLength(2);
  });

  it('counts base64 expansion and Unicode bytes before encoding images', async () => {
    const oversized = new Blob([new Uint8Array(16 * 1024 * 1024)], { type: 'image/png' });
    const encode = vi.spyOn(oversized, 'arrayBuffer');
    await expect(
      assembleDeckHtml('日本語.pdf', [
        slide('Slide 1: 日本語', oversized),
        slide('Slide 2: Untitled'),
      ]),
    ).rejects.toMatchObject({ code: 'overflow', message: PDF_DECK_MESSAGES.overflow });
    expect(encode).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'accepts exactly 20 MiB and rejects one byte more, with contents: %s',
    async (contents) => {
      const pages = [slide('Slide 1: Title'), slide('Slide 2: Untitled')];
      if (contents) pages.push(slide('Slide 3: 日本語の紹介'), slide('Slide 4: Next steps'));
      const initial = await assembleDeckHtml('test.pdf', pages);
      const remaining = MAX_DECK_BYTES - initial.size;
      pages[0]!.image = new Blob([new Uint8Array(3 + Math.floor(remaining / 4) * 3)], {
        type: 'image/jpeg',
      });
      const name = `test${'x'.repeat(remaining % 4)}.pdf`;
      expect((await assembleDeckHtml(name, pages)).size).toBe(MAX_DECK_BYTES);
      await expect(assembleDeckHtml(`x${name}`, pages)).rejects.toMatchObject({ code: 'overflow' });
    },
  );

  it('rejects non-raster image sources and out-of-bounds dimensions', async () => {
    await expect(
      assembleDeckHtml('test.pdf', [
        slide('Slide 1: Title', new Blob(['<svg/>'], { type: 'image/svg+xml' })),
      ]),
    ).rejects.toMatchObject({ code: 'damaged' });
    await expect(
      assembleDeckHtml('test.pdf', [{ ...slide('Slide 1: Title'), height: 1281 }]),
    ).rejects.toMatchObject({ code: 'damaged' });
  });
});

describe('runtime loading and conversion lifecycle', () => {
  async function runtime(data: Uint8Array) {
    const pdf = await open(data);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getDocument = vi.fn().mockReturnValue({ promise: Promise.resolve(pdf), destroy });
    const GlobalWorkerOptions = { workerSrc: '' };
    vi.doMock(`${PDFJS_BASE_URL}pdf.mjs`, () => ({
      getDocument,
      GlobalWorkerOptions,
      AnnotationMode: pdfjs.AnnotationMode,
      PDFWorker: { create: () => ({ destroy: vi.fn() }) },
    }));
    const canvases: Array<{
      width: number;
      height: number;
      toBlob: Mock<[callback: (blob: Blob | null) => void, type: string, quality?: number], void>;
    }> = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          toBlob: vi.fn((callback: (blob: Blob | null) => void, type: string) =>
            callback(new Blob([new Uint8Array(type === 'image/jpeg' ? 30 : 20)], { type })),
          ),
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    const renders: MockInstance<
      Parameters<PDFPageProxy['render']>,
      ReturnType<PDFPageProxy['render']>
    >[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      renders.push(
        vi
          .spyOn(page, 'render')
          .mockImplementation(
            () =>
              ({ promise: Promise.resolve(), cancel: vi.fn() }) as unknown as ReturnType<
                typeof page.render
              >,
          ),
      );
    }
    return { pdf, destroy, getDocument, GlobalWorkerOptions, canvases, renders };
  }

  const file = () => new File(['%PDF- synthetic'], 'deck.pdf', { type: 'application/pdf' });

  it('reports mixed sizes when a later page exceeds the canvas height within the two-percent tolerance', async () => {
    const env = await runtime(
      await fixture(4, (pdf) => {
        pdf.getPages().forEach((page, i) => page.setSize(562.5, i === 3 ? 454 : 450));
      }),
    );
    await expect(convertPdfToDeck(file())).rejects.toMatchObject({ code: 'sizes' });
    expect(env.renders[3]).not.toHaveBeenCalled();
    expect(env.destroy).toHaveBeenCalledOnce();
  });

  it('loads matching runtime assets and converts sequentially, choosing the smaller PNG', async () => {
    const env = await runtime(await fixture(2));
    const onProgress = vi.fn();
    const onPreview = vi.fn();
    const result = await convertPdfToDeck(file(), { onProgress, onPreview });
    expect(env.GlobalWorkerOptions.workerSrc).toBe(`${PDFJS_BASE_URL}pdf.worker.mjs`);
    expect(env.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapUrl: `${PDFJS_BASE_URL}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS_BASE_URL}standard_fonts/`,
        wasmUrl: `${PDFJS_BASE_URL}wasm/`,
        iccUrl: `${PDFJS_BASE_URL}iccs/`,
        stopAtErrors: true,
        enableXfa: false,
      }),
    );
    expect(result.slides.map(({ title }) => title)).toEqual([
      'Slide 1: Untitled',
      'Slide 2: Our presentation slide number 2',
    ]);
    expect(result.slides.every(({ image }) => image.type === 'image/png')).toBe(true);
    expect(result.bytes).toBe(result.html.size);
    expect(onPreview).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls.map(([event]) => event.phase)).toEqual([
      'checking',
      'rendering',
      'rendering',
      'complete',
    ]);
    for (const canvas of env.canvases) {
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(canvas.toBlob.mock.calls.map((call) => call.slice(1))).toEqual([
        ['image/jpeg', 0.8],
        ['image/png', undefined],
      ]);
    }
    expect(env.renders[0]).toHaveBeenCalledWith(
      expect.objectContaining({
        background: 'rgb(255,255,255)',
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      }),
    );
    expect(env.destroy).toHaveBeenCalledOnce();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('rejects a late page-size failure without returning a partial deck', async () => {
    const env = await runtime(
      await fixture(4, (doc) => {
        doc.getPage(3).setSize(750, 450);
      }),
    );
    await expect(convertPdfToDeck(file())).rejects.toMatchObject({ code: 'sizes' });
    expect(env.renders[3]).not.toHaveBeenCalled();
    expect(env.destroy).toHaveBeenCalledOnce();
  });

  it('applies the aspect admission rule to the opening sample and bounds every output canvas', async () => {
    const env = await runtime(
      await fixture(4, (doc) => {
        doc.getPages().forEach((page, i) => page.setSize(i === 3 ? 909 : 900, 450));
      }),
    );
    const result = await convertPdfToDeck(file());
    expect(result.slides[3]?.width).toBe(1600);
    expect(result.slides[3]?.height).toBe(792);
    expect(env.renders[3]).toHaveBeenCalledOnce();
  });

  it('keeps JPEG when it is smaller and stops on output overflow before the next render', async () => {
    for (const large of [false, true]) {
      const env = await runtime(await fixture(2));
      vi.stubGlobal('document', {
        createElement: () => ({
          width: 0,
          height: 0,
          toBlob: (callback: (blob: Blob) => void, type: string) =>
            callback(
              new Blob(
                [new Uint8Array((large ? 16 * 1024 * 1024 : 10) + (type === 'image/png' ? 1 : 0))],
                { type },
              ),
            ),
        }),
      });
      if (large) {
        await expect(convertPdfToDeck(file())).rejects.toMatchObject({ code: 'overflow' });
        expect(env.renders[1]).not.toHaveBeenCalled();
      } else {
        expect(
          (await convertPdfToDeck(file())).slides.every(({ image }) => image.type === 'image/jpeg'),
        ).toBe(true);
      }
      expect(env.destroy).toHaveBeenCalledOnce();
      vi.restoreAllMocks();
    }
  });

  it('renders generated PDFs with the real pdf.js renderer and native test canvases', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvases: HTMLCanvasElement[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = createCanvas(1, 1);
        canvas.toBlob = (callback: (blob: Blob) => void, type: string, quality?: number) => {
          callback(
            new Blob([canvas.toBuffer(type, quality === undefined ? undefined : quality * 100)], {
              type,
            }),
          );
        };
        canvases.push(canvas);
        return canvas;
      },
    });
    const data = await fixture(2);
    vi.doMock(`${PDFJS_BASE_URL}pdf.mjs`, () => ({
      GlobalWorkerOptions: {},
      AnnotationMode: pdfjs.AnnotationMode,
      PDFWorker: { create: () => ({ destroy: vi.fn() }) },
      getDocument: () => pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }),
    }));
    const result = await convertPdfToDeck(file());
    expect(result.slides).toHaveLength(2);
    expect(
      result.slides.every(
        ({ image, width, height }) => image.size > 100 && width === 1600 && height === 1000,
      ),
    ).toBe(true);
    expect(result.slides[1]!.image.size).toBeGreaterThan(result.slides[0]!.image.size);
    // The native test canvas resets zero dimensions to its 350 × 150
    // defaults. Browser zeroing itself is asserted in the lifecycle test.
    expect(canvases.map(({ width, height }) => [width, height])).toEqual([
      [350, 150],
      [350, 150],
    ]);
    const { loadImage } = require('@napi-rs/canvas');
    for (const { image } of result.slides) {
      const decoded = await loadImage(Buffer.from(await image.arrayBuffer()));
      expect([decoded.width, decoded.height]).toEqual([1600, 1000]);
    }
  });

  it('cancels during admission and during encoding without publishing completion', async () => {
    for (const phase of ['admission', 'encoding']) {
      const env = await runtime(await fixture(2));
      const controller = new AbortController();
      const onProgress = vi.fn();
      if (phase === 'admission') {
        vi.spyOn(env.pdf, 'getMetadata').mockImplementation(() => {
          queueMicrotask(() => controller.abort());
          return new Promise(() => {});
        });
      } else {
        vi.stubGlobal('document', {
          createElement: () => ({ width: 0, height: 0, toBlob: () => controller.abort() }),
        });
      }
      await expect(
        convertPdfToDeck(file(), { signal: controller.signal, onProgress }),
      ).rejects.toMatchObject({ code: 'cancelled' });
      expect(onProgress.mock.calls.every(([event]) => event.phase !== 'complete')).toBe(true);
      expect(env.destroy).toHaveBeenCalledOnce();
      expect(env.renders[1]).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('rejects a late orphan widget before rendering that page', async () => {
    const env = await runtime(
      await fixture(4, (doc) => {
        const widget = doc.context.register(
          doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Tx', Rect: [0, 0, 100, 20] }),
        );
        doc.getPage(3).node.set(PDFName.of('Annots'), doc.context.obj([widget]));
      }),
    );
    await expect(convertPdfToDeck(file())).rejects.toMatchObject({ code: 'forms' });
    expect(env.renders[3]).not.toHaveBeenCalled();
  });

  it('cancels an in-flight render and releases the worker and canvas', async () => {
    const env = await runtime(await fixture(2));
    const controller = new AbortController();
    const cancelled = vi.fn();
    const renderCancel = vi.fn();
    env.renders[0]!.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return { promise: new Promise(() => {}), cancel: renderCancel } as unknown as ReturnType<
        PDFPageProxy['render']
      >;
    });
    await expect(
      convertPdfToDeck(file(), { signal: controller.signal, onCancel: cancelled }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(renderCancel).toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(env.destroy).toHaveBeenCalledOnce();
    expect(env.canvases[0]?.width).toBe(0);
    expect(env.renders[1]).not.toHaveBeenCalled();
  });

  it('cancels and rejects a render that exceeds twenty seconds', async () => {
    const env = await runtime(await fixture(2));
    // A stuck worker cannot acknowledge teardown; rejection still returns.
    env.destroy.mockImplementation(() => new Promise(() => {}));
    const cancel = vi.fn();
    env.renders[0]!.mockImplementation(() => {
      vi.useFakeTimers();
      queueMicrotask(() => {
        void vi.advanceTimersByTimeAsync(20_000);
      });
      return { promise: new Promise(() => {}), cancel } as unknown as ReturnType<
        PDFPageProxy['render']
      >;
    });
    await expect(convertPdfToDeck(file())).rejects.toMatchObject({
      code: 'timeout',
      message: PDF_DECK_MESSAGES.timeout,
    });
    expect(cancel).toHaveBeenCalled();
    expect(env.canvases[0]?.width).toBe(0);
    expect(env.destroy).toHaveBeenCalledOnce();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('rejects worker startup failure without waiting for an admission reply', async () => {
    const env = await runtime(await fixture(2));
    const onCancel = vi.fn();
    vi.spyOn(env.pdf, 'getMetadata').mockImplementation(() => {
      queueMicrotask(() => workers[0]!.dispatchEvent(new Event('error', { cancelable: true })));
      return new Promise(() => {});
    });
    env.destroy.mockImplementation(() => new Promise(() => {}));
    await expect(convertPdfToDeck(file(), { onCancel })).rejects.toMatchObject({ code: 'damaged' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('rejects an encoding failure and releases its canvas', async () => {
    const env = await runtime(await fixture(2));
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          toBlob: vi.fn((callback: (blob: Blob | null) => void, _type: string) => callback(null)),
        };
        env.canvases.push(canvas);
        return canvas;
      },
    });
    await expect(convertPdfToDeck(file())).rejects.toMatchObject({ code: 'damaged' });
    expect(env.canvases[0]?.width).toBe(0);
    expect(env.destroy).toHaveBeenCalledOnce();
  });

  it('returns fixed password and damaged-file messages without raw parser details', async () => {
    for (const [name, code] of [
      ['PasswordException', 'password'],
      ['InvalidPDFException', 'damaged'],
    ] as const) {
      const destroy = vi.fn().mockResolvedValue(undefined);
      vi.doMock(`${PDFJS_BASE_URL}pdf.mjs`, () => ({
        GlobalWorkerOptions: {},
        PDFWorker: { create: () => ({ destroy: vi.fn() }) },
        getDocument: () => ({
          promise: Promise.reject(Object.assign(new Error('private title'), { name })),
          destroy,
        }),
      }));
      await expect(convertPdfToDeck(file())).rejects.toMatchObject({
        code,
        message: PDF_DECK_MESSAGES[code],
      });
      expect(destroy).toHaveBeenCalledOnce();
    }
  });

  it('pdf.js refuses a generated encrypted trailer without invoking password entry', async () => {
    const bytes = await fixture(2, (doc) => {
      doc.context.trailerInfo.Encrypt = doc.context.register(
        doc.context.obj({
          Filter: 'Standard',
          V: 1,
          R: 2,
          P: -4,
          O: PDFHexString.of('00'.repeat(32)),
          U: PDFHexString.of('00'.repeat(32)),
        }),
      );
    });
    const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
    await expect(task.promise).rejects.toMatchObject({ name: 'PasswordException' });
    await task.destroy();
  });

  it('rejects wrong bytes before loading pdf.js and supports cancellation before selection', async () => {
    await expect(convertPdfToDeck(new File(['not a pdf'], 'deck.pdf'))).rejects.toMatchObject({
      code: 'format',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(convertPdfToDeck(file(), { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
    await expect(assembleDeckHtml('test.pdf', [], controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('does not import pdf.js when this library is imported; loading is explicit', async () => {
    const getDocument = vi.fn();
    vi.doMock(`${PDFJS_BASE_URL}pdf.mjs`, () => ({ GlobalWorkerOptions: {}, getDocument }));
    await loadPdfJs();
    expect(getDocument).not.toHaveBeenCalled();
  });
});
