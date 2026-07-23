import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Papermark Alternative for HTML Decks | HTMLRadar',
  description:
    'HTMLRadar is a Papermark alternative for HTML decks, briefs, and proposals. Track the HTML you already send with section-level dwell data.',
  path: '/compare/papermark',
});

const FAQ = [
  {
    q: 'How is HTMLRadar different from Papermark?',
    a: 'HTMLRadar is deliberately narrow: it tracks HTML files and public URLs with section-level dwell data. Papermark is a broader document-sharing and data-room product. Choose the product that matches the format and workflow you already use.',
  },
  {
    q: 'Is HTMLRadar open source?',
    a: 'Yes. HTMLRadar is AGPL-3.0 end to end: the tracker, proxy worker, schema, and web app are on GitHub. You can run it in your own Cloudflare and Supabase accounts.',
  },
  {
    q: 'Which should I choose?',
    a: 'Choose HTMLRadar when you already send HTML decks, briefs, or proposals and want to know which sections people read. Choose Papermark when you need broader document sharing or data rooms.',
  },
];

export default function ComparePapermarkPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'HTMLRadar vs Papermark', url: '/compare/papermark' },
            ]}
          />
          <SectionMark>HTMLRadar · Compare</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            The Papermark alternative for HTML decks.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            Papermark is a broader document-sharing and data-room product. HTMLRadar is narrower:
            upload an HTML file or paste a URL, send a tracked link, and see which sections the
            recipient actually read.
          </p>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            If the document you send is already a web page, do not convert it just to track it.
            HTMLRadar keeps the original format and tracks the headings and slides inside it.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Choose by workflow
            </h2>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-paper">
              <table className="w-full text-[14px]">
                <thead className="bg-paper-2/40 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
                  <tr>
                    <th className="px-5 py-3">Workflow</th>
                    <th className="px-5 py-3">HTMLRadar</th>
                    <th className="px-5 py-3">Papermark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    [
                      'What you send',
                      'HTML files or public URLs',
                      'Broader document sharing and data rooms',
                    ],
                    [
                      'Reading detail',
                      'Heading and slide dwell',
                      'Product-specific document analytics',
                    ],
                    [
                      'Self-hosting',
                      'AGPL source in your own Cloudflare and Supabase accounts',
                      "See Papermark's current self-hosting terms",
                    ],
                    [
                      'Best fit',
                      'Web decks, briefs, and proposals',
                      'Multi-document sharing and data rooms',
                    ],
                  ].map(([feature, htmlradar, papermark]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3.5 align-top text-ink">{feature}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{htmlradar}</td>
                      <td className="px-5 py-3.5 align-top text-ink-soft">{papermark}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When to use each product
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-paper p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                  Use HTMLRadar
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You already send HTML. You want to keep it as HTML, create per-recipient links,
                  and see which headings or slides held attention.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-paper-2/40 p-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
                  Use Papermark
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  You need a broader document-sharing product, especially for multi-document data
                  rooms.
                </p>
              </div>
            </div>
          </section>

          <Faq items={FAQ} />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track an HTML deck free
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
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                HTMLRadar vs DocSend
              </Link>
              ,{' '}
              <Link
                href="/compare/docsend-vs-papermark"
                className="text-signal-dark hover:underline"
              >
                DocSend vs Papermark compared
              </Link>
              ,{' '}
              <Link href="/self-hosted" className="text-signal-dark hover:underline">
                self-hosted document tracking
              </Link>
              , and{' '}
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track an HTML deck
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
