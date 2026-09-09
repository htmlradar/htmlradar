'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { captureClientEvent } from '@/lib/events-client';
import {
  convertPdfToDeck,
  PdfDeckError,
  PDF_DECK_MESSAGES,
  type DeckSlide,
  type PdfDeck,
} from '@/lib/pdf-to-deck';
import { HANDOFF_MESSAGES, useStagedHandoff, type HandoffAction } from '@/lib/staged-handoff';
import { SampleReport } from './SampleReport';

type State = 'empty' | 'dragging' | 'rejected' | 'converting' | 'done' | 'error';
const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 py-3 text-[15px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40';
const LIMITATION =
  'Slides become pictures: text is not selectable or fully accessible to screen readers, links and comments are removed, and fonts, colours and detected titles may differ.';

// Parse only an inert template and read fixed raster sources; never attach the
// saved HTML, execute it, or fetch any of its URLs during preview restoration.
export function restoreConvertedDeck(contents: string, filename: string): PdfDeck | null {
  const template = document.createElement('template');
  template.innerHTML = contents;
  const sections = [...template.content.querySelectorAll('main > section.slide')];
  if (sections.length < 2 || sections.length > 60) return null;
  const slides: DeckSlide[] = [];
  for (const [i, section] of sections.entries()) {
    const heading = section.querySelector('h2');
    const img = section.querySelector('img');
    const source = img?.getAttribute('src') ?? '';
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (
      !match ||
      heading?.id !== `slide-${i + 1}` ||
      img?.width !== 1600 ||
      img.height < 1 ||
      img.height > 1280
    )
      return null;
    const binary = atob(match[2]!);
    slides.push({
      title: heading.textContent ?? `Slide ${i + 1}: Untitled`,
      width: img.width,
      height: img.height,
      image: new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: match[1]! }),
    });
  }
  const html = new Blob([contents], { type: 'text/html;charset=utf-8' });
  return { html, filename, bytes: html.size, slides };
}

