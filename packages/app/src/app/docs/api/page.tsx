import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { CodeBlock } from '@/components/CodeBlock';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'HTTP API Reference | HTMLRadar',
  description:
    'Call the same HTTP API the dashboard and the MCP server use: create a tracked link, list them, read who opened one, revoke a link, replace a document.',
  path: '/docs/api',
});

// Field tables. Names, types, defaults and constraints come from the zod-free
// hand validation in src/app/api/v1/**/route.ts and src/lib/api-auth.ts, read
// directly — nothing here is guessed.
const SHARE_FIELDS: [string, string, string, string][] = [
  ['html', 'string', 'one of html / url / document_id, required', 'Full markup. Up to 5 MB.'],
  [
    'url',
    'string',
    '—',
    'Accepted in the shape, but URL mode is not live on the API yet — returns a 422. Upload the HTML instead.',
  ],
  ['document_id', 'string', '—', 'A second link on a document you already created.'],
  ['title', 'string', "the document's <title>", 'Shown on your dashboard only.'],
  ['recipient_label', 'string', 'none', 'Who the link is for, e.g. "Acme".'],
  ['require_email', 'boolean', 'true', 'Ask for an email before the document opens.'],
  ['password', 'string', 'none', 'Extra gate on top of the email gate. At least 8 characters.'],
  ['lock_deck', 'boolean', 'true', 'Blocks save and print and adds a watermark.'],
  ['allowed_email_domains', 'string[]', 'none', 'Only these domains may open it.'],
  ['expires_in_hours', 'number', 'never', 'Positive number. The link stops working after it.'],
  ['slug', 'string', 'generated', 'Custom link name. Paid plans.'],
];

const ERROR_ROWS: [string, string, string][] = [
  ['401', 'invalid_api_key', 'The Authorization header is missing or the key is wrong.'],
  ['402', 'free_limit_reached', 'The free plan’s two-link cap is reached; body has upgrade_url.'],
  ['403', 'read_only_key', 'A read-only key called a route that creates, revokes or replaces.'],
  ['404', 'not_found', 'Wrong id, or someone else’s — both read the same, on purpose.'],
  ['408', 'request_timeout', 'The request body stopped arriving before it finished.'],
  ['409', 'conflict', '/replace only: another replace or a delete landed on the document first.'],
  ['413', 'too_large', 'Over the 5 MB document cap. The body carries max_bytes.'],
  ['422', 'validation', 'The body is missing a required field or one is the wrong shape.'],
  [
    '429',
    'rate_limited',
    'Over an hourly budget. retry_after_seconds is in the body and the Retry-After header.',
  ],
  ['500', 'internal / storage_failed', 'Something broke on our side. Nothing was written.'],
];

const RATE_LIMIT_ROWS: [string, string][] = [
  ['GET /api/v1/me', '60/hour, per key'],
  [
    'POST /api/v1/shares, POST /api/v1/documents/{id}/replace',
    '75/hour Pro, 30/hour free, per account — plus 120/hour per address',
  ],
  [
    'GET /api/v1/shares, GET /api/v1/documents, POST /api/v1/shares/{id}/revoke',
    '120/hour, per account',
  ],
  ['GET /api/v1/shares/{id}/activity', '300/hour, per key'],
  ['A missing or wrong key', '60/hour, per address'],
];

