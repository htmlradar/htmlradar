import type { PDFDocumentProxy, PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import pdfjsPackage from 'pdfjs-dist/package.json';
import { isMetaPattern } from '../../../tracker/src/sections-v2';

export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_DECK_BYTES = 20 * 1024 * 1024;
export const PDFJS_BASE_URL = `/pdfjs/${pdfjsPackage.version}/`;
const WIDTH = 1600;
const MAX_HEIGHT = 1280;
const MAX_PIXELS = WIDTH * MAX_HEIGHT;
const MAX_CANDIDATES = 12;
const RENDER_TIMEOUT_MS = 20_000;

export const PDF_DECK_MESSAGES = {
  portrait:
    'This tool accepts landscape slide decks; export your document as landscape slides and try again.',
  aspect: 'Use a landscape slide size between 5:4 and 2:1.',
  text: 'We couldn’t find selectable text in the opening slides; export a PDF with text from your presentation app.',
  forms: 'This PDF contains form fields; export a flattened presentation PDF and try again.',
  sizes: 'The slides have different page sizes; export every slide at the same size and try again.',
  pages: 'This deck has more than 60 slides; export a shorter deck and try again.',
  single: 'Choose a PDF deck with at least two slides.',
  size: 'This PDF is over 30 MB; export a smaller PDF and try again.',
  format: 'Choose a PDF exported from your presentation app.',
  password: 'Export a PDF without password protection and try again.',
  damaged: 'We couldn’t read this PDF; export it again from the original app.',
  attachments: 'Choose the presentation PDF itself, without attached files.',
  timeout: 'This slide is too complex for this browser; export a simpler PDF and try again.',
  overflow: 'The HTML file would exceed 20 MB; export fewer slides and try again.',
  cancelled: 'Conversion cancelled.',
} as const;

export class PdfDeckError extends Error {
  constructor(public readonly code: keyof typeof PDF_DECK_MESSAGES) {
    super(PDF_DECK_MESSAGES[code]);
    this.name = 'PdfDeckError';
  }
}

export interface TitleCandidate {
  text: string;
  size: number;
  x: number;
  y: number;
  width: number;
  dir: string;
  ambiguous: boolean;
}

export interface DeckSlide {
  image: Blob;
  width: number;
  height: number;
  title: string;
}

export interface PdfDeckOptions {
  signal?: AbortSignal;
  onProgress?: (progress: {
    phase: 'checking' | 'rendering' | 'complete';
    page: number;
    total: number;
  }) => void;
  // A Blob, not a decoded image or a gallery. The panel owns any preview URL
  // it creates, and must revoke it on replacement, cancellation and unmount.
  // This first label is provisional until running headers are removed.
  onPreview?: (slide: DeckSlide) => void;
  onCancel?: () => void;
}

export interface PdfDeck {
  html: Blob;
  filename: string;
  bytes: number;
  slides: DeckSlide[];
}

type PdfJs = typeof import('pdfjs-dist');

export async function loadPdfJs(): Promise<PdfJs> {
  const url = `${PDFJS_BASE_URL}pdf.mjs`;
  const pdfjs: PdfJs = await import(/* webpackIgnore: true */ url);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}pdf.worker.mjs`;
  return pdfjs;
}

export function downloadFilename(name: string): string {
  const stem = cleanText(name.replace(/\.pdf$/i, '').replace(/[\\/"'<>:|?*\p{Cc}]/gu, ''));
  return `${truncate(stem, 180) || 'deck'}.html`;
}

export function validatePdfFile(file: Pick<File, 'name' | 'type' | 'size'>): void {
  if (file.size > MAX_PDF_BYTES) throw new PdfDeckError('size');
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')
    throw new PdfDeckError('format');
}

export function validatePageSize(
  page: Pick<PageViewport, 'width' | 'height'>,
  first = page,
  sampled = true,
): void {
  const { width, height } = page;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PdfDeckError('damaged');
  }
  if (sampled) {
    if (width < height) throw new PdfDeckError('portrait');
    const ratio = width / height;
    if (ratio < 1.25 || ratio > 2) throw new PdfDeckError('aspect');
  }
  if (
    Math.abs(width - first.width) > first.width * 0.02 + 1e-8 ||
    Math.abs(height - first.height) > first.height * 0.02 + 1e-8
  ) {
    throw new PdfDeckError('sizes');
  }
}

function cleanText(text: string): string {
  return text
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  let out = '';
  for (const character of text) {
    if (out.length + character.length > max) break;
    out += character;
  }
  return out;
}

function pageNumber(text: string): boolean {
  return /^(?:(?:page|slide)\s*)?\p{N}+(?:\s*(?:of|[/—-])\s*\p{N}+)?$/iu.test(text);
}

function date(text: string): boolean {
  const month =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  return (
    /^\d{4}$/.test(text) ||
    /^\d{1,4}([/.-])\d{1,2}\1\d{1,4}$/.test(text) ||
    /^\d{4}年\d{1,2}月(?:\d{1,2}日)?$/u.test(text) ||
    new RegExp(
      `^(?:${month}\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{4})|\\d{1,2}(?:st|nd|rd|th)?\\s+${month}\\.?(?:,?\\s+\\d{4})?)$`,
      'i',
    ).test(text)
  );
}

function usefulTitle(text: string): boolean {
  if (
    pageNumber(text) ||
    date(text) ||
    /^[•·●○▪▫▶▸►→⟶*\-–—]|^(?:\(?\d+|[a-zA-Z])[.)]\s/u.test(text)
  )
    return false;
  return (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2 && /\p{L}/u.test(text);
}

export function hasOpeningText(content: TextContent): boolean {
  let count = 0;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const text = cleanText(item.str);
    if (!pageNumber(text)) count += text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    if (count >= 20) return true;
  }
  return false;
}

export function extractTitleCandidates(
  content: TextContent,
  viewport: PageViewport,
): TitleCandidate[] {
  const [a, b, c, d] = viewport.transform as [number, number, number, number, number, number];
  const runs: Array<TitleCandidate & { spaceBefore: boolean; spaceAfter: boolean }> = [];
  for (const item of content.items) {
    if (!('str' in item) || item.dir === 'ttb' || content.styles[item.fontName]?.vertical) continue;
    const [ta, tb, tc, td, tx, ty] = item.transform as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const dx = a * ta + c * tb;
    const dy = b * ta + d * tb;
    const size = Math.hypot(a * tc + c * td, b * tc + d * td);
    const [x, y] = viewport.convertToViewportPoint(tx, ty) as [number, number];
    const text = cleanText(item.str);
    if (
      !text ||
      ![x, y, size, dx, dy, item.width].every(Number.isFinite) ||
      size < 12 ||
      dx <= 0 ||
      Math.abs(dy) > Math.abs(dx) * 0.03 ||
      y - size < 0 ||
      y > viewport.height * 0.4
    )
      continue;
    runs.push({
      text: truncate(text, 400),
      size,
      x,
      y,
      width: Math.abs(item.width * viewport.scale * viewport.userUnit),
      dir: item.dir,
      ambiguous: false,
      spaceBefore: /^\s/u.test(item.str),
      spaceAfter: /\s$/u.test(item.str),
    });
  }
  runs.sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: Array<typeof runs> = [];
  for (const run of runs) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - run.y) <= Math.min(row[0]!.size, run.size) * 0.15)
      row.push(run);
    else rows.push([run]);
  }
  const lines: typeof runs = [];
  for (const run of rows.flatMap((row) => row.sort((left, right) => left.x - right.x))) {
    const line = lines.at(-1);
    const gap = line ? run.x - line.x - line.width : Infinity;
    if (
      line &&
      Math.abs(line.y - run.y) <= Math.min(line.size, run.size) * 0.15 &&
      Math.abs(line.size - run.size) <= line.size * 0.1 &&
      gap >= -line.size * 0.1 &&
      gap <= line.size * 0.65
    ) {
      const tracked = Array.from(run.text).length === 1 && !line.text.includes(' ');
      // ponytail: multi-run RTL or loosely tracked letters use Untitled;
      // reconstruct order only with evidence from real export fixtures.
      line.ambiguous ||=
        line.dir !== run.dir || run.dir === 'rtl' || (tracked && gap > line.size * 0.2);
      const separator = line.spaceAfter || run.spaceBefore || gap > line.size * 0.2 ? ' ' : '';
      line.text = truncate(`${line.text}${separator}${run.text}`, 400);
      line.spaceAfter = run.spaceAfter;
      line.width = run.x + run.width - line.x;
    } else {
      lines.push({ ...run });
    }
  }
  const titles: TitleCandidate[] = [];
  let lineCount = 0;
  for (const [i, line] of lines.entries()) {
    const title = titles.at(-1);
    const previous = lines[i - 1];
    if (
      title &&
      previous &&
      lineCount < 3 &&
      !title.ambiguous &&
      !line.ambiguous &&
      usefulTitle(title.text) &&
      usefulTitle(line.text) &&
      title.dir === line.dir &&
      Math.abs(title.size - line.size) <= 0.01 &&
      Math.abs(title.x - line.x) <= 0.5 &&
      line.y - previous.y >= line.size * 0.8 &&
      line.y - previous.y <= line.size * 1.6
    ) {
      // ponytail: join at most three consecutive aligned lines; longer or
      // ambiguous layouts keep the existing title-ranking fallback.
      title.text = truncate(`${title.text} ${line.text}`, 400);
      title.width = Math.max(title.width, line.width);
      lineCount++;
    } else {
      titles.push({ ...line });
      lineCount = 1;
    }
  }
  return titles
    .filter((line) => usefulTitle(line.text))
    .sort((left, right) => right.size - left.size || left.y - right.y || left.x - right.x)
    .slice(0, MAX_CANDIDATES);
}

export function slideLabel(page: number, title: string): string {
  const label = truncate(`Slide ${page}: ${cleanText(title) || 'Untitled'}`, 200);
  return isMetaPattern(label) ? `Slide ${page}: Untitled` : label;
}

export function finalizeSlideTitles(pages: TitleCandidate[][], positional = false): string[] {
  const normalize = (text: string) => cleanText(text).normalize('NFKC').toLowerCase();
  const counts = new Map<string, number>();
  for (const candidates of pages) {
    for (const key of new Set(candidates.map(({ text }) => normalize(text)))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return pages.map((candidates, i) => {
    const remaining = candidates.filter(({ text }) => {
      const count = counts.get(normalize(text)) ?? 0;
      return count < 3 || count <= pages.length * 0.4;
    });
    const first = remaining[0];
    const ambiguous =
      first?.ambiguous ||
      remaining
        .slice(1)
        .some((other) => first && Math.abs(first.size - other.size) <= first.size * 0.05);
    return slideLabel(i + 1, positional || !first || ambiguous ? 'Untitled' : first.text);
  });
}

function escapeHtml(text: string): string {
  return cleanText(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

function htmlStart(filename: string): string {
  const title = truncate(cleanText(filename.replace(/\.pdf$/i, '')), 200) || 'Untitled deck';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#fff}main{max-width:1600px;margin:0 auto}.slide{position:relative}.slide h2{position:absolute;top:0;left:0;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap}.slide img{display:block;width:100%;height:auto}details{max-width:1568px;margin:0 auto;padding:8px 16px;font:14px/1.5 sans-serif}summary{cursor:pointer}details ul{list-style:none;margin:8px 0 0;padding:0}details a{display:block;padding:4px 0;color:#5a1521;overflow-wrap:anywhere}details a:focus-visible,summary:focus-visible{outline:2px solid #7a1f2e;outline-offset:3px}.credit{margin:0;padding:8px 12px;font:12px sans-serif}</style></head><body>`;
}

