#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
// Regenerates public/llms-full.txt from the LIVE site's own HTML.
//
// Why generated rather than written: llms-full.txt is a copy of text that
// already exists on the pages. A hand-maintained copy drifts, and a file
// that states last month's price is worse than no file at all. This reads
// the pages, so it can only ever be as wrong as the site is.
//
//   pnpm gen:llms                      # reads https://htmlradar.com
//   pnpm gen:llms http://localhost:3000
//
// Run it AFTER a deploy, then commit the result. It is deliberately not a
// build step: a build that reaches out to the network is a build that fails
// when the network does.
//
// Worth knowing before you spend time here: the evidence that anything reads
// this file is thin. Ahrefs' 137,000-domain server-log study found 97% of
// published llms.txt files got zero requests, and Google's AI optimization
// guide says Search ignores it. The narrow case that still argues for it is
// developer tooling (Cursor, Copilot) fetching docs, which is our audience.
// See docs/workstreams/seo-and-indexing/GEO-2026-09-04.md before extending.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = (process.argv[2] ?? 'https://htmlradar.com').replace(/\/$/, '');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/llms-full.txt');

// The pages worth carrying in full. Not the whole sitemap: the seven compare
// pages and the three use-case pages repeat each other heavily, and a file
// padded with near-duplicates is a worse answer than a short one.
const PAGES = [
  '/',
  '/about',
  '/why',
  '/pricing',
  '/mcp',
  '/self-hosted',
  '/tools/html-to-link',
  '/for/claude-artifacts',
  '/compare/docsend',
  '/blog/what-deck-sharing-tools-record',
];

/** Very small HTML-to-text pass. Good enough for prose; not a parser. */
function toText(html) {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      // Keep block boundaries so sentences do not run together.
      .replace(/<\/(p|div|section|li|h[1-6]|dt|dd|tr|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      // A space, not nothing: the headline is built from nested spans, and
      // stripping to '' welds "HTML." to the next word.
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&apos;|&rsquo;|&lsquo;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ldquo;|&rdquo;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// Local date, not toISOString(): every other date on this site is the
// founder's own day, and a UTC stamp reads a day early from IST.
const today = new Date().toLocaleDateString('en-CA');
const parts = [
  '# HTMLRadar — full text of the main pages',
  '',
  'HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal',
  'as a tracked link, and seeing who opened it, which sections they read, and for',
  'how long.',
  '',
  `Generated from the live pages at ${ORIGIN} on ${today} by`,
  'packages/app/scripts/gen-llms-full.mjs. If a fact here disagrees with the page',
  'it came from, the page is right and this file is stale.',
  '',
  'Short version, with links only: /llms.txt',
];

let failed = 0;
for (const p of PAGES) {
  const url = `${ORIGIN}${p}`;
  let text;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'htmlradar-llms-full-generator' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = toText(await res.text());
    if (text.length < 200) throw new Error(`only ${text.length} chars of text`);
  } catch (err) {
    // Loud, and non-zero exit: a silently truncated llms-full.txt is the
    // failure mode this file is supposed to prevent.
    console.error(`FAILED ${url}: ${err.message}`);
    failed += 1;
    continue;
  }
  console.log(`ok   ${url} (${text.length} chars)`);
  parts.push('', '---', '', `## ${ORIGIN}${p}`, '', text);
}

if (failed > 0) {
  console.error(`\n${failed} page(s) failed. Not writing ${OUT}.`);
  process.exit(1);
}

const out = `${parts.join('\n')}\n`;
await writeFile(OUT, out, 'utf8');
console.log(`\nWrote ${OUT} (${out.length} bytes, ${PAGES.length} pages).`);
