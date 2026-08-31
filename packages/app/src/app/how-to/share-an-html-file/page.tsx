// Informational answer page for the "how to share an html file (as a link)"
// cluster — the richest, least-served vein in the 31 Aug keyword study.
// Deliberately not a tool: it answers the honest question (an HTML file has
// to be hosted before it opens as a link, a plain host makes it visible but
// blind, tracking is what tells you it was read) and routes the transactional
// intent to /tools/html-to-link and the Claude pages. HTMLRadar is disclosed
// as ours in the body and the FAQ. FAQPage JSON-LD comes from <Faq/>.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'How to Share an HTML File as a Link | HTMLRadar',
  description:
    'How to share an HTML file so someone can open it in a browser: host it for a plain public link, or send a tracked link when you also want to know it was read. The honest options and their tradeoffs.',
  path: '/how-to/share-an-html-file',
});

const FAQ = [
  {
    q: 'How do I share an HTML file so someone can open it in a browser?',
    a: 'Put the file on a web host and send the address it gives you. A free static host such as Netlify Drop, Cloudflare Pages, or GitHub Pages serves a single HTML file at a public web address that opens in any browser, with nothing for the reader to install. If the file pulls in images, fonts, or scripts from other sites, keep those links absolute so they still load for the reader.',
  },
  {
    q: 'How do I share an HTML file for free?',
    a: 'Every option here has a free tier. The plain static hosts are free for public pages. HTMLRadar, which is our own tool, is free for your first two tracked links and is open source under the AGPL-3.0 licence, so you can also run the whole thing yourself at no cost.',
  },
  {
    q: 'How can I tell if someone opened the HTML file I shared?',
    a: 'A plain host cannot tell you this: it serves the page and records nothing you can see. To know whether a specific person opened your file and which parts they read, send a tracked link instead of a public address. HTMLRadar, our tool, gives each recipient their own link and reports who opened it, which sections they read, and for how long.',
  },
  {
    q: 'How do I share an HTML file from Claude?',
    a: 'A Claude artifact and a file Claude Code writes are both HTML, so you share them the same way as any HTML file. Copy or download it as one self-contained HTML file, then either host it for a public link or, when you also want to know it was read, upload it for a tracked link.',
  },
];