const HTML_END = '</main></body></html>';

function contentsHtml(titles: string[]): string {
  const named = titles
    .map((title, i) => ({ title, i }))
    .filter(({ title }) => !/^Slide \d+: Untitled$/.test(title));
  if (named.length < 3) return '';
  return `<details><summary>Contents</summary><ul>${named.map(({ title, i }) => `<li><a href="#slide-${i + 1}" dir="auto">${escapeHtml(title)}</a></li>`).join('')}</ul></details>`;
}

function sectionHtml(slide: DeckSlide, index: number, last: boolean, data: string): string {
  return `<section class="slide"><h2 id="slide-${index + 1}" dir="auto">${escapeHtml(slide.title)}</h2><img src="${data}" width="${slide.width}" height="${slide.height}" alt="Image of slide ${index + 1}; text is not selectable."${index ? ' loading="lazy"' : ''}>${last ? '<p class="credit">Converted with HTMLRadar.</p>' : ''}</section>`;
}

function dataPrefix(image: Blob): string {
  if (!['image/jpeg', 'image/png'].includes(image.type) || !image.size)
    throw new PdfDeckError('damaged');
  return `data:${image.type};base64,`;
}

function sectionBytes(slide: DeckSlide, index: number, last: boolean): number {
  return (
    new TextEncoder().encode(sectionHtml(slide, index, last, dataPrefix(slide.image))).byteLength +
    4 * Math.ceil(slide.image.size / 3)
  );
}

