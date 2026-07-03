// /use-case/pitch-deck-tracking — lead-ICP use-case page (founders
// raising). SEO target "pitch deck tracking". H2s phrased as the
// questions a founder actually asks, per the metadata spec.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: 'Pitch Deck Tracking Software for Founders | HTMLRadar',
  description:
    'Know the moment an investor opens your deck, which slides they read, and when to follow up. Per-investor links and real-time read alerts. Free to start.',
  path: '/use-case/pitch-deck-tracking',
});

export default function PitchDeckTrackingPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Pitch deck tracking', url: '/use-case/pitch-deck-tracking' },
            ]}
          />
          <SectionMark>HTMLRadar · Use case</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            See exactly how investors read your pitch deck.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-soft">
            You sent the deck on Tuesday. It&apos;s Thursday. Did the partner open it? Skim it?
            Forward it? Most founders are guessing. HTMLRadar replaces the guessing with a live
            dashboard: who opened your deck, which slides they read, how long they stayed on the
            Ask.
          </p>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How do you know when an investor opens your deck?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              An email lands the moment a real read happens — not on every pixel-load. HTMLRadar
              uses a three-second dwell floor, so a scroll-past or an accidental click doesn&apos;t
              ping you. When you get the notification, someone is actually reading.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              Which slides did they actually read?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Open tracking tells you nothing about conviction. Section-level dwell does. HTMLRadar
              shows time per section: 2m 41s on the Ask, a re-read of Team, twelve seconds on
              Problem, Market sizing skipped entirely. That&apos;s a different follow-up than
              &ldquo;just checking in.&rdquo;
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
              Attachments ride under the same link — financial model, cap table, data-room files —
              and every download is logged to the recipient who pulled it.
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              One link per investor
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Each investor gets their own tracked link, so reads never blur together. Per share you
              can set an email gate, a password, an expiry date, a domain allow-list, and a download
              lock — and revoke any link with one toggle the moment the round closes or the
              conversation goes cold.
            </p>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
              Updated the deck? Replace the file and every link you already sent serves the new
              version. No re-sending, no &ldquo;v3-final-FINAL.pdf.&rdquo;
            </p>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              When should you follow up?
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              When the data says so. A partner who opened your deck three times and re-read Traction
              is warm — follow up the same day, and lead with traction. A partner who hasn&apos;t
              opened it in a week needs a different note entirely. The dashboard tells you which
              email to write.
            </p>
          </section>

          <Faq
            items={[
              {
                q: 'Do investors know the deck is tracked?',
                a: 'On the free tier the viewer shows a small "Powered by HTMLRadar" badge (Pro removes it). The tracker itself is open source, so anyone can audit exactly what is collected.',
              },
              {
                q: 'Does it work with AI-built decks?',
                a: 'Yes. Upload any HTML file — a Claude artifact, a ChatGPT one-pager, a reveal.js build — or point HTMLRadar at a URL you already host. If your deck is HTML, there is nothing to convert.',
              },
              {
                q: 'What does it cost for a fundraise?',
                a: 'The free tier covers 2 tracked links so you can try it. Pro is $15/mo flat for unlimited links — enough for a full fundraise.',
              },
              {
                q: 'Can I revoke access after the round closes?',
                a: 'Yes. One toggle kills a link instantly, and past read history stays in your dashboard. You can also set auto-expiry dates per share.',
              },
            ]}
          />

          <section className="mt-14">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Track your deck free
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
              <Link href="/use-case/track-html-deck" className="text-signal-dark hover:underline">
                track an HTML deck
              </Link>
              ,{' '}
              <Link href="/compare/docsend" className="text-signal-dark hover:underline">
                the open-source DocSend alternative
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
