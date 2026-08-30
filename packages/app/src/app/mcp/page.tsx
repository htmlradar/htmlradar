import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { CodeBlock } from '@/components/CodeBlock';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'HTMLRadar MCP Server — Share HTML as a Tracked Link | HTMLRadar',
  description:
    'An MCP server that publishes the HTML your agent just wrote as a tracked link, and reports back who opened it and which sections they read. Claude Code, Cursor, Codex.',
  path: '/mcp',
});

const FAQ = [
  {
    q: 'What does the HTMLRadar MCP server do?',
    a: 'It gives your agent two abilities: publish an HTML document as a tracked link, and read back who opened that link, how long they stayed, and which sections held their attention. It is a stdio MCP server that works with Claude Code, Cursor, Codex CLI, and any other MCP client.',
  },
  {
    q: 'How is this different from other publish-from-an-agent MCP servers?',
    a: 'Most of them stop at returning a URL. HTMLRadar keeps the other half of the loop: the agent can ask, the next day, whether the recipient read what you sent and which sections they spent time on. That question is the reason the server exists.',
  },
  {
    q: 'Do I need an API key?',
    a: 'Yes. Sign in at htmlradar.com, open Settings, and create a key under API keys. Pass it to the server as the HTMLRADAR_API_KEY environment variable rather than as a literal command-line argument, so it stays out of your shell history. The server reads nothing else and sends no telemetry.',
  },
  {
    q: 'What does the recipient see?',
    a: 'The document, exactly as written, behind an email prompt unless you turn the gate off. They never see the tracking, the dashboard, or anyone else who opened the link. HTMLRadar stores no raw IP address, no keystrokes, no mouse positions and no session replay.',
  },
  {
    q: 'What happens when the free links run out?',
    a: 'The free tier covers two tracked links. After that the share_html tool returns an upgrade message instead of a link, and the agent is instructed to relay it to you rather than retry. Pro is $15 a month or $150 a year for unlimited links.',
  },
  {
    q: 'Can I point it at my own instance?',
    a: 'Yes. HTMLRadar is AGPL-3.0 end to end. Set HTMLRADAR_API_URL to your own deployment and the server talks to that instead of htmlradar.com.',
  },
];

const TOOLS = [
  [
    'share_html',
    'Publish HTML as a tracked link',
    'Takes the markup itself or a path to a .html file, plus optional recipient label, email gate, password, allowed email domains, expiry and custom link name. Returns the tracked link, the dashboard link and the share id.',
  ],
  [
    'get_share_activity',
    'Ask whether it was read',
    'Takes a share id. Reports whether the link was opened, by whom, when, how long they actively read, how far they scrolled, and which sections took the most time.',
  ],
  [
    'whoami',
    'Check the account and plan',
    'Reports which account the key belongs to, the plan it is on, and how many free tracked links are left.',
  ],
];