function withinOutputLimit(bytes: number): void {
  if (bytes > MAX_DECK_BYTES) throw new PdfDeckError('overflow');
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason instanceof PdfDeckError ? signal.reason : new PdfDeckError('cancelled');
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason instanceof PdfDeckError ? signal.reason : new PdfDeckError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export async function assembleDeckHtml(
  filename: string,
  slides: DeckSlide[],
  signal?: AbortSignal,
): Promise<Blob> {
  checkCancelled(signal);
  const contents = contentsHtml(slides.map((slide) => slide.title));
  let bytes = new TextEncoder().encode(
    htmlStart(filename) + contents + '<main>' + HTML_END,
  ).byteLength;
  for (const [i, slide] of slides.entries()) {
    if (
      !Number.isInteger(slide.width) ||
      !Number.isInteger(slide.height) ||
      slide.width !== WIDTH ||
      slide.height <= 0 ||
      slide.height > MAX_HEIGHT
    )
      throw new PdfDeckError('damaged');
    bytes += sectionBytes(slide, i, i === slides.length - 1);
    withinOutputLimit(bytes);
  }
  const parts: BlobPart[] = [htmlStart(filename), contents, '<main>'];
  for (const [i, slide] of slides.entries()) {
    const buffer = new Uint8Array(await withAbort(slide.image.arrayBuffer(), signal));
    // Chunk the conversion so spread never exceeds the JS argument limit.
    let binary = '';
    for (let start = 0; start < buffer.length; start += 8192) {
      binary += String.fromCharCode(...buffer.subarray(start, start + 8192));
    }
    const data = dataPrefix(slide.image) + btoa(binary);
    parts.push(new Blob([sectionHtml(slide, i, i === slides.length - 1, data)]));
    checkCancelled(signal);
  }
  parts.push(HTML_END);
  const html = new Blob(parts, { type: 'text/html;charset=utf-8' });
  withinOutputLimit(html.size);
  return html;
}

async function checkWidgets(page: PDFPageProxy, signal?: AbortSignal): Promise<void> {
  const annotations = await withAbort(page.getAnnotations({ intent: 'any' }), signal);
  if (annotations.some((item: { subtype?: string }) => item.subtype === 'Widget'))
    throw new PdfDeckError('forms');
  if (annotations.some((item: { subtype?: string }) => item.subtype === 'FileAttachment'))
    throw new PdfDeckError('attachments');
}

export async function admitPdf(
  pdf: PDFDocumentProxy,
  signal?: AbortSignal,
): Promise<{
  first: PageViewport;
  positional: boolean;
  candidates: TitleCandidate[][];
}> {
  checkCancelled(signal);
  if (pdf.numPages < 2) throw new PdfDeckError('single');
  if (pdf.numPages > 60) throw new PdfDeckError('pages');
  const { info } = await withAbort(pdf.getMetadata(), signal);
  const metadata = info as Record<string, unknown>;
  if (metadata.IsAcroFormPresent || metadata.IsXFAPresent || pdf.isPureXfa)
    throw new PdfDeckError('forms');
  if (metadata.IsCollectionPresent) throw new PdfDeckError('attachments');
  const fields = await withAbort(pdf.getFieldObjects(), signal);
  if (fields?.size) throw new PdfDeckError('forms');
  const attachments = await withAbort(pdf.getAttachments(), signal);
  if (attachments?.size) throw new PdfDeckError('attachments');
  const layers = await withAbort(pdf.getOptionalContentConfig(), signal);
  const positional = !layers[Symbol.iterator]().next().done;
  let first: PageViewport | undefined;
  let textPresent = false;
  const candidates: TitleCandidate[][] = [];
  for (let number = 1; number <= Math.min(3, pdf.numPages); number++) {
    const page = await withAbort(pdf.getPage(number), signal);
    try {
      const viewport = page.getViewport({ scale: 1 });
      first ??= viewport;
      validatePageSize(viewport, first);
      await checkWidgets(page, signal);
      const text = await withAbort(page.getTextContent(), signal);
      textPresent ||= hasOpeningText(text);
      candidates.push(positional ? [] : extractTitleCandidates(text, viewport));
    } finally {
      page.cleanup();
    }
  }
  if (!textPresent) throw new PdfDeckError('text');
  return { first: first!, positional, candidates };
}

async function encodeCanvas(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  const encode = (type: string, quality?: number) =>
    withAbort(
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob?.size && blob.type === type ? resolve(blob) : reject(new PdfDeckError('damaged')),
          type,
          quality,
        );
      }),
      signal,
    );
  const jpeg = await encode('image/jpeg', 0.8);
  const png = await encode('image/png');
  return jpeg.size <= png.size ? jpeg : png;
}

