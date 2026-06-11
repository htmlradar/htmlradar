// /self-hosted — the "get-found" page for the self-host / privacy
// crowd. SEO target "self-hosted document tracking" + the private
// DocSend-alternative angle.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Self-Hosted, Open-Source Document Tracking | HTMLRadar',
  description:
    'Run your own read-tracking on your own infrastructure. AGPL-3.0, self-hostable, no data leaves your servers. The private DocSend alternative.',
  path: '/self-hosted',
});

export default function SelfHostedPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Self-hosted', url: '/self-hosted' },
            ]}
          />
          <SectionMark>HTMLRadar · Self-host</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Self-hosted document tracking you fully control.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar is AGPL-3.0, end to end: the tracker, the proxy worker, the database schema,
            the web app. Run the whole thing on your own infrastructure — your documents, your read
            data, and your recipients&apos; emails never touch anyone else&apos;s servers.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What do you need to run it?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A Cloudflare account (Pages, Workers, R2) and a Supabase project. Both have free tiers
              that cover personal use, so a solo self-host can genuinely cost nothing. The repo
              includes a 15-minute self-hosting guide: clone, connect the two accounts, deploy.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why self-host a document tracker?
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                <strong className="text-ink">Compliance.</strong> Banks, healthcare, and M&amp;A
                teams that can&apos;t put deal documents in a third-party SaaS run the same stack on
                infrastructure they control.
              </li>
              <li>
                <strong className="text-ink">Data locality.</strong> Read analytics and recipient
                emails stay in your own database. Nothing to export, nothing to trust.
              </li>
              <li>
                <strong className="text-ink">Auditability.</strong> The tracker code is open — you
                and your recipients can read exactly what is collected. Closed-source trackers
                can&apos;t offer that.
              </li>
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How is it different from the hosted version?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              It isn&apos;t — that&apos;s the guarantee. The hosted product at htmlradar.com runs
              the same public code. Self-hosting trades the $15/mo Pro plan for running your own
              Cloudflare and Supabase, with no document caps. If you ever outgrow one, you can move
              to the other; the stack is identical. Coming from DocSend? See{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                how HTMLRadar compares as an open-source DocSend alternative
              </Link>
              .
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Is self-hosting really free?',
                a: 'The software is free under AGPL-3.0, forever. You pay your infrastructure providers directly — and the Cloudflare and Supabase free tiers cover personal use.',
              },
              {
                q: 'What does the AGPL license require?',
                a: 'You can run, modify, and use HTMLRadar commercially. If you offer a modified version to others over a network, you must share those changes under the same license.',
              },
              {
                q: 'How long does setup take?',
                a: 'About 15 minutes with the guide in the repo: clone the source, connect Cloudflare and Supabase, deploy.',
              },
            ]}
          />

          <section className="mt-14">
            <a
              href="https://github.com/htmlradar/htmlradar"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Get the source on GitHub
            </a>
            <p className="mt-3 text-[13px] text-graphite">
              Or skip the setup —{' '}
              <Link
                href="/sign-in"
                className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
              >
                the hosted version
              </Link>{' '}
              is free for your first 10 documents.
            </p>
          </section>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                the open-source DocSend alternative
              </Link>
              ,{' '}
              <Link href="/pricing" className="text-signal-dark hover:underline">
                hosted pricing
              </Link>
              , and{' '}
              <Link
                href="/blog/how-we-built-htmlradar"
                className="text-signal-dark hover:underline"
              >
                how we built HTMLRadar
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