export function ConvertPanel({
  action,
  resumeToken = null,
  signedIn = false,
}: {
  action: HandoffAction;
  resumeToken?: string | null;
  signedIn?: boolean;
}) {
  const handoff = useStagedHandoff({ path: '/convert', action, resumeToken, signedIn });
  const [state, setState] = useState<State>('empty');
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState('Checking your PDF…');
  const [deck, setDeck] = useState<PdfDeck | null>(null);
  const [firstSlide, setFirstSlide] = useState<DeckSlide | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [iosSafari, setIosSafari] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focus = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const restoring = useRef(false);
  const selected = useRef(false);
  const dragDepth = useRef(0);
  const beforeDrag = useRef<State>('empty');
  const slide = deck?.slides[page] ?? firstSlide;

  useEffect(() => {
    setIosSafari(
      (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
        /Safari/.test(navigator.userAgent) &&
        !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android/.test(navigator.userAgent),
    );
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!slide) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(slide.image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [slide]);
  useEffect(() => {
    if (!deck) {
      setDownloadUrl(null);
      return;
    }
    const url = URL.createObjectURL(deck.html);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [deck]);
  useEffect(() => {
    if (state === 'done' || state === 'rejected' || state === 'error') focus.current?.focus();
  }, [state]);
  useEffect(() => {
    if (!handoff.restored || !handoff.file || restoring.current || selected.current) return;
    restoring.current = true;
    try {
      const result = restoreConvertedDeck(handoff.file.contents, handoff.file.name);
      if (!result) {
        setMessage(HANDOFF_MESSAGES.missing);
        return;
      }
      setDeck(result);
      setTotal(result.slides.length);
      setState('done');
    } catch {
      setMessage(HANDOFF_MESSAGES.missing);
    }
  }, [handoff.file, handoff.restored]);

  function reset(message: string | null = null) {
    selected.current = true;
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setDeck(null);
    setFirstSlide(null);
    setPage(0);
    setTotal(0);
    setMessage(message);
    setState('empty');
    void handoff.replaceFile(null);
  }

  async function accept(files: File[]) {
    if (handoff.busy) return;
    reset();
    if (!files.length) return;
    if (files.length !== 1) {
      setState('rejected');
      setMessage('Choose one PDF at a time.');
      void captureClientEvent('converter.rejected', { reason: 'multiple' });
      return;
    }
    const attempt = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setState('converting');
    setProgress('Checking your PDF…');
    void captureClientEvent('converter.started');
    try {
      const result = await convertPdfToDeck(files[0]!, {
        signal: abort.signal,
        onProgress: ({ phase, page, total }) => {
          if (attempt !== generation.current) return;
          setTotal(total);
          if (phase !== 'complete')
            setProgress(
              phase === 'checking' ? 'Checking your PDF…' : `Converting slide ${page} of ${total}…`,
            );
        },
        onPreview: (slide) => {
          if (attempt === generation.current) setFirstSlide(slide);
        },
      });
      if (attempt !== generation.current) return;
      setDeck(result);
      setFirstSlide(null);
      setPage(0);
      setTotal(result.slides.length);
      setState('done');
      void captureClientEvent('converter.completed');
      try {
        await handoff.replaceFile(new File([result.html], result.filename, { type: 'text/html' }));
      } catch {
        if (attempt === generation.current) setMessage(HANDOFF_MESSAGES.storage);
      }
    } catch (error) {
      if (attempt !== generation.current) return;
      const code = error instanceof PdfDeckError ? error.code : 'damaged';
      setDeck(null);
      setFirstSlide(null);
      if (code === 'cancelled') {
        setState('empty');
        setMessage(PDF_DECK_MESSAGES.cancelled);
      } else {
        setState(['damaged', 'timeout', 'overflow'].includes(code) ? 'error' : 'rejected');
        setMessage(PDF_DECK_MESSAGES[code]);
      }
      void captureClientEvent('converter.rejected', { reason: code });
    }
  }

  const showPicker = state === 'empty' || state === 'dragging';
  return (
    <div className="mt-7">
      <p className="text-[14px] leading-relaxed text-ink-soft">{LIMITATION}</p>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
        Your PDF stays in this browser; only the converted HTML uploads when you choose ‘Get a
        tracked link’ and are signed in.
      </p>
      <div
        className="mt-6 rounded-2xl border border-line bg-paper p-4 shadow-[0_18px_40px_-30px_rgba(31,17,8,0.18)] sm:p-6 md:p-8"
        onDragEnter={(event) => {
          event.preventDefault();
          if (handoff.busy || state === 'converting') return;
          if (dragDepth.current++ === 0) {
            beforeDrag.current = state;
            setState('dragging');
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          if (dragDepth.current > 0 && --dragDepth.current === 0) setState(beforeDrag.current);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          if (state !== 'converting') void accept([...event.dataTransfer.files]);
        }}
      >
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          aria-label="Choose a PDF deck"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void accept([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        {showPicker && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={handoff.busy}
              className={cn(
                'flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-paper-2/40 px-4 py-8 text-center transition hover:border-signal hover:bg-paper-2/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal',
                state === 'dragging' ? 'border-signal' : 'border-line',
              )}
            >
              <FileText aria-hidden className="size-6 text-signal-dark" />
              <span className="text-[16px] font-medium text-ink">
                {state === 'dragging' ? 'Drop one PDF deck here.' : 'Choose a PDF deck'}
              </span>
              <span className="text-[13px] text-ink-soft">
                Or drop one here. Landscape slides, 2–60 pages, up to 30 MB.
              </span>
            </button>
            {iosSafari && (
              <p className="mt-4 text-[12px] leading-relaxed text-ink-soft">
                If Safari closed the page, try a smaller deck or use a computer.
              </p>
            )}
          </>
        )}
        <div
          ref={focus}
          tabIndex={-1}
          className="outline-none"
          role={state === 'rejected' || state === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          aria-atomic="true"
        >
          {state === 'converting' ? (
            <div>
              <p className="text-[18px] font-medium text-ink">{progress}</p>
              <p className="mt-2 text-[13px] text-ink-soft">Keep this tab open.</p>
            </div>
          ) : state === 'done' && deck ? (
            <div>
              <h2 className="font-serif text-[28px] text-ink">Your HTML file is ready.</h2>
              <p className="mt-2 text-[14px] tabular-nums text-ink-soft">
                {deck.slides.length} slides · {(deck.bytes / 1024 / 1024).toFixed(1)} MB.
              </p>
            </div>
          ) : null}
          {message && (
            <p className="mt-3 text-[14px] leading-relaxed text-signal-dark">{message}</p>
          )}
        </div>
        {previewUrl && slide && (state === 'converting' || state === 'done') && (
          <figure className="mt-6">
            <img
              src={previewUrl}
              width={slide.width}
              height={slide.height}
              alt={`Image of slide ${page + 1}; text is not selectable.`}
              className="h-auto w-full rounded-lg border border-line bg-white"
            />
            <figcaption className="mt-3">
              <p dir="auto" className="break-words text-[13px] text-ink-soft">
                {slide.title}
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-ink-soft">
                <span>
                  Slide {page + 1} of {total}
                </span>
                {state === 'done' && deck && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={cn(BUTTON, 'px-2 hover:bg-paper-2')}
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft aria-hidden className="size-4" />
                      Previous
                    </button>
                    <button
                      type="button"
                      className={cn(BUTTON, 'px-2 hover:bg-paper-2')}
                      disabled={page === deck.slides.length - 1}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                      <ChevronRight aria-hidden className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </figcaption>
          </figure>
        )}
        {state === 'converting' && (
          <button
            type="button"
            className={cn(BUTTON, 'mt-4 border border-line text-signal-dark hover:bg-paper-2')}
            onClick={() => {
              reset(PDF_DECK_MESSAGES.cancelled);
              void captureClientEvent('converter.rejected', { reason: 'cancelled' });
            }}
          >
            Cancel
          </button>
        )}
        {state === 'done' && deck && (
          <>
            <SampleReport titles={deck.slides.map((slide) => slide.title)} />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div>
                <a
                  download={deck.filename}
                  href={downloadUrl ?? undefined}
                  aria-disabled={!downloadUrl}
                  className={cn(
                    BUTTON,
                    'w-full border border-signal text-signal-dark hover:bg-paper-2',
                  )}
                  onClick={() => {
                    void captureClientEvent('converter.download_clicked');
                  }}
                >
                  <ArrowDownToLine aria-hidden className="size-4" />
                  Download HTML
                </a>
                {iosSafari && (
                  <p className="mt-2 text-[12px] text-ink-soft">Use Share, then Save to Files.</p>
                )}
              </div>
              <div>
                <button
                  type="button"
                  disabled={handoff.busy || !handoff.file}
                  onClick={() => {
                    void captureClientEvent('converter.tracked_link_clicked');
                    void handoff.start();
                  }}
                  className={cn(BUTTON, 'w-full bg-signal text-paper hover:bg-signal-dark')}
                >
                  Get a tracked link
                  <ArrowRight aria-hidden className="size-4" />
                </button>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                  Sign-in is required. Next, you’ll choose how to share it.
                </p>
              </div>
            </div>
          </>
        )}
        {handoff.busy && (
          <p role="status" className="mt-3 text-[13px] text-ink-soft">
            Uploading your HTML…
          </p>
        )}
        {handoff.message && (
          <p role="alert" className="mt-3 text-[13px] leading-relaxed text-alert">
            {handoff.message}
          </p>
        )}
        {(state === 'done' || state === 'rejected' || state === 'error') && (
          <button
            type="button"
            disabled={handoff.busy}
            className={cn(BUTTON, 'mt-4 px-0 text-signal-dark underline underline-offset-4')}
            onClick={() => {
              reset();
              input.current?.click();
            }}
          >
            Choose another PDF
          </button>
        )}
      </div>
      <p className="mt-4 text-[12px] text-ink-soft">
        Only convert and share decks you have permission to use.
      </p>
    </div>
  );
}