/** Local-only conversion. No upload, analytics, PDF links, or scripting layer. */
export async function convertPdfToDeck(file: File, options: PdfDeckOptions = {}): Promise<PdfDeck> {
  const controller = new AbortController();
  const signal = controller.signal;
  const cancelFromCaller = () => controller.abort(new PdfDeckError('cancelled'));
  options.signal?.addEventListener('abort', cancelFromCaller, { once: true });
  if (options.signal?.aborted) cancelFromCaller();
  let loading: ReturnType<PdfJs['getDocument']> | undefined;
  let destroying: Promise<void> | undefined;
  let render: ReturnType<PDFPageProxy['render']> | undefined;
  let worker: Worker | undefined;
  let pdfWorker: InstanceType<PdfJs['PDFWorker']> | undefined;
  const destroy = () => (destroying ??= loading?.destroy());
  const releaseWorker = () => {
    pdfWorker?.destroy();
    pdfWorker = undefined;
    worker?.terminate();
    worker = undefined;
  };
  const cancel = () => {
    render?.cancel();
    void destroy()?.catch(() => undefined);
    releaseWorker();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkCancelled(signal);
    validatePdfFile(file);
    options.onProgress?.({ phase: 'checking', page: 0, total: 0 });
    const data = new Uint8Array(await withAbort(file.arrayBuffer(), signal));
    if (!new TextDecoder().decode(data.subarray(0, 1024)).includes('%PDF-'))
      throw new PdfDeckError('format');
    const pdfjs = await withAbort(loadPdfJs(), signal);
    // Own the native worker: pdf.js's cooperative destroy waits for an
    // acknowledgement, which a stuck parser cannot send. Supplying a port
    // also prevents a failed worker from moving PDF work onto the UI thread.
    worker = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, { type: 'module' });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      controller.abort(new PdfDeckError('damaged'));
    });
    pdfWorker = pdfjs.PDFWorker.create({ port: worker });
    loading = pdfjs.getDocument({
      data,
      worker: pdfWorker,
      cMapUrl: `${PDFJS_BASE_URL}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE_URL}standard_fonts/`,
      wasmUrl: `${PDFJS_BASE_URL}wasm/`,
      iccUrl: `${PDFJS_BASE_URL}iccs/`,
      // pdf.js 6 removed eval and the isEvalSupported option entirely.
      // Never load its viewer/scripting sandbox or annotation layer.
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
      canvasMaxAreaInBytes: MAX_PIXELS * 4,
    });
    // With no onPassword handler, pdf.js rejects password entry requests.
    const pdf = await withAbort(loading.promise, signal);
    const admission = await admitPdf(pdf, signal);
    const slides: DeckSlide[] = [];
    // Title detection may omit the contents block altogether. Count the
    // fixed shell now; assembly includes the exact optional block and labels
    // before encoding images, so this lower bound cannot reject a deck that fits.
    let bytes = new TextEncoder().encode(htmlStart(file.name) + '<main>' + HTML_END).byteLength;
    for (let number = 1; number <= pdf.numPages; number++) {
      checkCancelled(signal);
      options.onProgress?.({ phase: 'rendering', page: number, total: pdf.numPages });
      const page = await withAbort(pdf.getPage(number), signal);
      let canvas: HTMLCanvasElement | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const viewport = page.getViewport({ scale: 1 });
        validatePageSize(viewport, admission.first, number <= 3);
        await checkWidgets(page, signal);
        if (number > 3) {
          admission.candidates.push(
            admission.positional
              ? []
              : extractTitleCandidates(await withAbort(page.getTextContent(), signal), viewport),
          );
        }
        const output = page.getViewport({ scale: WIDTH / viewport.width });
        const height = Math.round(output.height);
        if (height > MAX_HEIGHT || WIDTH * height > MAX_PIXELS) throw new PdfDeckError('sizes');
        canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = height;
        render = page.render({
          canvas,
          viewport: output,
          background: 'rgb(255,255,255)',
          annotationMode: pdfjs.AnnotationMode.DISABLE,
        });
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new PdfDeckError('timeout'));
            render?.cancel();
          }, RENDER_TIMEOUT_MS);
        });
        await withAbort(Promise.race([render.promise, timeout]), signal);
        clearTimeout(timer);
        render = undefined;
        const image = await encodeCanvas(canvas, signal);
        const title = slideLabel(number, 'Untitled');
        const slide = { image, width: WIDTH, height, title };
        slides.push(slide);
        // Count image expansion and fixed markup now. Labels finalize after
        // header removal; assembleDeckHtml checks their exact escaped bytes
        // before base64 encoding, without rejecting a deck that could fit.
        bytes += sectionBytes(
          { ...slide, title: `Slide ${number}: ` },
          number - 1,
          number === pdf.numPages,
        );
        withinOutputLimit(bytes);
        if (number === 1) options.onPreview?.(slide);
      } finally {
        clearTimeout(timer);
        render?.cancel();
        render = undefined;
        if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    const titles = finalizeSlideTitles(admission.candidates, admission.positional);
    slides.forEach((slide, i) => {
      slide.title = titles[i]!;
    });
    const html = await assembleDeckHtml(file.name, slides, signal);
    await withAbort(destroy()!, signal);
    releaseWorker();
    checkCancelled(signal);
    options.onProgress?.({ phase: 'complete', page: slides.length, total: slides.length });
    checkCancelled(signal);
    return {
      html,
      filename: downloadFilename(file.name),
      bytes: html.size,
      slides,
    };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof PdfDeckError && error.code === 'cancelled')) {
      options.onCancel?.();
      throw new PdfDeckError('cancelled');
    }
    if (error instanceof PdfDeckError) throw error;
    if (error instanceof Error && error.name === 'PasswordException')
      throw new PdfDeckError('password');
    throw new PdfDeckError('damaged');
  } finally {
    signal?.removeEventListener('abort', cancel);
    options.signal?.removeEventListener('abort', cancelFromCaller);
    // On failure, don't wait for a worker acknowledgement: terminate it.
    // Teardown must not surface raw PDF errors or replace our fixed message.
    void destroy()?.catch(() => undefined);
    releaseWorker();
  }
}
