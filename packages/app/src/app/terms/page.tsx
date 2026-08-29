// /terms — the terms of service for the hosted product. Mirrors /privacy in
// structure and voice. Linked from the footer and reachable without sign-in.
// Required by Google for OAuth app publishing, but written because a business
// taking subscriptions should have one.

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { Reveal } from '@/components/Reveal';
import { SectionMark } from '@/components/SectionMark';
import { pageMeta } from '@/lib/seo';

export const dynamic = 'force-static';

export const metadata = pageMeta({
  title: 'Terms',
  description:
    'The terms that apply to the hosted version of HTMLRadar at htmlradar.com — subscriptions, cancelling, your documents, and what happens if the service ends.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <Reveal reveal={false}>
            <SectionMark>HTMLRadar · Hosted service</SectionMark>
          </Reveal>

          <Reveal reveal={false} delay={0.05}>
            <h1 className="text-letterpress mt-8 font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[60px]">
              Terms.
            </h1>
          </Reveal>

          <Reveal reveal={false} delay={0.1}>
            <p className="mt-6 text-[15px] text-graphite">
              The agreement between you and HTMLRadar for the hosted service at htmlradar.com. Plain
              language, because you should be able to read it. If you self-host, these terms do not
              apply — the AGPL-3.0 licence does.
            </p>
          </Reveal>

          <div className="mt-14 space-y-10 text-[16px] leading-[1.7] text-ink-soft">
            <Section title="What this is">
              <p>
                HTMLRadar lets you upload an HTML document, share it as a tracked link, and see who
                opened it and how long they read. This page covers the hosted service. By creating
                an account you agree to what follows.
              </p>
              <p className="mt-4">
                HTMLRadar is operated from India. These terms are governed by Indian law.
              </p>
            </Section>

            <Section title="Your account">
              <p>
                You need an account to create tracked links. Keep your sign-in secure — anyone with
                access to it can see your documents and your analytics. Tell us at{' '}
                <a
                  href="mailto:hello@htmlradar.com"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  hello@htmlradar.com
                </a>{' '}
                if you think someone else has it.
              </p>
              <p className="mt-4">
                You must be old enough to enter a contract where you live, and you are responsible
                for what happens under your account.
              </p>
            </Section>

            <Section title="Paying for it">
              <p>
                The free tier gives you two tracked links, for as long as you want them. Pro is{' '}
                <strong className="text-ink">$15 per month, or $150 per year</strong> if you pay
                annually. Either way it is billed through Polar, our merchant of record, who handles
                the payment and any tax that applies where you are.
              </p>
              <p className="mt-4">
                Subscriptions renew automatically — every month on the monthly plan, every year on
                the annual one — until you cancel. You can cancel at any time from your settings,
                and you keep Pro access until the end of the period you have already paid for. We do
                not charge you again after you cancel.
              </p>
              <p className="mt-4">
                If we ever change the price, existing subscribers keep their current price for as
                long as their subscription stays active. If that ever has to change, we will tell
                you by email at least 30 days beforehand.
              </p>
            </Section>

            <Section title="Cancelling">
              <p>
                You can cancel at any time. Your plan stays active until the end of the period you
                have already paid for, and we do not charge you again after that.
              </p>
              <p className="mt-4">Payments already made are not refundable when you cancel.</p>
            </Section>

            <Section title="Your documents stay yours">
              <p>
                You keep every right you have in what you upload. We claim no ownership of your
                documents and we do not use them to train anything.
              </p>
              <p className="mt-4">
                You give us only the permission we need to run the service: to store your file, to
                serve it to the people you share it with, and to inject the tracking script that
                makes the analytics work. Nothing beyond that.
              </p>
              <p className="mt-4">
                You can delete a document or revoke a link at any time. When you do, we stop serving
                it.
              </p>
            </Section>

            <Section title="The people you send links to">
              <p>
                When you share a tracked link, you decide who receives it and what data the gate
                collects. That makes you responsible for having the right to send it and for telling
                your recipients what you are doing, where the law where you operate requires it.
              </p>
              <p className="mt-4">
                What we collect from recipients, and what we do not, is set out in full on our{' '}
                <Link
                  href="/privacy"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  privacy page
                </Link>
                .
              </p>
            </Section>

            <Section title="What you may not do">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Send anything unlawful, or anything you do not have the right to share.</li>
                <li>
                  Use tracked links for phishing, malware, or to impersonate someone else. This is
                  the one we will act on fastest.
                </li>
                <li>Send bulk unsolicited email using HTMLRadar links.</li>
                <li>
                  Try to break, overload, or work around the limits of the service — including the
                  free-tier link cap.
                </li>
                <li>
                  Resell the hosted service as your own. Self-hosting is what the licence is for.
                </li>
              </ul>
              <p className="mt-4">
                If you do any of these we may suspend or close your account. Where it is not urgent,
                we will tell you first and give you a chance to fix it.
              </p>
            </Section>

            <Section title="Availability">
              <p>
                We run HTMLRadar carefully and monitor it continuously, but we do not promise a
                specific uptime figure. Things break, and providers we depend on break. We do not
                offer a service level agreement on any plan today.
              </p>
              <p className="mt-4">
                If we ever have a serious outage that affects your paid month, tell us and we will
                credit it against your next one.
              </p>
            </Section>

            <Section title="Limits on liability">
              <p>
                HTMLRadar is provided as it is. To the extent the law allows, we are not liable for
                indirect or consequential losses — lost business, lost profits, or a deal that did
                not close.
              </p>
              <p className="mt-4">
                Our total liability to you for any claim is limited to what you paid us in the
                twelve months before it arose. Nothing here limits liability that cannot be limited
                by law.
              </p>
            </Section>

            <Section title="Ending it">
              <p>
                You can close your account whenever you like. Your documents and links stop working
                and we delete your data.
              </p>
              <p className="mt-4">
                If we ever have to discontinue the hosted service, we will give you{' '}
                <strong className="text-ink">at least 60 days notice by email</strong>, refund any
                unused paid time, and keep the export working throughout so you can take your data
                with you. HTMLRadar is open source, so you can also self-host and keep running.
              </p>
            </Section>

            <Section title="Self-hosting">
              <p>
                The source is on{' '}
                <a
                  href="https://github.com/htmlradar/htmlradar"
                  target="_blank"
                  rel="noopener"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  GitHub
                </a>{' '}
                under AGPL-3.0. If you run your own instance, these terms do not apply to it — the
                licence does, and the data is yours to manage.
              </p>
            </Section>

            <Section title="Changes">
              <p>
                We may update these terms. If a change materially affects you, we will email you at
                least 30 days before it takes effect. Continuing to use HTMLRadar after that means
                you accept the new version.
              </p>
              <p className="mt-4 text-[15px] text-graphite">Last updated 29 August 2026.</p>
            </Section>

            <Section title="Contact">
              <p>
                Questions about any of this go to{' '}
                <a
                  href="mailto:hello@htmlradar.com"
                  className="text-signal-dark underline decoration-line decoration-2 underline-offset-4 hover:decoration-signal"
                >
                  hello@htmlradar.com
                </a>
                . A real person reads it.
              </p>
            </Section>
          </div>
        </article>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
            <div className="font-mono text-[12px] tracking-wide text-graphite">
              HTML<span className="text-signal">Radar</span>. Document tracking for HTML.
            </div>
            <nav className="flex flex-wrap items-center gap-x-7 gap-y-3 font-mono text-[12px] text-graphite">
              <Link href="/why" className="link-slide hover:text-signal-dark">
                Why this exists
              </Link>
              <Link href="/blog" className="link-slide hover:text-signal-dark">
                Blog
              </Link>
              <a
                href="https://github.com/htmlradar/htmlradar"
                className="link-slide hover:text-signal-dark"
                target="_blank"
                rel="noopener"
              >
                GitHub
              </a>
              <Link href="/pricing" className="link-slide hover:text-signal-dark">
                Pricing
              </Link>
              <Link href="/privacy" className="link-slide hover:text-signal-dark">
                Privacy
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-[24px] leading-snug text-ink md:text-[26px]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
