import type { Document } from './supabase.js';
import type { Env } from './env.js';

const URL_CACHE_TTL_SECONDS = 600;
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const HEADER_TIMEOUT_MS = 5_000;
const BODY_TIMEOUT_MS = 15_000;

export async function fetchDocumentHtml(doc: Document, env: Env): Promise<Response | null> {
  if (doc.source_type === 'upload') {
    if (!doc.r2_key) return null;
    const object = await env.DOCS_BUCKET.get(doc.r2_key);
    if (!object) return null;
    return new Response(object.body, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!doc.source_url) return null;
  return fetchExternal(doc.source_url);
}

async function fetchExternal(initialUrl: string): Promise<Response | null> {
  // Follow redirects manually, re-run the full host policy on every hop, cap
  // the body by counting real bytes, and put a deadline on both headers and
  // body. Cloudflare Workers also block RFC-1918 egress, but a platform
  // behaviour is not a control we can verify, so we enforce it ourselves.
  let url = initialUrl;
  let sawHttps = false;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(url)) return null;
    const target = new URL(url);
    // A redirect may never downgrade an encrypted hop to plain HTTP.
    if (target.protocol === 'https:') sawHttps = true;
    else if (sawHttps) return null;
    if (!(await resolvesToPublicAddresses(target.hostname))) return null;

    const controller = new AbortController();
    const reject = (): null => {
      controller.abort(); // cancels the body of any response we are discarding
      return null;
    };

    const headerTimer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
    const upstream = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      cf: { cacheTtl: URL_CACHE_TTL_SECONDS, cacheEverything: true },
      headers: { 'User-Agent': 'HTMLRadar-Proxy/1.0' },
    } as RequestInit).catch(() => null);
    clearTimeout(headerTimer);
    if (!upstream) return null;

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('Location');
      reject();
      if (!location) return null;
      try {
        url = new URL(location, url).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!upstream.ok) return reject();

    const contentType = upstream.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().includes('html')) return reject();

    const declared = Number.parseInt(upstream.headers.get('Content-Length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reject();

    const bodyTimer = setTimeout(() => controller.abort(), BODY_TIMEOUT_MS);
    const bytes = await readCapped(upstream.body);
    clearTimeout(bodyTimer);
    if (!bytes) return reject();

    return new Response(bytes, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return null;
}

/** Reads at most MAX_BODY_BYTES of actual delivered bytes; null if it overruns. */
async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Content-Length lies, is absent on chunked responses, and describes the
      // compressed size. Only the bytes we actually received count.
      if (total > MAX_BODY_BYTES) {
        void reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null; // aborted by the body deadline, or a mid-stream network error
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

type DnsResponse = { Status?: number; Answer?: Array<{ type: number; data: string }> };

/**
 * Resolves a hostname over Cloudflare DNS-over-HTTPS and requires every
 * returned address to be globally routable.
 *
 * Residual risk: a Worker cannot pin the socket to the address it just
 * checked, so a hostname whose answer changes between this check and the
 * fetch (DNS rebinding) still gets through. Mitigated by running the check
 * immediately before the fetch and by the 10-minute edge cache being keyed on
 * the URL rather than re-resolved per view.
 */
async function resolvesToPublicAddresses(hostname: string): Promise<boolean> {
  // An IP literal never reaches DNS, so this is where it gets the same verdict
  // a resolved answer would get. isPublicHttpUrl checked it too; running it
  // again costs nothing and means neither check is load-bearing on its own.
  const literalV4 = parseIpv4(hostname);
  if (literalV4) return !isBlockedIpv4(literalV4);
  const literalV6 = parseIpv6(unbracket(hostname));
  if (literalV6) return isPublicIpv6(literalV6);

  const lookups = await Promise.all(
    (['A', 'AAAA'] as const).map(async (type) => {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(HEADER_TIMEOUT_MS),
        },
      );
      if (!res.ok) return null;
      return (await res.json()) as DnsResponse;
    }),
  ).catch(() => null);
  if (!lookups) return false; // resolution failed: fail closed

  let addresses = 0;
  for (const lookup of lookups) {
    if (!lookup) return false;
    if (lookup.Status !== 0) continue; // no records of this family
    for (const answer of lookup.Answer ?? []) {
      if (answer.type !== 1 && answer.type !== 28) continue; // skip CNAME links
      addresses++;
      if (isBlockedAddress(answer.data)) return false;
    }
  }
  return addresses > 0;
}

const BLOCKED_HOST_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'internal']);
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal', // includes metadata.google.internal and friends
  '.home.arpa',
  '.cfargotunnel.com', // Cloudflare Tunnel names reach an account's private network
];

// Everything that is not globally routable IPv4, per IANA special-purpose registry.
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network", including 0.0.0.0 itself
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including 255.255.255.255
];

const BLOCKED_IPV4_RANGES: Array<[number, number]> = BLOCKED_IPV4_CIDRS.map(([base, bits]) => [
  toU32(parseIpv4(base) as Ipv4),
  bits,
]);

