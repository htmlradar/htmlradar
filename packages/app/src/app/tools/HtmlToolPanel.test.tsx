// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { File as NodeFile } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HtmlToolPanel } from './HtmlToolPanel';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/events-client', () => ({ captureClientEvent: vi.fn(async () => {}) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('indexedDB', new IDBFactory());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(['html-to-link', 'claude-artifact-to-link'])(
  'preserves the original missing-file and storage wording on %s',
  async (tool) => {
    const action = vi.fn(async () => ({ ok: true as const, documentId: 'unused' }));
    await act(async () => {
      root.render(<HtmlToolPanel tool={tool} action={action} resumeToken="missing" />);
    });
    for (let attempt = 0; attempt < 100 && !host.querySelector('a[href="/docs"]'); attempt++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(host.querySelector('a[href="/docs"]')).not.toBeNull();
    expect(host.textContent).toContain(
      'That file was already turned into a link — find it under Documents.',
    );
    const input = host.querySelector('input')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['<h1>Title</h1>'], 'deck.html', { type: 'text/html' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('Storage blocked');
      },
    });
    await act(async () => {
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Get your tracked link'))!
        .click();
    });
    expect(host.textContent).toContain(
      'This browser will not let the page hold your file while you sign in. Sign in first, then upload the file on the new document page.',
    );
    expect(host.querySelector('a[href="/new"]')?.textContent).toBe('new document page');
    expect(host.textContent).not.toMatch(/choose the PDF again|download the HTML/i);
    expect(action).not.toHaveBeenCalled();
  },
);
