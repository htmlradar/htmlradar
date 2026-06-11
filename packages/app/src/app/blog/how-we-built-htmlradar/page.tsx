// Blog post #1 — technical credibility piece for the OSS audience.
// Visual-led, code-anchored, honest about what's not done. ~950 words,
// 3 inline diagrams. Lands on day 0 of soft launch.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';

export const runtime = 'edge';

export const metadata = {
  title: 'How I built HTMLRadar in three packages',
  description:
    'The shape of HTMLRadar: a Next.js app, a Cloudflare Worker, a 14 KB browser tracker, six SQL files. What each part owns, why I kept them separate, and the calls I made.',
};

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <ArticleLd
            headline="How I built HTMLRadar in three packages"
            datePublished="2026-05-14"
            url="/blog/how-we-built-htmlradar"
          />
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              {
                name: 'How I built HTMLRadar in three packages',
                url: '/blog/how-we-built-htmlradar',
              },
            ]}
          />
          <SectionMark>HTMLRadar · Engineering</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[52px]">
            How I built HTMLRadar in three packages.
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
              the rest of my company's site is branded, not flattened into a PDF. DocSend and the
              other tracking tools only accept PDFs. So I built a tracker for HTML decks for myself,
              then realised other founders had the same problem and open-sourced it.
            </p>

            <p>
              The pattern is bigger than one founder's preference. Teams that use LLMs heavily ship
              more and more of their work as HTML — specs, design mocks, reports, dashboards,
              internal briefs. ChatGPT, Claude, v0, Lovable, and Anthropic Artifacts all produce
              HTML for the things that matter. PDFs are a pre-LLM artifact; the new deliverable is
              HTML. The analytics tooling stayed on PDFs. That's the gap HTMLRadar tries to fill.
            </p>

            <p>
              HTMLRadar is open-source DocSend for HTML. You upload an HTML deck (or paste a URL),
              share a tracked link, and watch in real time who reads it, which sections they dwell
              on, when they bounce. The repo is AGPL-3.0 at{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                github.com/htmlradar/htmlradar
              </a>
              .
            </p>

            <p>
              The code splits into three packages. Each runs in a different place. Each is small and
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
                    htmlradar.com/r/swift-falcon-a3f2
                  </code>
                  , the request hits this worker. It runs the email gate, fetches the HTML from R2
                  or an external URL, injects the tracker, streams the page back.
                </p>
                <p>
                  <code className="font-mono text-[14px] text-signal-dark">packages/tracker</code>{' '}
                  is a 14 KB browser IIFE. The proxy injects a single{' '}
                  <code className="font-mono text-[14px] text-signal-dark">&lt;script&gt;</code> tag
                  into every served document. The tracker identifies the viewer, prompts for email
                  if the share requires one, and streams session metrics to Supabase.
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
                The tracker is 14 KB
              </h2>
              <div className="mt-4 space-y-4">
                <p>
                  14 KB is a tight budget. The tracker uses PostgREST directly rather than{' '}
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
                  The dwell tracker is a small state machine on the viewport. The tracker watches{' '}
                  IntersectionObserver entries on{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    h1[id], h2[id], h3[id]
                  </code>{' '}
                  (the convention every static-site generator emits), treat the most
                  recently-scrolled-past heading as the current section, and accumulate elapsed time
                  on that section while the tab is visible.
                </p>
                <p>
                  Flush runs every 15 seconds and on{' '}
                  <code className="font-mono text-[14px] text-signal-dark">pagehide</code> with{' '}
                  <code className="font-mono text-[14px] text-signal-dark">keepalive: true</code> so
                  the last second of analytics survives a close-tab. A single-flight mutex stops the
                  15-second timer racing the visibility-change flush during scroll-then-tab-away.
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
                  IP from the browser. Five attempts per 60s per identity. Forging viewers means
                  fabricating distinct identities per request, which is a reasonable bar for v1.0.
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
                  When a recipient session crosses the dwell threshold for the first time, a
                  Postgres trigger fires{' '}
                  <code className="font-mono text-[14px] text-signal-dark">pg_net</code> directly at
                  the Resend API. No queue, no Lambda, no Vercel function. The Resend API key lives
                  in Supabase Vault and is decrypted at trigger time. Trade-off:{' '}
                  <code className="font-mono text-[14px] text-signal-dark">pg_net</code> is
                  fire-and-forget so deliveries can fail silently; the trigger writes every dispatch
                  to{' '}
                  <code className="font-mono text-[14px] text-signal-dark">notifications_log</code>{' '}
                  for after-the-fact reconciliation.
                </p>
                <p>
                  The full schema is six SQL files at{' '}
                  <code className="font-mono text-[14px] text-signal-dark">code/schema/001_*</code>{' '}
                  through <code className="font-mono text-[14px] text-signal-dark">006_*</code>.
                  Each re-runs idempotently.
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
                  <strong className="text-ink">No third-party analytics.</strong> Events capture to
                  a Supabase table that's schema-compatible with PostHog. Replay-able as a batch
                  import if PostHog ever makes sense.
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
                  Three packages, six SQL files, two vendors (Cloudflare and Supabase). The whole
                  thing is AGPL-3.0 at{' '}
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
            <Link
              href="/"
              className="link-slide mt-6 inline-block font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </Link>
          </div>
        </article>
      </main>
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
          <Pill x={240} y={270} w={150} label="packages/tracker" sub="14 KB IIFE" />
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
        Two browsers, three packages, one database
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
    <figure className="my-2 overflow-hidden rounded-2xl border border-line bg-paper">
      <table className="w-full text-[13px]">
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
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.55] text-ink">
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
