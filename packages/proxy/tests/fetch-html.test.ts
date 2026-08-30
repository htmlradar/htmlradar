import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDocumentHtml, isPublicHttpUrl } from '../src/fetch-html.js';
import type { Document } from '../src/supabase.js';
import type { Env } from '../src/env.js';

describe('isPublicHttpUrl public-host guard', () => {
  it('accepts ordinary public HTTPS URLs', () => {
    expect(isPublicHttpUrl('https://example.com')).toBe(true);
    expect(isPublicHttpUrl('https://docs.example.com/path')).toBe(true);
    expect(isPublicHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects loopback', () => {
    expect(isPublicHttpUrl('http://localhost')).toBe(false);
    expect(isPublicHttpUrl('http://localhost:8787')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://127.9.9.9')).toBe(false);
    expect(isPublicHttpUrl('http://machine.local')).toBe(false);
    expect(isPublicHttpUrl('http://app.localhost')).toBe(false);
    expect(isPublicHttpUrl('http://metadata.google.internal')).toBe(false);
    expect(isPublicHttpUrl('http://printer.home.arpa')).toBe(false);
    expect(isPublicHttpUrl('https://abcd.cfargotunnel.com')).toBe(false);
  });

  it('rejects RFC-1918 private ranges', () => {
    expect(isPublicHttpUrl('http://10.0.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1')).toBe(false);
    expect(isPublicHttpUrl('http://172.31.255.255')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254')).toBe(false); // AWS IMDS
  });

  it('rejects the other non-routable IPv4 ranges', () => {
    expect(isPublicHttpUrl('http://0.0.0.0')).toBe(false);
    expect(isPublicHttpUrl('http://0.1.2.3')).toBe(false);
    expect(isPublicHttpUrl('http://100.64.0.1')).toBe(false); // carrier-grade NAT
    expect(isPublicHttpUrl('http://192.0.0.8')).toBe(false); // protocol assignments
    expect(isPublicHttpUrl('http://198.18.0.1')).toBe(false); // benchmarking
    expect(isPublicHttpUrl('http://224.0.0.1')).toBe(false); // multicast
    expect(isPublicHttpUrl('http://240.0.0.1')).toBe(false); // reserved
    expect(isPublicHttpUrl('http://255.255.255.255')).toBe(false);
  });

  it('rejects obfuscated IPv4 literals the URL parser normalises', () => {
    expect(isPublicHttpUrl('http://2130706433')).toBe(false); // 127.0.0.1
    expect(isPublicHttpUrl('http://0177.0.0.1')).toBe(false); // octal 127.0.0.1
    expect(isPublicHttpUrl('http://0x7f.0.0.1')).toBe(false); // hex 127.0.0.1
  });

  it('rejects non-routable IPv6 literals', () => {
    expect(isPublicHttpUrl('http://[::1]')).toBe(false); // loopback
    expect(isPublicHttpUrl('http://[::]')).toBe(false); // unspecified
    expect(isPublicHttpUrl('http://[fd00::1]')).toBe(false); // unique-local
    expect(isPublicHttpUrl('http://[fc00::1]')).toBe(false); // unique-local
    expect(isPublicHttpUrl('http://[fe80::1]')).toBe(false); // link-local
    expect(isPublicHttpUrl('http://[ff02::1]')).toBe(false); // multicast
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]')).toBe(false); // IPv4-mapped
    expect(isPublicHttpUrl('http://[::ffff:169.254.169.254]')).toBe(false); // mapped IMDS
    expect(isPublicHttpUrl('http://[::ffff:7f00:1]')).toBe(false); // mapped, hex form
  });

  // The mapped forms are refused whatever address they carry. A Worker has no
  // reason to reach an IPv4 destination written as IPv6, and "the embedded
  // address decides" is how ::ffff:169.254.169.254 gets a second chance.
  it('rejects IPv4-mapped and IPv4-compatible forms even when the embedded address is public', () => {
    expect(isPublicHttpUrl('http://[::ffff:8.8.8.8]')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:0808:0808]')).toBe(false);
    expect(isPublicHttpUrl('http://[::8.8.8.8]')).toBe(false);
    expect(isPublicHttpUrl('http://[64:ff9b::8.8.8.8]')).toBe(false);
  });

  it('rejects the IPv6 special-purpose ranges outside global unicast', () => {
    expect(isPublicHttpUrl('http://[100::1]')).toBe(false); // discard-only
    expect(isPublicHttpUrl('http://[64:ff9b::1]')).toBe(false); // NAT64 well-known
    expect(isPublicHttpUrl('http://[64:ff9b:1::1]')).toBe(false); // NAT64 local-use
    expect(isPublicHttpUrl('http://[5f00::1]')).toBe(false); // SRv6 segment ids
    expect(isPublicHttpUrl('http://[0100::abcd]')).toBe(false);
  });

  it('rejects the special-purpose ranges carved out of 2000::/3', () => {
    expect(isPublicHttpUrl('http://[2001::1]')).toBe(false); // Teredo
    expect(isPublicHttpUrl('http://[2001:2::1]')).toBe(false); // benchmarking
    expect(isPublicHttpUrl('http://[2001:db8::1]')).toBe(false); // documentation
    expect(isPublicHttpUrl('http://[2001:1ff:ffff::1]')).toBe(false); // top of 2001::/23
    expect(isPublicHttpUrl('http://[2002:c000:204::1]')).toBe(false); // 6to4
    expect(isPublicHttpUrl('http://[3fff::1]')).toBe(false); // documentation
    expect(isPublicHttpUrl('http://[3fff:fff::1]')).toBe(false); // top of 3fff::/20
  });

  // ISATAP writes an IPv4 destination into the low half of an address whose
  // prefix is an ordinary routable one, so the 2000::/3 allowlist on its own
  // has nothing to object to.
  it('rejects ISATAP addresses inside an allowed global prefix', () => {
    expect(isPublicHttpUrl('http://[2606:4700::5efe:169.254.169.254]')).toBe(false);
    expect(isPublicHttpUrl('http://[2a00:1450:4001:80f:0:5efe:10.0.0.1]')).toBe(false);
    expect(isPublicHttpUrl('http://[2606:4700::5efe:c0a8:1]')).toBe(false); // hex form
    // The globally-unique identifier form, carrying a public address: the
    // shape is refused whatever it names, as 2002::/16 is.
    expect(isPublicHttpUrl('http://[2606:4700::200:5efe:8.8.8.8]')).toBe(false);
  });

  // RFC 6052 NAT64: the well-known prefixes start with hextet 0064, whose top
  // three bits are 000, so the 2000::/3 allowlist refuses them before anything
  // looks at what they embed. Network-specific NAT64 prefixes are an accepted
  // residual; see isIsatap in fetch-html.ts.
  it('rejects the NAT64 well-known prefixes whatever they embed', () => {
    expect(isPublicHttpUrl('http://[64:ff9b::7f00:1]')).toBe(false); // 127.0.0.1
    expect(isPublicHttpUrl('http://[64:ff9b:1::7f00:1]')).toBe(false); // 127.0.0.1
  });

  // The low 32 bits of an ordinary global-unicast address are an interface
  // identifier, not an embedded destination, even when they read as IPv4.
  it('accepts global unicast whose low bits merely read as IPv4', () => {
    expect(isPublicHttpUrl('http://[2606:4700::a00:1]')).toBe(true); // reads as 10.0.0.1
    expect(isPublicHttpUrl('http://[2606:4700::7f00:1]')).toBe(true); // reads as 127.0.0.1
    expect(isPublicHttpUrl('http://[2606:4700:4700::1111]')).toBe(true);
    expect(isPublicHttpUrl('http://[2001:4860:4860::8888]')).toBe(true);
    expect(isPublicHttpUrl('http://[2a00:1450:4001:80f::200e]')).toBe(true);
  });

  it('allows globally routable literals', () => {
    expect(isPublicHttpUrl('http://172.15.0.1')).toBe(true);
    expect(isPublicHttpUrl('http://172.32.0.1')).toBe(true);
    expect(isPublicHttpUrl('http://93.184.216.34')).toBe(true);
    expect(isPublicHttpUrl('http://[2606:4700::1111]')).toBe(true);
    expect(isPublicHttpUrl('http://[2a00:1450:4001:80f::200e]')).toBe(true);
    expect(isPublicHttpUrl('http://[2000::1]')).toBe(true); // bottom of 2000::/3
    expect(isPublicHttpUrl('http://[2003::1]')).toBe(true); // just past 2002::/16
    expect(isPublicHttpUrl('http://[3ffe::1]')).toBe(true); // just below 3fff::/20
  });

  it('rejects non-HTTP schemes', () => {
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpUrl('ftp://example.com')).toBe(false);
  });

  it('rejects embedded credentials', () => {
    expect(isPublicHttpUrl('https://user:pass@example.com')).toBe(false);
    expect(isPublicHttpUrl('https://user@example.com')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isPublicHttpUrl('not a url')).toBe(false);
    expect(isPublicHttpUrl('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchDocumentHtml (URL mode) — DNS policy, redirects, deadlines, size cap.
// ---------------------------------------------------------------------------

const DOH = 'https://cloudflare-dns.com/dns-query';
const env = {} as unknown as Env;

function urlDoc(source_url: string): Document {
  return { source_type: 'url', source_url, r2_key: null } as unknown as Document;
}

function dnsAnswer(url: string, a: string[], aaaa: string[]): Response {
  const type = url.includes('type=AAAA') ? 28 : 1;
  const data = type === 28 ? aaaa : a;
  return new Response(JSON.stringify({ Status: 0, Answer: data.map((d) => ({ type, data: d })) }));
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Stubs global fetch: DoH queries get `a`/`aaaa`, everything else hits `pages`. */
function stubFetch(pages: Handler, a: string[] = ['93.184.216.34'], aaaa: string[] = []) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(DOH)) return Promise.resolve(dnsAnswer(url, a, aaaa));
      return Promise.resolve(pages(url, init));
    }),
  );
  return calls;
}

const htmlPage = (body = '<html>ok</html>'): Response =>
  new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const redirectTo = (location: string): Response =>
  new Response(null, { status: 302, headers: { Location: location } });

const pageFetches = (calls: string[]): string[] => calls.filter((u) => !u.startsWith(DOH));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchDocumentHtml URL mode', () => {
  it('fetches a public page and returns its HTML', async () => {
    stubFetch(() => htmlPage('<html>hello</html>'));
    const res = await fetchDocumentHtml(urlDoc('https://example.com/deck'), env);
    expect(res).not.toBeNull();
    expect(res?.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await res?.text()).toBe('<html>hello</html>');
  });

  it('rejects a hostname whose A record is private, without fetching the page', async () => {
    const calls = stubFetch(() => htmlPage(), ['10.0.0.5']);
    expect(await fetchDocumentHtml(urlDoc('https://rebind.example.com/'), env)).toBeNull();
    expect(pageFetches(calls)).toEqual([]);
  });

  it('rejects a hostname whose AAAA record is unique-local', async () => {
    const calls = stubFetch(() => htmlPage(), ['93.184.216.34'], ['fd00::1']);
    expect(await fetchDocumentHtml(urlDoc('https://mixed.example.com/'), env)).toBeNull();
    expect(pageFetches(calls)).toEqual([]);
  });

  it('rejects a hostname whose AAAA record is special-purpose or an IPv4-mapped public address', async () => {
    for (const aaaa of [
      '2001:db8::1',
      '3fff::1',
      '64:ff9b::8.8.8.8',
      '::ffff:8.8.8.8',
      '2606:4700::5efe:169.254.169.254', // ISATAP under a routable prefix
    ]) {
      const calls = stubFetch(() => htmlPage(), ['93.184.216.34'], [aaaa]);
      expect(await fetchDocumentHtml(urlDoc('https://reserved.example.com/'), env)).toBeNull();
      expect(pageFetches(calls)).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('accepts a hostname whose AAAA record is global unicast', async () => {
    stubFetch(() => htmlPage('<html>v6</html>'), ['93.184.216.34'], ['2606:4700::1111']);
    const res = await fetchDocumentHtml(urlDoc('https://v6.example.com/'), env);
    expect(await res?.text()).toBe('<html>v6</html>');
  });

  it('rejects a hostname that resolves to nothing', async () => {
    const calls = stubFetch(() => htmlPage(), [], []);
    expect(await fetchDocumentHtml(urlDoc('https://nowhere.example.com/'), env)).toBeNull();
    expect(pageFetches(calls)).toEqual([]);
  });

  it('rejects private literals and localhost names before any network call', async () => {
    for (const target of [
      'http://10.0.0.1/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://localhost/',
      'http://metadata.google.internal/',
    ]) {
      const calls = stubFetch(() => htmlPage());
      expect(await fetchDocumentHtml(urlDoc(target), env)).toBeNull();
      expect(calls).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('follows up to three redirects', async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith('/1')) return redirectTo('https://example.com/2');
      if (url.endsWith('/2')) return redirectTo('https://example.com/3');
      if (url.endsWith('/3')) return htmlPage('<html>final</html>');
      return redirectTo('https://example.com/1');
    });
    const res = await fetchDocumentHtml(urlDoc('https://example.com/0'), env);
    expect(await res?.text()).toBe('<html>final</html>');
    expect(pageFetches(calls)).toHaveLength(4);
  });

  it('rejects a fourth redirect', async () => {
    const calls = stubFetch((url) => redirectTo(`${url}x`));
    expect(await fetchDocumentHtml(urlDoc('https://example.com/'), env)).toBeNull();
    expect(pageFetches(calls)).toHaveLength(4);
  });

  it('rejects an https to http redirect downgrade', async () => {
    const calls = stubFetch((url) =>
      url.startsWith('https:') ? redirectTo('http://example.com/plain') : htmlPage(),
    );
    expect(await fetchDocumentHtml(urlDoc('https://example.com/'), env)).toBeNull();
    expect(pageFetches(calls)).toHaveLength(1);
  });

  it('rejects a redirect into a private address', async () => {
    const calls = stubFetch((url) =>
      url.endsWith('/start') ? redirectTo('http://169.254.169.254/latest/meta-data/') : htmlPage(),
    );
    expect(await fetchDocumentHtml(urlDoc('http://example.com/start'), env)).toBeNull();
    expect(pageFetches(calls)).toHaveLength(1);
  });

  it('rejects a non-HTML content type', async () => {
    stubFetch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    expect(await fetchDocumentHtml(urlDoc('https://example.com/'), env)).toBeNull();
  });

  it('rejects a body over 30 MB that declares no Content-Length', async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 16) {
          controller.close();
          return;
        }
        sent++;
        controller.enqueue(chunk);
      },
    });
    stubFetch(() => new Response(stream, { headers: { 'Content-Type': 'text/html' } }));
    expect(await fetchDocumentHtml(urlDoc('https://example.com/'), env)).toBeNull();
  });

  it('rejects a body whose declared Content-Length is over 30 MB', async () => {
    stubFetch(
      () =>
        new Response('<html>small</html>', {
          headers: { 'Content-Type': 'text/html', 'Content-Length': String(31 * 1024 * 1024) },
        }),
    );
    expect(await fetchDocumentHtml(urlDoc('https://example.com/'), env)).toBeNull();
  });

  it('gives up when response headers miss the deadline', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, rejectPromise) => {
          init.signal?.addEventListener('abort', () => rejectPromise(new Error('aborted')));
        }),
    );
    const pending = fetchDocumentHtml(urlDoc('https://slow.example.com/'), env);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await pending).toBeNull();
  });

  it('gives up when the body misses the deadline', async () => {
    vi.useFakeTimers();
    // A body that starts and then stalls. Real fetch errors the body stream
    // when the request signal aborts, so the mock does the same.
    stubFetch((_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<html>'));
          init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/html' } });
    });
    const pending = fetchDocumentHtml(urlDoc('https://slow.example.com/'), env);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await pending).toBeNull();
  });
});
