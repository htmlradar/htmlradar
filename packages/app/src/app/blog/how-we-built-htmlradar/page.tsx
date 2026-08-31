// Blog post #1 — technical credibility piece for the OSS audience.
// Visual-led, code-anchored, honest about what's not done. ~950 words,
// 3 inline diagrams. Lands on day 0 of soft launch.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'How I Built HTMLRadar',
  description:
    'How HTMLRadar is built: a Next.js app, two Cloudflare Workers, an 8 KB browser tracker, and a Supabase schema. What each part owns and why.',
  path: '/blog/how-we-built-htmlradar',
});

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <ArticleLd
            headline="How I built HTMLRadar"
            datePublished="2026-05-14"
            url="/blog/how-we-built-htmlradar"
          />
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              {
                name: 'How I built HTMLRadar',
                url: '/blog/how-we-built-htmlradar',
              },
            ]}
          />
          <SectionMark>HTMLRadar · Engineering</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[52px]">
            How I built HTMLRadar.
          </h1>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            2026-05-14 &nbsp;·&nbsp; 5 min read &nbsp;·&nbsp; Engineering
          </p>

          <div className="mt-10">
            <ArchitectureDiagram />
          </div>

          <div className="mt-12 space-y-10 text-[16.5px] leading-[1.7] text-ink-soft">
            <p>
              I built HTMLRadar because I wanted to send investor updates as HTML, branded the way
              the rest of my company's site is branded, not flattened into a PDF. Existing
              document-tracking tools were built around PDF-first workflows. So I built a tracker
              for HTML decks for myself, then realised other founders had the same problem and
              open-sourced it.
            </p>

            <p>
              The pattern is broader than one founder's preference. Teams can now produce specs,
              design mocks, reports, dashboards, and internal briefs as HTML through hand-coded
              workflows and tools such as ChatGPT, Claude, v0, Lovable, and Claude Artifacts. HTML
              keeps responsive layouts, links, and interactive elements intact. The sending and
              analytics workflow is still largely designed around static documents. That's the gap
              HTMLRadar tries to fill.
            </p>

            <p>
              HTMLRadar is open-source DocSend for HTML. You upload an HTML deck (or paste a URL),
              share a tracked link, and see recipient sessions, section-level dwell, and exits in
              the sender dashboard. The dashboard refreshes every 30 seconds while its tab is
              visible. The repo is AGPL-3.0 at{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                github.com/htmlradar/htmlradar
              </a>
              .
            </p>

            <p>
              The code splits into four packages. Each runs in a different place. Each is small and
              does one thing.
            </p>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The shape
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  <code className="font-mono text-[14px] text-signal-dark">packages/app</code> is a
                  Next.js 14 app on Cloudflare Pages. Dashboard, sign-in, upload, share creation —
                  everything the sender does. The recipient never touches it.
                </p>
                <p>
                  <code className="font-mono text-[14px] text-signal-dark">packages/proxy</code> is
                  a Cloudflare Worker that owns the share URL. When someone opens{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    htmlradar.page/r/swift-falcon-a3f2
                  </code>
                  , the request hits this worker. It runs the email gate, fetches the HTML from R2
                  or an external URL, injects the tracker, streams the page back.
                </p>
                <p>
                  <code className="font-mono text-[14px] text-signal-dark">packages/tracker</code>{' '}
                  is a 22 KB minified (8 KB gzipped) browser IIFE. The proxy injects a single{' '}
                  <code className="font-mono text-[14px] text-signal-dark">&lt;script&gt;</code> tag
                  into every served document. The tracker creates the browser identifier, reads any
                  email the proxy has already verified, and streams session metrics to Supabase
                  after the warm-up.
                </p>
                <p>
                  <code className="font-mono text-[14px] text-signal-dark">packages/monitor</code>{' '}
                  is a Cloudflare cron Worker. It checks the hosted service every five minutes and
                  replays first-party product events from Supabase to PostHog server-side.
                </p>
                <p>
                  Splitting the proxy out keeps the recipient's bundle clean. The Worker has no
                  React, no Supabase SDK, no Next runtime. It serves gated HTML with a tracker
                  stitched in.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The tracker is 22 KB minified
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  22 KB minified — 8 KB over the wire gzipped — is a tight budget. The tracker uses
                  PostgREST directly rather than{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    @supabase/supabase-js
                  </code>
                  . The SDK is around 75 KB minified and brings a JWT lib, a fetch polyfill, and a
                  realtime websocket client the tracker doesn't need.
                </p>
                <CodeBlock
                  file="packages/tracker/src/transport.ts"
                  code={`const res = await fetch(\`\${supabaseUrl}/rest/v1/rpc/start_session\`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_share_slug, p_email, p_fingerprint }),
});`}
                />
                <p>
                  The dwell tracker samples the visible viewport. It first uses configured
                  selectors, then falls back to headings, slide or page containers, and finally
                  plain-prose anchors. Each sample divides active time among the sections that cover
                  enough of the viewport. A section begins qualifying only after at least half of it
                  stays visible for one continuous second, and the public read signal uses a
                  three-second dwell floor.
                </p>
                <p>
                  Flush runs every 15 seconds and on{' '}
                  <code className="font-mono text-[14px] text-signal-dark">pagehide</code>. The
                  page-hide path requests one final best-effort update with{' '}
                  <code className="font-mono text-[14px] text-signal-dark">keepalive: true</code>. A
                  single-flight guard prevents concurrent updates from racing.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The proxy is where the security lives
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  Shares can require an email, a password, or both. The proxy enforces these before
                  serving any HTML. The reader passes a gate, the proxy issues a cookie, subsequent
                  requests skip the gate.
                </p>
                <p>
                  Gate sessions never touch the database. The cookie itself is the proof: an
                  HMAC-SHA256 of{' '}
                  <code className="font-mono text-[14px] text-signal-dark">slug + email + exp</code>{' '}
                  signed with one server-side secret.
                </p>
                <CodeBlock
                  file="packages/proxy/src/auth.ts"
                  code={`const payload = \`\${slug}.\${b64email}.\${exp}\`;
const mac = await hmacSha256(env.SESSION_SECRET, payload);
const cookie = \`\${payload}.\${mac}\`;`}
                />
                <p>
                  No database round-trip per request. No session state to invalidate on revoke; the
                  share's <code className="font-mono text-[14px] text-signal-dark">revoked_at</code>{' '}
                  column is the source of truth and the worker reads it on every request.
                  Constant-time compare on verification. Unit tests cover round-trip and
                  tamper-rejection.
                </p>
                <p>This module is the one to read first if you're auditing security.</p>
              </div>
            </section>

            <RecipientFlowDiagram />

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Database is the contract
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  Supabase Postgres is the only store. Two RPCs cover the entire writer surface for
                  recipients:{' '}
                  <code className="font-mono text-[14px] text-signal-dark">start_session</code> and{' '}
                  <code className="font-mono text-[14px] text-signal-dark">update_session</code>.
                  Both{' '}
                  <code className="font-mono text-[14px] text-signal-dark">SECURITY DEFINER</code>,
                  both rate-limited, both return minimal data. The anon role has{' '}
                  <code className="font-mono text-[14px] text-signal-dark">execute</code> on these
                  two functions and nothing else.
                </p>
                <p>
                  Rate limiting is a small{' '}
                  <code className="font-mono text-[14px] text-signal-dark">rate_limits</code> table
                  keyed on slug + viewer identity rather than IP, because the tracker can't see the
                  IP from the browser.
                </p>
                <p>
                  Per-session bearer tokens live in{' '}
                  <code className="font-mono text-[14px] text-signal-dark">sessions.token</code>{' '}
                  with a default of{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    encode(gen_random_bytes(32), 'hex')
                  </code>
                  . The tracker only sees the value through the{' '}
                  <code className="font-mono text-[14px] text-signal-dark">RETURNING</code> clause
                  of <code className="font-mono text-[14px] text-signal-dark">start_session</code>.
                  Every subsequent update call must pass it back.
                </p>
                <p>
                  When a recipient creates their first session for a document, a Postgres trigger
                  fires <code className="font-mono text-[14px] text-signal-dark">pg_net</code>{' '}
                  directly at the Resend API. There is no application-owned queue, Lambda, or Vercel
                  function. The Resend API key lives in Supabase Vault and is decrypted at trigger
                  time. Trade-off:{' '}
                  <code className="font-mono text-[14px] text-signal-dark">pg_net</code> is
                  fire-and-forget so deliveries can fail silently; the trigger writes every dispatch
                  to{' '}
                  <code className="font-mono text-[14px] text-signal-dark">notifications_log</code>{' '}
                  for after-the-fact reconciliation.
                </p>
                <p>
                  The schema is a sequence of idempotent SQL migrations under{' '}
                  <code className="font-mono text-[14px] text-signal-dark">schema/</code>. Apply
                  every numbered file in order when self-hosting.
                </p>
              </div>
            </section>

            <WhatLivesWhereTable />

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What v1.0 doesn't do
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  <strong className="text-ink">No PDF.</strong> DocSend and Papermark already cover
                  that surface. HTMLRadar is HTML-first by design.
                </p>
                <p>
                  <strong className="text-ink">No session replay.</strong> Section dwell, scroll
                  depth, total active time. No mouse positions, no keystrokes, no DOM snapshots.
                  Bundle stays small. Privacy bar stays higher.
                </p>
                <p>
                  <strong className="text-ink">No realtime websockets to the dashboard.</strong>{' '}
                  Dashboard polls Supabase on page load; the trigger-driven email is the realtime
                  channel. Supabase Realtime goes in when paying customers ask.
                </p>
                <p>
                  <strong className="text-ink">No browser analytics SDK.</strong> Product events
                  first land in Supabase. The monitor worker replays them to PostHog server-side for
                  product analytics.
                </p>
                <p>
                  <strong className="text-ink">No Vercel.</strong> Cloudflare Pages runs Next.js on
                  the edge. One fewer vendor in the dependency graph.
                </p>
              </div>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Takeaway
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  Four packages, a versioned SQL schema, and two core infrastructure vendors:
                  Cloudflare and Supabase. The whole thing is AGPL-3.0 at{' '}
                  <a
                    href="https://github.com/htmlradar/htmlradar"
                    className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                  >
                    github.com/htmlradar/htmlradar
                  </a>
                  . Issues and patches welcome.
                </p>
              </div>
            </section>
          </div>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Built an HTML deck of your own? See{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                how to track the HTML deck you already built
              </Link>
              .
            </p>
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}

// ─── Visuals ──────────────────────────────────────────────────────────────

function ArchitectureDiagram() {
  return (
    <figure className="my-2 overflow-hidden rounded-2xl border border-line bg-paper-2/40 p-6 md:p-8">
      <svg
        viewBox="0 0 640 320"
        className="mx-auto block h-auto w-full max-w-[560px]"
        role="img"
        aria-label="Architecture: sender uses the Next.js app, recipient hits the proxy worker, both touch Supabase"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#7A1F2E" />
          </marker>
        </defs>

        {/* Sender row */}
        <g>
          <Pill x={20} y={20} w={120} label="Sender browser" sub="dashboard" />
          <Arrow from={{ x: 140, y: 50 }} to={{ x: 240, y: 50 }} />
          <Pill x={240} y={20} w={150} label="packages/app" sub="Next.js · CF Pages" accent />
        </g>

        {/* Recipient row */}
        <g>
          <Pill x={20} y={170} w={120} label="Recipient browser" sub="reads the deck" />
          <Arrow from={{ x: 140, y: 200 }} to={{ x: 240, y: 200 }} label="/r/{slug}" />
          <Pill x={240} y={170} w={150} label="packages/proxy" sub="CF Worker" accent />
          <Arrow from={{ x: 315, y: 215 }} to={{ x: 315, y: 268 }} />
          <Pill x={240} y={270} w={150} label="packages/tracker" sub="22 KB IIFE" />
        </g>

        {/* Supabase + R2 */}
        <Pill x={460} y={20} w={160} label="Supabase" sub="auth · postgres · vault" />
        <Pill x={460} y={140} w={160} label="R2" sub="document HTML" />
        <Pill x={460} y={260} w={160} label="Supabase" sub="sessions · events" />

        <Arrow from={{ x: 390, y: 50 }} to={{ x: 460, y: 50 }} />
        <Arrow from={{ x: 390, y: 200 }} to={{ x: 460, y: 170 }} label="fetch HTML" />
        <Arrow from={{ x: 390, y: 300 }} to={{ x: 460, y: 290 }} label="rpc" />
      </svg>
      <figcaption className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
        Three request-path packages, plus a monitor worker
      </figcaption>
    </figure>
  );
}

function RecipientFlowDiagram() {
  const steps = [
    { n: '01', label: 'GET /r/{slug}', sub: 'recipient browser' },
    { n: '02', label: 'Gate check', sub: 'HMAC cookie or email prompt' },
    { n: '03', label: 'Fetch HTML', sub: 'R2 or external URL' },
    { n: '04', label: 'Inject <script>', sub: 'Cloudflare HTMLRewriter' },
    { n: '05', label: 'Stream response', sub: 'first byte to recipient' },
    { n: '06', label: 'start_session RPC', sub: 'tracker boots, gets token' },
    { n: '07', label: 'Heartbeat every 15s', sub: 'update_session, dwell + scroll' },
  ];
  return (
    <figure className="my-2 overflow-hidden rounded-2xl border border-line bg-paper-2/40 p-6 md:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
        Recipient flow · /r/{`{slug}`}
      </p>
      <ol className="mt-4 space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-4">
            <span className="mt-[2px] inline-block min-w-[28px] font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
              {s.n}
            </span>
            <div>
              <div className="font-mono text-[13.5px] text-ink">{s.label}</div>
              <div className="font-mono text-[11.5px] text-graphite">{s.sub}</div>
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function WhatLivesWhereTable() {
  const rows: Array<[string, string, string]> = [
    ['Uploaded HTML', 'Cloudflare R2', 'encrypted at rest'],
    ['Owner accounts + shares', 'Supabase Postgres', 'RLS, owner-scoped'],
    ['Recipient session + dwell', 'Supabase Postgres', 'sessions, section_events'],
    ['Email-gate cookie', 'Recipient browser', 'HMAC, stateless, 24h'],
    ['Tracker fingerprint', 'Recipient browser', 'localStorage UUID, anon'],
    ['Resend API key', 'Supabase Vault', 'decrypted at trigger time'],
  ];
  return (
    <figure className="my-2 overflow-x-auto rounded-2xl border border-line bg-paper">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="bg-paper-2/50 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
          <tr>
            <th className="px-4 py-3">Data</th>
            <th className="px-4 py-3">Lives at</th>
            <th className="px-4 py-3">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <td className="px-4 py-3 font-mono text-[12.5px] text-ink">{a}</td>
              <td className="px-4 py-3 text-[13px] text-ink-soft">{b}</td>
              <td className="px-4 py-3 font-mono text-[11.5px] text-graphite">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function CodeBlock({ file, code }: { file: string; code: string }) {
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-line bg-paper-2/40">
      <div className="border-b border-line bg-paper-2/60 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
        {file}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12.5px] leading-[1.55] text-ink">
        {code}
      </pre>
    </div>
  );
}

// ─── SVG helpers ──────────────────────────────────────────────────────────

function Pill({
  x,
  y,
  w,
  label,
  sub,
  accent = false,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  sub: string;
  accent?: boolean;
}) {
  const h = 60;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={accent ? '#FAF5EE' : '#FFFFFF'}
        stroke={accent ? '#7A1F2E' : '#D9CFC0'}
        strokeWidth={accent ? 1.5 : 1}
      />
      <text
        x={x + w / 2}
        y={y + 24}
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="11"
        fill="#1F1108"
      >
        {label}
      </text>
      <text
        x={x + w / 2}
        y={y + 42}
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="9.5"
        fill="#7E705C"
      >
        {sub}
      </text>
    </g>
  );
}

function Arrow({
  from,
  to,
  label,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  label?: string;
}) {
  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#7A1F2E"
        strokeWidth={1.4}
        markerEnd="url(#arrow)"
      />
      {label && (
        <text
          x={(from.x + to.x) / 2}
          y={Math.min(from.y, to.y) - 6}
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="9"
          fill="#7E705C"
        >
          {label}
        </text>
      )}
    </g>
  );
}
