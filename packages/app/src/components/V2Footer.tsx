// The site footer. One component so no page can drift apart from the rest —
// they had, and /mcp, /for/claude-code and the tool pages ended up reachable
// from nowhere on a phone (the v2-nav link list is display:none under 760px,
// so the footer is the mobile nav).
//
// Until 2026-08-31 only / and /pricing rendered it; twenty-three public pages
// simply stopped after a bare "← Back to home" link. It is now mounted on
// every public page.
//
// The links are grouped and labelled (Sol's messaging finding 10). No route
// changed — the same destinations, sorted so a visitor can find the one they
// want instead of reading a forty-item run-on list.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './Logo';
import { ListedOn } from './ListedOn';

export function V2Footer() {
  return (
    <footer className="v2-foot">
      <div className="v2-foot-brand">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Logo size="sm" />
          <span>· Document tracking for HTML. Open source · AGPL-3.0.</span>
        </div>
        <ListedOn />
      </div>

      <div className="v2-foot-cols">
        <FooterGroup title="Product">
          <Link href="/why">Why HTMLRadar</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/tools">Tools</Link>
          <Link href="/blog">Blog</Link>
        </FooterGroup>

        <FooterGroup title="Use cases">
          <Link href="/use-case/pitch-deck-tracking">Pitch deck tracking</Link>
          <Link href="/use-case/proposal-tracking">Proposal tracking</Link>
          <Link href="/use-case/track-html-deck">Track HTML decks</Link>
        </FooterGroup>

        <FooterGroup title="Developers">
          <Link href="/mcp">MCP server</Link>
          <Link href="/for/claude-code">For Claude Code</Link>
          <Link href="/for/claude-artifacts">For Claude artifacts</Link>
          <Link href="/for/reveal-js">For reveal.js</Link>
          <Link href="/self-hosted">Self-hosted</Link>
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </FooterGroup>

        <FooterGroup title="Compare">
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
        </FooterGroup>

        <FooterGroup title="Company">
          <Link href="/feedback">Feedback</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/sign-in">Sign in</Link>
        </FooterGroup>
      </div>
    </footer>
  );
}

function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="v2-foot-col">
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