export default function HowToShareAnHtmlFilePage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'How to share an HTML file', url: '/how-to/share-an-html-file' },
            ]}
          />
          <SectionMark>HTMLRadar · Guide</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[52px]">
            How to share an HTML file as a link.
          </h1>
          <DirectAnswer updated="August 2026">
            Most people get this half right. An HTML file only opens as a link once it is hosted
            somewhere, so you upload it to a web host and send the address. A plain host makes the
            page visible to anyone with the link. You only find out whether the person actually read
            it if you add tracking.
          </DirectAnswer>

          <div className="mt-10 space-y-5">
            <p className="max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              You have an HTML file — a deck, a proposal, a report, something an AI assistant wrote
              for you — and you want to send it to someone. Two things tend to go wrong, and both
              are avoidable once you know what is really happening.
            </p>
            <p className="max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The first is that you email the file as an attachment and it does not behave like a
              web page for the person who receives it. The second is quieter and more common: the
              page opens fine, they say &ldquo;thanks, will take a look,&rdquo; and you never learn
              whether they actually read it. This guide covers both, with the honest tradeoffs of
              each route.
            </p>
          </div>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              An HTML file has to be hosted before it becomes a link
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              A link that opens in a browser has to point at a page living on a web server — a
              computer on the internet that hands the page to whoever asks for it. An HTML file
              sitting on your laptop or attached to an email is not that yet. To turn it into a
              link, you put the file on a host, and the host gives you back a web address you can
              send.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              This is the part most instructions skip, and it is why an emailed .html attachment so
              often disappoints: depending on the recipient&rsquo;s mail app and device, it may
              download as a file, open as plain code, or be stripped out as unsafe, rather than
              opening as the page you saw. Hosting the file first is what makes it reliably open as
              a real web page for everyone you send it to. The only real question left is which kind
              of host you want.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Option one: make it visible with a plain host
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              If all you need is for anyone with the link to see the page, put it on a plain static
              host and send the public address. Netlify Drop, Cloudflare Pages, and GitHub Pages all
              serve a single HTML file at a public web address for free, and it opens in any browser
              with nothing to install on the reader&rsquo;s side. This is the right choice when the
              page is meant to be public.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The tradeoff is that a plain host is blind. It serves the page and records nothing you
              can see, so you cannot tell who opened it or whether they read past the first screen.
              Anyone who has the link has the page. For a public announcement that is exactly right.
              For a proposal, a pitch, or a brief that you are sending to specific people, it leaves
              you guessing.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              One practical note for either route: if your HTML pulls in images, fonts, or scripts
              from other websites, make sure those references are full web addresses rather than
              paths to files next to the original on your disk, or they will fail to load once the
              page is hosted.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Option two: share it and know it was read
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              When the reading matters as much as the sending, send a tracked link instead of a
              public address. A tracked link hosts the same page, but each recipient gets their own
              link, and you get back who opened it, which sections they read, and for how long. This
              is the honest difference from a plain host: the page is not just visible, you learn
              whether it landed.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              This is the part we built, so treat this section as us describing our own tool.{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                HTMLRadar
              </Link>{' '}
              takes your HTML file, hosts it behind a tracked link, and shows you the reading rather
              than a single view count. Each link can also ask for an email address before it opens,
              sit behind a password, or expire on a date you choose, and you can switch any link off
              afterwards. It is free for your first two links, then $15 a month, and it is open
              source under the AGPL-3.0 licence, so you can host the whole thing yourself instead.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              The reader sees an ordinary web page and nothing about the tracking. What you get is
              the sentence a plain host can never give you: not &ldquo;the link went out,&rdquo; but
              &ldquo;they read the pricing section twice and never reached the timeline.&rdquo;
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Sharing an HTML file that came from Claude
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              A Claude artifact and a file Claude Code writes are both HTML, so you share them the
              same way as any HTML file. Copy or download it as one self-contained HTML file first,
              then pick the route that fits: host it for a plain public link, or send a tracked link
              when you also want to know it was read.
            </p>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Two step-by-step pages cover the exact clicks. One is for{' '}
              <Link
                href="/tools/claude-artifact-to-link"
                className="text-signal-dark hover:underline"
              >
                sharing a Claude artifact as a link
              </Link>
              , and the other is for{' '}
              <Link href="/for/claude-artifacts" className="text-signal-dark hover:underline">
                seeing who opened a Claude artifact
              </Link>
              . If the file came out of Claude Code in your terminal, the{' '}
              <Link href="/for/claude-code" className="text-signal-dark hover:underline">
                Claude Code workflow
              </Link>{' '}
              publishes and checks the link without leaving the session.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Which option should you pick?
            </h2>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              Pick a plain host when the page is public and you do not care who reads it: it is
              free, fast, and there is nothing to learn from it anyway. Pick a tracked link when you
              are sending to particular people and their reading changes what you do next — a
              proposal you will follow up on, a deck in front of investors, a brief you need a
              client to have actually read. The file and the hosting are the same; the only thing
              you are choosing is whether the page stays anonymous or tells you it was read.
            </p>
            <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
              If the tracked route is the one you want, you can{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                turn an HTML file into a tracked link
              </Link>{' '}
              in a couple of steps, free for the first two.
            </p>
          </section>

          <Faq items={FAQ} />

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/tools/html-to-link" className="text-signal-dark hover:underline">
                turn an HTML file into a tracked link
              </Link>
              ,{' '}
              <Link
                href="/tools/claude-artifact-to-link"
                className="text-signal-dark hover:underline"
              >
                share a Claude artifact as a link
              </Link>
              , and{' '}
              <Link href="/compare/tiiny-host" className="text-signal-dark hover:underline">
                HTMLRadar compared with Tiiny.host
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