export default function ApiDocsPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'API', url: '/docs/api' },
            ]}
          />
          <SectionMark>HTMLRadar &middot; API</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            The HTMLRadar API
          </h1>
          <DirectAnswer updated="September 2026">
            The HTMLRadar API is the same set of calls the dashboard and the MCP server use to
            create tracked links, list them, read who opened one, revoke a link, and replace a
            document behind links you already sent. Authenticate with a key from Settings; every
            response below is exactly what the route returns.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Every route here is the same write or read the browser already makes — the{' '}
            <Link href="/mcp" className="text-signal-dark hover:underline">
              MCP server
            </Link>{' '}
            calls the same ones for your agent. Use it directly when a script, a cron job, or your
            own tool needs the same thing.
          </p>

          <section className="mt-14" id="authentication">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Authentication
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Create a key at{' '}
              <Link href="/settings" className="text-signal-dark hover:underline">
                htmlradar.com/settings
              </Link>{' '}
              under <span className="font-mono text-[14px]">API keys</span>. A key is{' '}
              <span className="font-mono text-[14px]">hr_live_</span> followed by 40 hexadecimal
              characters, shown once — only a hash is stored, so it can&rsquo;t be recovered if
              lost. Send it on every call:
            </p>
            <CodeBlock label="every request" code={`Authorization: Bearer hr_live_…`} />
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Choose a scope when you create the key. <strong>Full</strong> can create, replace and
              revoke; <strong>read-only</strong> can only list and read activity — a write from a
              read-only key comes back as a 403 naming the missing permission. Neither scope can
              delete anything; that stays on the website, where a person types the confirmation.
            </p>
          </section>

          <section className="mt-14" id="me">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              GET /api/v1/me
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Is this key good, and what plan is it on. No parameters.
            </p>
            <CodeBlock
              label="request"
              code={`curl https://htmlradar.com/api/v1/me \\\n  -H "Authorization: Bearer hr_live_…"`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "user_id": "c1a2b3c4-…",\n  "tier": "free",\n  "free_links_used": 1,\n  "free_links_cap": 2\n}`}
            />
            <p className="mt-3 text-[14px] leading-relaxed text-graphite">
              On Pro, <span className="font-mono text-[13px]">free_links_cap</span> is{' '}
              <span className="font-mono text-[13px]">null</span> — there is no lifetime cap to
              report.
            </p>
          </section>

          <section className="mt-14" id="create-share">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              POST /api/v1/shares
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Turns HTML into a tracked link, or adds a second link to a document you already
              created. Provide exactly one of <span className="font-mono text-[13px]">html</span>,{' '}
              <span className="font-mono text-[13px]">url</span> or{' '}
              <span className="font-mono text-[13px]">document_id</span>.
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Field</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Default</th>
                    <th className="px-5 py-3">Constraint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SHARE_FIELDS.map(([name, type, def, constraint]) => (
                    <tr key={name}>
                      <td className="px-5 py-3 align-top font-mono text-[13px] text-ink">{name}</td>
                      <td className="px-5 py-3 align-top font-mono text-[13px] text-ink-soft">
                        {type}
                      </td>
                      <td className="px-5 py-3 align-top text-ink-soft">{def}</td>
                      <td className="px-5 py-3 align-top text-ink-soft">{constraint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock
              label="request"
              code={`curl https://htmlradar.com/api/v1/shares \\\n  -H "Authorization: Bearer hr_live_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "html": "<html>…</html>",\n    "recipient_label": "Acme"\n  }'`}
            />
            <CodeBlock
              label="response — 201"
              code={`{\n  "share_id": "11111111-1111-4111-8111-111111111111",\n  "document_id": "22222222-2222-4222-8222-222222222222",\n  "url": "https://htmlradar.page/r/acme-proposal",\n  "dashboard_url": "https://htmlradar.com/docs/22222222-2222-4222-8222-222222222222"\n}`}
            />
          </section>

          <section className="mt-14" id="list-shares">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              GET /api/v1/shares
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The account&rsquo;s links, newest first, fifty at a time. Pass{' '}
              <span className="font-mono text-[13px]">?before=</span> with the previous page&rsquo;s{' '}
              <span className="font-mono text-[13px]">next_before</span> to go back.
            </p>
            <CodeBlock
              label="request"
              code={`curl https://htmlradar.com/api/v1/shares \\\n  -H "Authorization: Bearer hr_live_…"`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "shares": [\n    {\n      "share_id": "11111111-1111-4111-8111-111111111111",\n      "slug": "acme-proposal",\n      "url": "https://htmlradar.page/r/acme-proposal",\n      "recipient_label": "Acme",\n      "document_id": "22222222-2222-4222-8222-222222222222",\n      "document_title": "Q3 proposal",\n      "created_at": "2026-08-30T10:00:00.000Z",\n      "revoked": false,\n      "revoked_at": null,\n      "expires_at": null,\n      "expired": false,\n      "opened": true,\n      "last_open": "2026-08-31T09:00:00.000Z"\n    }\n  ],\n  "next_before": null\n}`}
            />
          </section>

          <section className="mt-14" id="list-documents">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              GET /api/v1/documents
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The account&rsquo;s documents, newest first, with how many links point at each one.
              Same paging as above. The phishing screen&rsquo;s score is deliberately left out —
              it&rsquo;s an operator signal, not a customer number.
            </p>
            <CodeBlock
              label="request"
              code={`curl https://htmlradar.com/api/v1/documents \\\n  -H "Authorization: Bearer hr_live_…"`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "documents": [\n    {\n      "document_id": "22222222-2222-4222-8222-222222222222",\n      "title": "Q3 proposal",\n      "created_at": "2026-08-30T10:00:00.000Z",\n      "share_count": 2\n    }\n  ],\n  "next_before": null\n}`}
            />
          </section>

          <section className="mt-14" id="activity">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              GET /api/v1/shares/&#123;id&#125;/activity
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Whether the link was opened, by whom, how long they read, how far they scrolled, and
              which sections held them, in deck order. Add{' '}
              <span className="font-mono text-[13px]">?include_detail=true</span> for a nested{' '}
              <span className="font-mono text-[13px]">detail</span> object per viewer — country,
              city, device and referrer — off by default, since that&rsquo;s a named person&rsquo;s
              location and device.
            </p>
            <CodeBlock
              label="request"
              code={`curl "https://htmlradar.com/api/v1/shares/11111111-1111-4111-8111-111111111111/activity" \\\n  -H "Authorization: Bearer hr_live_…"`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "share_id": "11111111-1111-4111-8111-111111111111",\n  "url": "https://htmlradar.page/r/acme-proposal",\n  "opened": true,\n  "viewers": [\n    {\n      "label": "Acme",\n      "email": "jane@acme.com",\n      "first_open": "2026-08-29T14:02:00.000Z",\n      "last_seen": "2026-08-29T14:09:00.000Z",\n      "active_seconds": 252,\n      "max_scroll": 87,\n      "sections": [\n        { "title": "The Ask", "time_seconds": 161 },\n        { "title": "Problem", "time_seconds": 48 }\n      ],\n      "detail": { "country": "US", "city": "Austin", "device": "desktop", "referrer": null }\n    }\n  ]\n}`}
            />
            <p className="mt-3 text-[14px] leading-relaxed text-graphite">
              <span className="font-mono text-[13px]">label</span> is the link&rsquo;s own{' '}
              <span className="font-mono text-[13px]">recipient_label</span>, the same on every row
              — not the viewer&rsquo;s name; <span className="font-mono text-[13px]">detail</span>{' '}
              only appears with <span className="font-mono text-[13px]">include_detail</span>. A
              link nobody has opened returns{' '}
              <span className="font-mono text-[13px]">
                &#123; "opened": false, "viewers": [] &#125;
              </span>
              .
            </p>
          </section>

          <section className="mt-14" id="revoke">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              POST /api/v1/shares/&#123;id&#125;/revoke
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Switches a link off. Reversible — send{' '}
              <span className="font-mono text-[13px]">&#123; "revoked": false &#125;</span> to put
              it back on; an empty body revokes.
            </p>
            <CodeBlock
              label="request"
              code={`curl -X POST "https://htmlradar.com/api/v1/shares/11111111-1111-4111-8111-111111111111/revoke" \\\n  -H "Authorization: Bearer hr_live_…"`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "share_id": "11111111-1111-4111-8111-111111111111",\n  "url": "https://htmlradar.page/r/acme-proposal",\n  "revoked": true,\n  "revoked_at": "2026-09-04T12:00:00.000Z"\n}`}
            />
          </section>

          <section className="mt-14" id="replace">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              POST /api/v1/documents/&#123;id&#125;/replace
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Puts new content behind every link already sent — same addresses, same settings, same
              reading history, no second link. The new HTML runs through the same phishing screen as
              any upload; the previous version stays in the document&rsquo;s history.
            </p>
            <CodeBlock
              label="request"
              code={`curl -X POST "https://htmlradar.com/api/v1/documents/22222222-2222-4222-8222-222222222222/replace" \\\n  -H "Authorization: Bearer hr_live_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "html": "<html>…</html>" }'`}
            />
            <CodeBlock
              label="response — 200"
              code={`{\n  "document_id": "22222222-2222-4222-8222-222222222222",\n  "version": 2,\n  "links_unchanged": true\n}`}
            />
            <p className="mt-3 text-[14px] leading-relaxed text-graphite">
              A conflict — someone else replaced or deleted the document mid-upload — returns a 409
              rather than overwriting anything; read the current version and try again.
            </p>
          </section>

          <section className="mt-14" id="errors">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Errors and rate limits
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Every error is JSON with an <span className="font-mono text-[13px]">error</span>{' '}
              field:
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">error</th>
                    <th className="px-5 py-3">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ERROR_ROWS.map(([status, name, when]) => (
                    <tr key={name}>
                      <td className="px-5 py-3 align-top font-mono text-[13px] text-ink">
                        {status}
                      </td>
                      <td className="px-5 py-3 align-top font-mono text-[13px] text-ink-soft">
                        {name}
                      </td>
                      <td className="px-5 py-3 align-top text-ink-soft">{when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Every limit is per hour, on a rolling window rather than the clock hour:
            </p>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full min-w-[480px] text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Route</th>
                    <th className="px-5 py-3">Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {RATE_LIMIT_ROWS.map(([route, budget]) => (
                    <tr key={route}>
                      <td className="px-5 py-3 align-top font-mono text-[12.5px] text-ink">
                        {route}
                      </td>
                      <td className="px-5 py-3 align-top text-ink-soft">{budget}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-14" id="from-an-agent">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The same calls from an agent
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Everything above is also what the{' '}
              <Link href="/mcp" className="text-signal-dark hover:underline">
                HTMLRadar MCP server
              </Link>{' '}
              calls, wrapped as seven tools an agent asks for in words —{' '}
              <span className="font-mono text-[13px]">share_html</span> is{' '}
              <span className="font-mono text-[13px]">POST /api/v1/shares</span>,{' '}
              <span className="font-mono text-[13px]">get_share_activity</span> is the activity
              route above. Call the API directly from a script; use the MCP server when an agent
              should call it for you.
            </p>
          </section>

          <section className="mt-10 border-t border-line pt-8">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              The API stores nothing the dashboard doesn&rsquo;t already store: the document, the
              link&rsquo;s settings, and who opened it. Full detail is in the{' '}
              <Link href="/privacy" className="text-signal-dark hover:underline">
                privacy policy
              </Link>
              .
            </p>
          </section>

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/mcp" className="text-signal-dark hover:underline">
                MCP server
              </Link>
              ,{' '}
              <Link href="/settings" className="text-signal-dark hover:underline">
                create an API key
              </Link>
              , and{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
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
