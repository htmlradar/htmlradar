// /custom-domains — the dedicated page for a Pro account's own subdomain on
// its tracked links. Indexable and meant to rank for "custom domain for
// tracked links"; linked from pricing, /tools and the announcement e-mail.
//
// Gated by customDomainsPublished() — the same build-time flag that hides
// the feature from the pricing page and the Pro FAQ until the pilot's two
// drills pass (see docs/workstreams/content-domain/CUSTOM-DOMAINS-PRD-2026-09-16.md).
// notFound() rather than a redirect: there is nothing to send a visitor to
// instead, and the flag flips on with a rebuild, not a request.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NavBar } from '@/components/NavBar';
import { V2Footer } from '@/components/V2Footer';
import { BreadcrumbLd } from '@/components/JsonLd';
import { Faq } from '@/components/Faq';
import { SectionMark } from '@/components/SectionMark';
import { DirectAnswer } from '@/components/DirectAnswer';
import { pageMeta } from '@/lib/seo';
import { customDomainsPublished } from '@/lib/custom-domains';

export const dynamic = 'force-static';

export const metadata = pageMeta({
  title: 'Your tracked links on your own domain | HTMLRadar',
  description:
    'Serve tracked links from your own subdomain instead of htmlradar.page. One CNAME record, included in Pro, tracking and reports unchanged.',
  path: '/custom-domains',
});

const HERO_ALT =
  'Three panels. One: the Settings box holding decks.acme.com with the status Waiting for DNS and the single record to add, decks CNAME customers.htmlradar.page. Two: the same box with the status Live and the line, new links use this domain. Three: a phone opening a tracked link at decks.acme.com/r/, with a read report under it for jane@northwind.com, 6m 26s read, 87 per cent scrolled.';

const FAQ = [
  {
    q: 'Can I use a bare domain, like acme.com?',
    a: "Not yet. Cloudflare needs a CNAME record to issue the certificate, and a CNAME at the apex of a domain breaks that domain's own mail and website. Use a subdomain instead — decks.acme.com rather than acme.com.",
  },
  {
    q: 'What happens to my links if I disconnect my domain?',
    a: "Every link already issued on that domain stops opening, and there's no way to move it to another address — anyone holding one needs a new link from you. Links on the HTMLRadar address are unaffected.",
  },
  {
    q: 'Does it cost extra?',
    a: "No. It's included in Pro at $15 a month or $150 a year, with no separate charge for connecting a domain.",
  },
  {
    q: 'My domain is on Cloudflare already — does it still work?',
    a: "Yes. We confirm a domain points at us by requesting it over HTTPS ourselves, not by checking DNS, so it works whether your domain's DNS is managed on Cloudflare or anywhere else.",
  },
];

export default function CustomDomainsPage() {
  if (!customDomainsPublished()) notFound();

  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-3xl px-6 pb-20 pt-28 md:pb-28 md:pt-32">
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Custom domains', url: '/custom-domains' },
            ]}
          />
          <SectionMark>HTMLRadar · Pro</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[56px]">
            Your tracked links, on your own domain.
          </h1>
          <DirectAnswer updated="September 2026">
            Pro accounts can serve tracked links from their own subdomain —
            decks.acme.com/r/deal-name — instead of htmlradar.page. Add one CNAME record in Settings
            and it turns Live on its own, usually within minutes. Tracking, gates and read reports
            work exactly as before, and links you have already sent keep working where they are.
            Included in Pro, no extra charge.
          </DirectAnswer>

          <figure className="mt-10">
            <img
              src="/brand/email/custom-domains-announcement.png"
              srcSet="/brand/email/custom-domains-announcement.png 1x, /brand/email/custom-domains-announcement@2x.png 2x"
              width={1200}
              height={675}
              alt={HERO_ALT}
              className="w-full max-w-full rounded-xl border border-line"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </figure>

          <section className="mt-14">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              How it works, in three steps
            </h2>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-[16px] leading-relaxed text-ink-soft">
              <li>
                In Settings, under &ldquo;Your domain&rdquo;, type the subdomain you want to use —
                decks.acme.com, for example.
              </li>
              <li>
                Add the one CNAME record we show you, wherever you manage that domain&rsquo;s DNS —
                Cloudflare, GoDaddy, Namecheap, or anywhere else.
              </li>
              <li>
                Wait a few minutes. It turns Live on its own, and from then on every new link you
                create goes out on it.
              </li>
            </ol>
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[28px] leading-snug text-ink md:text-[32px]">
              What stays the same
            </h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
              Tracking, email gates, passwords, expiry dates and the read reports are exactly what
              they are today — connecting a domain does not change how a link behaves, only where a
              new one is served from. And it only affects new links: everything you have already
              sent keeps opening at the address it was issued on, htmlradar.page included.
            </p>
          </section>

          <Faq items={FAQ} />

          <div className="mt-14">
            <Link
              href="/settings"
              data-cta="custom_domains.connect"
              className="group inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
            >
              Connect your domain
            </Link>
          </div>

          <div className="mt-16 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Related:{' '}
              <Link href="/pricing" className="text-signal-dark hover:underline">
                pricing
              </Link>{' '}
              and{' '}
              <Link
                href="/blog/whats-new-custom-domains"
                className="text-signal-dark hover:underline"
              >
                the announcement
              </Link>
              .
            </p>
          </div>
        </article>
      </main>
      <V2Footer />
    </>
  );
}
