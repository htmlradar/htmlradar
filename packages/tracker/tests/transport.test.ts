import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createTransport, RpcError } from '../src/transport.js';

const ORIGIN = 'https://example.supabase.co';

function mockFetch(response: { status?: number; ok?: boolean; body?: unknown; text?: string }) {
  const status = response.status ?? 200;
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Bad Request',
    text: () => Promise.resolve(response.text ?? JSON.stringify(response.body ?? {})),
    json: () => Promise.resolve(response.body ?? {}),
  });
}

describe('transport', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('start_session POSTs to the right URL with auth headers', async () => {
    const f = mockFetch({
      body: {
        session_id: 's1',
        token: 't1',
        document_id: 'd1',
        document_version: 1,
      },
    });
    globalThis.fetch = f as unknown as typeof fetch;

    const t = createTransport({ supabaseUrl: ORIGIN, anonKey: 'anon' });
    const result = await t.startSession({
      shareSlug: 'swift-falcon-a3f2',
      email: 'marc@x.com',
      fingerprint: null,
      referrer: '',
      userAgent: 'jsdom',
    });

    expect(result).toEqual({
      sessionId: 's1',
      token: 't1',
      documentId: 'd1',
      documentVersion: 1,
    });
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/rest/v1/rpc/start_session`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe('anon');
    expect(headers.Authorization).toBe('Bearer anon');
  });

  it('update_session honors keepalive', async () => {
    const f = mockFetch({ status: 204 });
    globalThis.fetch = f as unknown as typeof fetch;

    const t = createTransport({ supabaseUrl: ORIGIN, anonKey: 'anon' });
    await t.updateSession(
      {
        sessionId: 's1',
        token: 't1',
        activeSeconds: 30,
        maxScrollDepth: 0.5,
        sections: [],
      },
      true,
    );

    const [, init] = f.mock.calls[0]!;
    expect((init as RequestInit).keepalive).toBe(true);
  });

  it('extracts errcode from PostgREST error body', async () => {
    const f = mockFetch({
      status: 400,
      ok: false,
      text: JSON.stringify({ code: 'P0001', message: 'rate_limited' }),
    });
    globalThis.fetch = f as unknown as typeof fetch;

    const t = createTransport({ supabaseUrl: ORIGIN, anonKey: 'anon' });
    try {
      await t.startSession({
        shareSlug: 'x',
        email: 'a@b.co',
        fingerprint: null,
        referrer: '',
        userAgent: '',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe('P0001');
      expect((err as RpcError).httpStatus).toBe(400);
    }
  });
});
