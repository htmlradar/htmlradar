// Footer for the landing-v2 pages (/ and /pricing). One component so the
// two pages cannot drift apart again — they had, and /mcp, /for/claude-code
// and the tool pages ended up reachable from nowhere on a phone (the v2-nav
// link list is display:none under 760px, so the footer is the mobile nav).

import Link from 'next/link';
import { Logo } from './Logo';
import { ListedOn } from './ListedOn';

const ROW = { display: 'flex', gap: 24, flexWrap: 'wrap' } as const;

export function V2Footer() {
  return (
    <footer className="v2-foot">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Logo size="sm" />
        <span>· Document tracking for HTML. Open source · AGPL-3.0.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={ROW}>
          <Link href="/why">Why</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/tools">Tools</Link>
          <Link href="/mcp">MCP</Link>
          <Link href="/for/claude-code">For Claude Code</Link>
          <Link href="/for/claude-artifacts">For Claude artifacts</Link>
          <Link href="/for/reveal-js">For reveal.js</Link>
          <Link href="/use-case/pitch-deck-tracking">Pitch deck tracking</Link>
          <Link href="/use-case/proposal-tracking">Proposal tracking</Link>
          <Link href="/use-case/track-html-deck">Track HTML decks</Link>
          <Link href="/self-hosted">Self-hosted</Link>
          <Link href="/blog">Blog</Link>
        </div>
        <div style={ROW}>
          <Link href="/compare/docsend">vs DocSend</Link>
          <Link href="/compare/papermark">vs Papermark</Link>
          <Link href="/compare/peony">vs Peony</Link>
          <Link href="/compare/stacktree">vs Stacktree</Link>
          <Link href="/compare/tiiny-host">vs Tiiny Host</Link>
          <Link href="/compare/hummingdeck">vs Hummingdeck</Link>
          <Link href="/compare/docsend-vs-papermark">DocSend vs Papermark</Link>
          <Link href="/pl/alternatywa-dla-docsend" lang="pl">
            Alternatywa dla DocSend
          </Link>
        </div>
        <div style={ROW}>
          <Link href="/feedback">Feedback</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <Link href="/sign-in">Sign in</Link>
        </div>
      </div>
      <ListedOn />
    </footer>
  );
}
