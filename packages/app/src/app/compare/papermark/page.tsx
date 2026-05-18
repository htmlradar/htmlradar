import Link from 'next/link';
import { NavBar } from '@/components/NavBar';

export const runtime = 'edge';

export const metadata = {
  title: 'HTMLRadar vs Papermark',
  description:
    'A fair comparison of HTMLRadar and Papermark. HTML-first vs PDF-first, but the same open-source AGPL playbook and the same flat-pricing posture.',
};

export default function ComparePapermarkPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 py-16">
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
              ['Free-tier doc limit', '10 lifetime', '50 documents'],
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

        <Link href="/" className="mt-8 inline-block text-sm text-signal-dark hover:underline">
          ← Back home
        </Link>
      </main>
    </>
  );
}
