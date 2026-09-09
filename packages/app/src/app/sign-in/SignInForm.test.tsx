// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { stageFile } from '@/lib/staged-file';
import { SignInForm } from './SignInForm';
vi.mock('@/components/HeroRadar', () => ({ HeroRadar: () => null }));
vi.mock('@/lib/supabase-browser', () => ({ browserClient: vi.fn() }));
vi.mock('@/lib/events-client', () => ({ captureClientEvent: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
});
it('names a converted file only for the matching route and unconsumed resume token', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  await stageFile({
    name: 'private-deck.html',
    contents: '<h2>Deck</h2>',
    type: 'text/html',
    stagedAt: Date.now(),
    token: 'right-token',
    path: '/convert',
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (next: string) => {
    await act(async () => {
      root.render(<SignInForm errorCode={null} next={next} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  try {
    await render('/convert?resume=right-token');
    expect(host.textContent).toContain('private-deck.html');
    await render('/convert?resume=wrong-token');
    expect(host.textContent).not.toContain('private-deck.html');
    await render('/tools/html-to-link?resume=right-token');
    expect(host.textContent).not.toContain('private-deck.html');
    await stageFile({
      name: 'private-deck.html',
      contents: '<h2>Deck</h2>',
      type: 'text/html',
      stagedAt: Date.now(),
      token: 'consumed',
      path: '/convert',
      reserved: true,
    });
    await render('/convert?resume=consumed');
    expect(host.textContent).not.toContain('private-deck.html');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