export default function McpPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'MCP server', url: '/mcp' },
            ]}
          />
          <SectionMark>HTMLRadar · MCP</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Publish the HTML your agent just wrote as a tracked link.
          </h1>
          <DirectAnswer updated="August 2026">
            The HTMLRadar MCP server gives any agent — Claude Code, Cursor, Codex — one tool that
            turns an HTML deck, proposal or report into a tracked link, and a second tool that
            reports who opened it, how long they read, and which sections held them. Free for two
            links, then $15 a month. AGPL-3.0.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Your agent writes an HTML deck. You send it. Then nothing — you have no idea whether it
            was opened. This closes that loop without leaving the terminal.
          </p>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The one thing other publish-from-agent servers do not do
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              There are plenty of MCP servers that will put a file on the internet and hand back a
              URL. That is the easy half. The half that matters is the next morning, when you want
              to know whether the person you sent it to actually read it.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              HTMLRadar is the one where the agent can ask. &ldquo;Did anyone read the proposal I
              shared yesterday?&rdquo; returns a real answer: opened at 14:02, four minutes of
              active reading, 87% scroll depth, two minutes forty on The Ask, skipped Market sizing.
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">Install</h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              First create an API key at{' '}
              <Link href="/settings" className="text-signal-dark hover:underline">
                htmlradar.com/settings
              </Link>{' '}
              under <span className="font-mono text-[14px]">API keys</span>. Keys start with{' '}
              <span className="font-mono text-[14px]">hr_live_</span>.
            </p>

            <h3 className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
              Claude Code
            </h3>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
              Put the key in your environment first. A key passed as a literal argument stays in
              your shell history, and on most systems it is visible in the process list to anyone
              else on the machine.
            </p>
            <CodeBlock
              label="terminal"
              code={`export HTMLRADAR_API_KEY=hr_live_…
claude mcp add htmlradar -e HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp`}
            />
            <p className="text-[15px] leading-relaxed text-ink-soft">
              Or install the plugin, which adds the server plus a skill that teaches Claude when to
              offer a tracked link. It reads the same environment variable, so there is nothing to
              paste:
            </p>
            <CodeBlock
              label="claude code"
              code={`/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar`}
            />
            <p className="text-[15px] leading-relaxed text-ink-soft">
              The literal form works too —{' '}
              <span className="font-mono text-[13px]">-e HTMLRADAR_API_KEY=hr_live_xxx</span> — and
              is fine for a throwaway key you are about to revoke.
            </p>

            <h3 className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
              Cursor
            </h3>
            <CodeBlock
              label=".cursor/mcp.json"
              code={`{
  "mcpServers": {
    "htmlradar": {
      "command": "npx",
      "args": ["-y", "htmlradar-mcp"],
      "env": { "HTMLRADAR_API_KEY": "\${env:HTMLRADAR_API_KEY}" }
    }
  }
}`}
            />
            <p className="text-[15px] leading-relaxed text-ink-soft">
              Cursor expands{' '}
              <span className="font-mono text-[13px]">&#36;&#123;env:NAME&#125;</span> inside{' '}
              <span className="font-mono text-[13px]">env</span>, which keeps the key out of a file
              you might commit. A literal <span className="font-mono text-[13px]">hr_live_…</span>{' '}
              there also works.
            </p>

            <h3 className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
              Codex CLI
            </h3>
            <CodeBlock
              label="terminal"
              code={`export HTMLRADAR_API_KEY=hr_live_…
codex mcp add htmlradar --env HTMLRADAR_API_KEY=$HTMLRADAR_API_KEY -- npx -y htmlradar-mcp`}
            />

            <p className="mt-6 rounded-2xl border border-line bg-paper-2/40 p-5 text-[14px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">npm publish is pending.</span> Until{' '}
              <span className="font-mono text-[13px]">htmlradar-mcp</span> is on npm, clone the
              repository, run{' '}
              <span className="font-mono text-[13px]">
                pnpm install &amp;&amp; pnpm --filter ./packages/mcp build
              </span>
              , and replace the launch command with{' '}
              <span className="font-mono text-[13px]">
                node /path/to/htmlradar/packages/mcp/dist/index.js
              </span>
              .
            </p>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Three tools
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Tool</th>
                    <th className="px-5 py-3">Does</th>
                    <th className="px-5 py-3">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {TOOLS.map(([name, does, detail]) => (
                    <tr key={name}>
                      <td className="px-5 py-3.5 align-top font-mono text-[13px] text-ink">
                        {name}
                      </td>
                      <td className="px-5 py-3.5 align-top text-ink">{does}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              You do not call them by name. You say what you want:
            </p>
            <CodeBlock
              code={`share this deck with acme as a tracked link, email gate on

did anyone read the proposal I shared yesterday?`}
            />
          </section>

          <Faq items={FAQ} />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Get an API key
            </Link>
            <p className="mt-3 text-[13px] text-graphite">
              First 2 tracked links free. No credit card. AGPLv3 source on{' '}
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                GitHub
              </a>
              .
            </p>
          </section>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/for/claude-code" className="text-signal-dark hover:underline">
                HTMLRadar for Claude Code
              </Link>
              ,{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                track a Claude artifact
              </Link>
              ,{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                turn an HTML file into a link
              </Link>
              , and{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
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