// IPv6 is an allowlist, not a blocklist. 2000::/3 is the only space IANA has
// delegated as global unicast, so everything else is refused without having to
// enumerate it — including every IPv4-embedded form that has a prefix of its
// own (`::ffff:a.b.c.d`, `::a.b.c.d`, `64:ff9b::a.b.c.d`), all of which start
// outside 2000::/3. A Worker fetching a customer's deck has no reason to reach
// one of those, and a blocklist that has to name each of them is a blocklist
// with a hole in it. The one form that borrows somebody else's prefix instead
// is what isIsatap below is for.
const IPV6_GLOBAL_UNICAST: [string, number] = ['2000::', 3];

// Special-purpose prefixes from the IANA IPv6 special-purpose address registry.
// Several of these already sit outside 2000::/3; they are written down anyway
// so this table reads as the registry does rather than as a puzzle.
const NON_GLOBAL_IPV6_CIDRS: Array<[string, number]> = [
  ['100::', 64], // discard-only
  ['64:ff9b::', 96], // NAT64 well-known prefix
  ['64:ff9b:1::', 48], // NAT64 local-use prefix
  ['2001::', 23], // IETF protocol assignments: Teredo 2001::/32, benchmarking 2001:2::/48
  ['2001:db8::', 32], // documentation. Its own row: 2001::/23 stops at 2001:01ff::
  ['2002::', 16], // 6to4 — the embedded IPv4 address decides where it lands
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 segment identifiers
];

const toIpv6Range = ([base, bits]: [string, number]): [Ipv6, number] => [
  parseIpv6(base) as Ipv6,
  bits,
];
const IPV6_GLOBAL_UNICAST_RANGE = toIpv6Range(IPV6_GLOBAL_UNICAST);
const NON_GLOBAL_IPV6_RANGES = NON_GLOBAL_IPV6_CIDRS.map(toIpv6Range);

export function isPublicHttpUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false; // no embedded credentials

  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOST_NAMES.has(host)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  if (host.startsWith('[')) {
    const v6 = parseIpv6(unbracket(host));
    return v6 ? isPublicIpv6(v6) : false;
  }
  const v4 = parseIpv4(host);
  if (v4) return !isBlockedIpv4(v4);
  return true; // a name: resolvesToPublicAddresses has the final say
}

function isBlockedAddress(text: string): boolean {
  const v4 = parseIpv4(text);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(text.trim().toLowerCase());
  if (v6) return !isPublicIpv6(v6);
  return true; // unparseable answer: fail closed
}

function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

type Ipv4 = [number, number, number, number];
type Ipv6 = [number, number, number, number, number, number, number, number];

function toU32(octets: Ipv4): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function parseIpv4(text: string): Ipv4 | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets as Ipv4;
}

/** Expands any IPv6 text form (including ::ffff:1.2.3.4) to eight hextets. */
function parseIpv6(text: string): Ipv6 | null {
  if (!/^[0-9a-f:.]+$/.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;

  const groupsOf = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const bits = part.split(':');
    for (const [i, bit] of bits.entries()) {
      if (bit.includes('.')) {
        if (i !== bits.length - 1) return null;
        const v4 = parseIpv4(bit);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(bit)) return null;
      out.push(Number.parseInt(bit, 16));
    }
    return out;
  };

  const head = groupsOf(halves[0] ?? '');
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? (head as Ipv6) : null;
  const gap = 8 - head.length - tail.length;
  if (gap < 1) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail] as Ipv6;
}

function isBlockedIpv4(octets: Ipv4): boolean {
  const addr = toU32(octets);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => (addr ^ base) >>> (32 - bits) === 0);
}

/** Whether `addr` falls inside the CIDR block `base/bits`. */
function inIpv6Range(addr: Ipv6, [base, bits]: [Ipv6, number]): boolean {
  return base.every((hextet, i) => {
    const width = Math.min(16, Math.max(0, bits - i * 16));
    const mask = width === 0 ? 0 : (0xffff << (16 - width)) & 0xffff;
    return (((addr[i] ?? 0) ^ hextet) & mask) === 0;
  });
}

/**
 * ISATAP interface identifier: ::0:5efe:a.b.c.d, or ::200:5efe:a.b.c.d when
 * the address is globally unique. It rides inside an ordinary global prefix,
 * so the 2000::/3 allowlist has nothing to object to, while the embedded IPv4
 * address decides where the packet lands: `2606:4700::5efe:169.254.169.254`
 * names a link-local destination. Refused whatever it carries, for the same
 * reason 2002::/16 is.
 *
 * RFC 6052 NAT64 is deliberately not checked here. The well-known prefixes
 * 64:ff9b::/96 and 64:ff9b:1::/48 fall outside 2000::/3 and are rejected by
 * the allowlist. A network-specific NAT64 prefix is an accepted residual: it
 * can place the embedded address at several offsets and nothing in the bits
 * marks it as a translation prefix, and these fetches run on Cloudflare
 * Workers, which has no private network of ours behind any such prefix, so
 * the reachable set through one is public hosts only.
 */
function isIsatap(groups: Ipv6): boolean {
  if ((groups[4] === 0x0000 || groups[4] === 0x0200) && groups[5] === 0x5efe) return true;
  return false;
}

/** Global unicast, and none of the special-purpose blocks carved out of it. */
function isPublicIpv6(groups: Ipv6): boolean {
  if (isIsatap(groups)) return false;
  if (!inIpv6Range(groups, IPV6_GLOBAL_UNICAST_RANGE)) return false;
  return !NON_GLOBAL_IPV6_RANGES.some((range) => inIpv6Range(groups, range));
}
