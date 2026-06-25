import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { BreadcrumbLd, FaqLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Papermark Alternative for HTML Decks | HTMLRadar',
  description:
    'HTMLRadar vs Papermark: same open-source AGPL license, but built HTML-native for decks, briefs, and proposals instead of heavyweight data rooms.',
  path: '/compare/papermark',
});

const FAQ = [
  {
    q: 'How is HTMLRadar different from Papermark?',
    a: 'Both are open-source AGPL-3.0 document trackers. Papermark is PDF-first with data rooms; HTMLRadar is HTML-native with section-level dwell tracking for decks, briefs, and proposals.',
  },
  {
    q: 'Is HTMLRadar open source like Papermark?',
    a: 'Yes — same AGPL-3.0 license. The tracker, proxy worker, schema, and web app are all on GitHub and can be self-hosted.',
  },
  {
    q: 'Which is cheaper?',
    a: "HTMLRadar's paid tier is $15/mo flat. Papermark's entry paid tier is $29/mo. Both have free tiers, and both can be self-hosted for free.",
  },
];

export default function ComparePapermarkPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <BreadcrumbLd
          items={[
            { name: 'Home', url: '/' },
            { name: 'HTMLRadar vs Papermark', url: '/compare/papermark' },
          ]}
        />
        <FaqLd items={FAQ} />
        <p className="mb-2 font-mono text-xs uppercase tracking-widest text-graphite">
          HTMLRadar vs Papermark
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          We borrowed Papermark's playbook. Then aimed it at HTML.
        </h1>
        <p className="mt-4 text-ink-soft">
          Papermark is the open-source DocSend alternative for PDFs. They got to $900K ARR doing
          exactly what we're doing — open-source code, hosted SaaS, AGPL license. Honest answer: if
          you live in PDFs, use them.
        </p>
        <p className="mt-3 text-ink-soft">
          But if you live in HTML — investor decks rendered to a browser, AI-generated briefs,
          founder pitches that work better in a tab than as a download — PDF tools force you back
          into PDFs to track. HTMLRadar tracks what you already have.
        </p>

        <table className="mt-12 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-xs uppercase tracking-wider text-graphite">
              <th className="py-3"></th>
              <th className="py-3">HTMLRadar</th>
              <th className="py-3">Papermark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[
              ['Native format', 'HTML', 'PDF / PowerPoint'],
              ['Section-level dwell', 'Yes — heading-based, 3s threshold', 'Page-level only'],
              ['Per-recipient links', 'Yes', 'Yes'],
              ['Password + expiry per share', 'Yes', 'Yes (free)'],
              ['Version control (replace, keep links)', 'Yes', 'Yes'],
              ['Free hosted tier', '2 tracked links', '50 documents'],
              ['Watermark on user content', 'No — chrome only', 'No'],
              ['Custom domain', 'v1.1 paid', 'Business tier'],
              ['Open source', 'AGPL-3.0', 'AGPL-3.0'],
              ['Pricing (entry paid tier)', '$15/mo', '$29/mo'],
            ].map(([feat, hr, pm]) => (
              <tr key={feat} className="text-sm">
                <td className="py-3 pr-4 text-ink-soft">{feat}</td>
                <td className="py-3 font-medium">{hr}</td>
                <td className="py-3 text-ink-soft">{pm}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-6 text-sm leading-relaxed text-ink-soft">
          Those are the hosted free tiers, for trying each tool. HTMLRadar is AGPL-3.0 end to end —
          self-host it on your own Cloudflare and Supabase for{' '}
          <strong className="text-ink">unlimited tracked links at no cost</strong>. The whole
          product is open source, not open-core.
        </p>

        <div className="mt-12 rounded-lg border border-line bg-paper-2 p-6">
          <h2 className="text-base font-medium">When to use HTMLRadar</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li>
              · You write decks as HTML (AI-assisted, hand-coded, exported from Pitch/Tome/etc.)
            </li>
            <li>· You want section-level reading data, not just page-views</li>
            <li>· You care that the document stays clean (no watermark on your content)</li>
          </ul>
          <h2 className="mt-6 text-base font-medium">When to use Papermark</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li>· You live in PDFs already and don't plan to switch</li>
            <li>· You need data rooms or e-signature in one product</li>
            <li>· You want a mature, well-funded product with a larger team behind it</li>
          </ul>
        </div>

        <p className="mt-12 text-sm text-graphite">
          Both products are AGPL-3.0. Both are bootstrapped. We hope they both do well.
        </p>

        <div className="mt-12 rounded-lg border border-line bg-paper-2 p-6">
          <h2 className="text-base font-medium">Common questions</h2>
          <dl className="mt-3 space-y-4">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <dt className="text-sm font-medium">{q}</dt>
                <dd className="mt-1 text-sm text-ink-soft">{a}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-8 text-sm text-ink-soft">
          Related:{' '}
          <Link href="/self-hosted" className="text-signal-dark hover:underline">
            self-hosted document tracking
          </Link>{' '}
          and{' '}
          <Link href="/blog/how-we-built-htmlradar" className="text-signal-dark hover:underline">
            how we built HTMLRadar
          </Link>
          .
        </p>

        <Link href="/" className="mt-8 inline-block text-sm text-signal-dark hover:underline">
          ← Back home
        </Link>
      </main>
    </>
  );
}
