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
  title: 'HTMLRadar for Claude Code — Track What You Generate | HTMLRadar',
  description:
    'Generate an HTML deck in Claude Code, publish it as a tracked link without leaving the terminal, and ask Claude the next day whether the recipient read it.',
  path: '/for/claude-code',
});

const FAQ = [
  {
    q: 'How do I add HTMLRadar to Claude Code?',
    a: 'Either install the plugin with /plugin marketplace add htmlradar/htmlradar followed by /plugin install htmlradar@htmlradar, or add the MCP server directly with claude mcp add htmlradar -e HTMLRADAR_API_KEY=hr_live_xxx -- npx -y htmlradar-mcp. Both need an API key from htmlradar.com/settings.',
  },
  {
    q: 'Does Claude Code offer this on its own?',
    a: 'The plugin ships a skill that teaches Claude when to offer a tracked link — after it writes an HTML deck, proposal or report that you are clearly sending to someone else. It stays quiet for HTML that is part of the software you are building.',
  },
  {
    q: 'Can Claude tell me who read the deck?',
    a: 'Yes. Ask whether the link has been opened and Claude calls get_share_activity, which reports the viewer, when they first opened it, how long they actively read, how far they scrolled, and which sections took the most time.',
  },
  {
    q: 'Does Claude see the reading data of everyone I have shared with?',
    a: 'Only what you ask for. The tool takes one share id and returns the activity on that share. The recipient never sees any of it — they see the document and nothing else.',
  },
  {
    q: 'What if I hit the free limit mid-conversation?',
    a: 'The share_html tool returns the upgrade message rather than a link, and the skill instructs Claude to relay it to you and stop rather than retrying. Free covers two tracked links; Pro is $15 a month for unlimited.',
  },
];

export default function ForClaudeCodePage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'For Claude Code', url: '/for/claude-code' },
            ]}
          />
          <SectionMark>HTMLRadar · For Claude Code</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Claude Code wrote the deck. Find out if they read it.
          </h1>
          <DirectAnswer updated="August 2026">
            HTMLRadar adds two abilities to Claude Code: publish an HTML deck, proposal or report as
            a tracked link, and ask afterwards who opened it and which sections they read. Install
            the plugin, generate as usual, and the whole loop stays in the terminal. Free for two
            links, then $15 a month.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Claude Code is very good at producing a finished HTML document — a board update, a
            client proposal, a project brief with charts in it. The awkward part has always been
            what happens next. You copy the file somewhere, attach it to an email, and then it goes
            quiet.
          </p>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              The whole workflow
            </h2>

            <ol className="mt-6 space-y-8">
              <li>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  1 · Install it once
                </h3>
                <CodeBlock
                  label="claude code"
                  code={`/plugin marketplace add htmlradar/htmlradar
/plugin install htmlradar@htmlradar`}
                />
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Create a key at{' '}
                  <Link href="/settings" className="text-signal-dark hover:underline">
                    htmlradar.com/settings
                  </Link>{' '}
                  under <span className="font-mono text-[14px]">API keys</span> and export it as{' '}
                  <span className="font-mono text-[14px]">HTMLRADAR_API_KEY</span>. If you would
                  rather skip the plugin and just add the server, the{' '}
                  <Link href="/mcp" className="text-signal-dark hover:underline">
                    MCP install lines
                  </Link>{' '}
                  are one command.
                </p>
              </li>

              <li>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  2 · Generate the document as you always do
                </h3>
                <CodeBlock code={`build me a one-page Q3 update for the Acme account as HTML`} />
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Nothing changes here. You get{' '}
                  <span className="font-mono text-[14px]">q3-acme.html</span> on disk, same as
                  before.
                </p>
              </li>

              <li>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  3 · Ask for a tracked link
                </h3>
                <CodeBlock code={`share this deck with acme as a tracked link, email gate on`} />
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Claude calls <span className="font-mono text-[14px]">share_html</span> with the
                  file path and hands back a link like{' '}
                  <span className="font-mono text-[14px]">htmlradar.com/r/acme-q3</span>, a
                  dashboard link for you, and a reminder of what the recipient will see. With the
                  plugin installed, Claude usually offers this before you ask.
                </p>
              </li>

              <li>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  4 · Send the link, not the file
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  The recipient enters an email, then reads the document exactly as written. They
                  see nothing about the tracking, the dashboard, or anyone else who opened it.
                </p>
              </li>

              <li>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  5 · The next day, ask
                </h3>
                <CodeBlock code={`did anyone read the proposal I shared yesterday?`} />
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Claude calls <span className="font-mono text-[14px]">get_share_activity</span> and
                  answers with the reading, not just an open flag: opened at 14:02, four minutes
                  twelve of active reading, 87% scroll depth, two minutes forty-one on The Ask,
                  forty-eight seconds on Problem, Market sizing skipped entirely.
                </p>
              </li>
            </ol>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why the last step is the point
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Plenty of tools will put a file on the internet and give your agent a URL. Very few
              let the agent close the loop and tell you what happened to it. Section-level dwell is
              the difference between &ldquo;they opened it&rdquo; and &ldquo;they read the pricing
              twice and never reached the roadmap&rdquo; — which is the sentence that changes what
              you say in the follow-up.
            </p>
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
              <Link href="/mcp" className="text-signal-dark hover:underline">
                the HTMLRadar MCP server
              </Link>
              ,{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                track a Claude artifact
              </Link>
              ,{' '}
              <Link href="/use-case/proposal-tracking" className="text-signal-dark hover:underline">
                proposal tracking
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
