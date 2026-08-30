// /self-hosted — the "get-found" page for the self-host / privacy
// crowd. SEO target "self-hosted document tracking" + the private
// DocSend-alternative angle.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Self-Hosted DocSend Alternative, Open Source (AGPL) | HTMLRadar',
  description:
    'HTMLRadar is a self-hosted, open-source DocSend alternative for HTML documents. AGPL-3.0, runs in your own Cloudflare and Supabase accounts, your documents and read data stay in your own accounts.',
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
            The self-hosted, open-source DocSend alternative for HTML.
          </h1>
          <DirectAnswer updated="August 2026">
            HTMLRadar is a self-hosted, open-source DocSend alternative for HTML. The whole product
            is AGPL-3.0: run it in your own Cloudflare and Supabase accounts, keep documents and
            read data in your own storage, and see who read what. Or use the hosted version, free
            for two tracked links.
          </DirectAnswer>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            HTMLRadar is AGPL-3.0, end to end: the tracker, the proxy worker, the database schema,
            and the web app. Run the whole thing in your own Cloudflare and Supabase accounts. Your
            documents live in your R2 bucket, and your read data and recipient emails live in your
            Supabase project.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What do you need to run it?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              A Cloudflare account for Pages, Workers, and R2; a Supabase project for the database
              and authentication; and a domain. Resend is optional if you want first-read email
              notifications. The{' '}
              <a
                href="https://github.com/htmlradar/htmlradar/blob/main/docs/self-hosting.md"
                className="text-signal-dark hover:underline"
              >
                self-hosting guide
              </a>{' '}
              lists every required secret and deployment step.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Why self-host a document tracker?
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-[16px] leading-[1.7] text-ink-soft">
              <li>
                <strong className="text-ink">Compliance.</strong> Banks, healthcare, and M&amp;A
                teams that need deal documents in their own cloud accounts can run the stack they
                control.
              </li>
              <li>
                <strong className="text-ink">Data locality.</strong> Read analytics and recipient
                emails stay in your own Supabase project, while uploaded documents stay in your own
                R2 bucket.
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
              the same public code. Self-hosting means you configure and operate your own Cloudflare
              and Supabase deployment instead of using the hosted service. Coming from DocSend? See{' '}
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
                a: 'The software is free under AGPL-3.0. You pay Cloudflare, Supabase, your domain registrar, and any optional email provider directly. Their free tiers can cover light personal use, but review each provider’s current limits before relying on them.',
              },
              {
                q: 'What does the AGPL license require?',
                a: 'You can run, modify, and use HTMLRadar commercially. If you offer a modified version to others over a network, you must share those changes under the same license.',
              },
              {
                q: "What if I can't use AGPL (closed-source product, or company policy)?",
                a: 'A commercial license is available — it removes the AGPL copyleft obligations so you can embed HTMLRadar in a closed-source product or run a hosted service without publishing your changes. Email hello@htmlradar.com, and see COMMERCIAL-LICENSE.md in the repo.',
              },
              {
                q: 'What does setup involve?',
                a: 'Run the database migrations in Supabase, configure Cloudflare Pages, Workers, and R2, set the required secrets, and point your domain at the deployment. The self-hosting guide covers the exact sequence.',
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
              is free for your first 2 tracked links.
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
