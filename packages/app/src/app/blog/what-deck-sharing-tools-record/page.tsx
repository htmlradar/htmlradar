// Blog post #3 — the recipient-side test, 4 Sep 2026. Body is word-for-word the
// research draft at docs/workstreams/outreach/DRAFT-what-deck-sharing-tools-record-2026-08-30.md
// (everything above the internal vendor-notes record, which is not published).

import Link from 'next/link';
import { NavBar } from '@/components/NavBar';
import { SectionMark } from '@/components/SectionMark';
import { ArticleLd, BreadcrumbLd } from '@/components/JsonLd';
import { pageMeta } from '@/lib/seo';

export const runtime = 'edge';

export const metadata = pageMeta({
  title: "What seven deck-sharing tools actually load in your recipient's browser",
  description:
    'A recipient-side test of seven deck-sharing tools: every network request, cookie and script that loads when someone opens a shared link. DocSend, Papermark, Peony, Stacktree, Tiiny.host, HummingDeck and HTMLRadar.',
  path: '/blog/what-deck-sharing-tools-record',
});

export default function Post() {
  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <ArticleLd
            headline="What seven deck-sharing tools actually load in your recipient's browser"
            datePublished="2026-09-04"
            url="/blog/what-deck-sharing-tools-record"
          />
          <BreadcrumbLd
            items={[
              { name: 'Home', url: '/' },
              { name: 'Blog', url: '/blog' },
              {
                name: "What seven deck-sharing tools actually load in your recipient's browser",
                url: '/blog/what-deck-sharing-tools-record',
              },
            ]}
          />
          <SectionMark>HTMLRadar · Research</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[40px] font-normal leading-[1.06] tracking-tightest text-ink md:text-[52px]">
            What seven deck-sharing tools actually load in your recipient&apos;s browser
          </h1>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
            2026-09-04 &nbsp;·&nbsp; 16 min read &nbsp;·&nbsp; Research
          </p>

          <div className="mt-12 space-y-10 break-words text-[16.5px] leading-[1.7] text-ink-soft">
            <p className="italic">
              Disclosure: HTMLRadar is our own product, and it is the seventh of the seven tested
              here. Every comparison in this piece is one we have an interest in, and it is marked
              as ours in each place where the comparison is made.
            </p>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Why we looked
              </h2>
              <p className="mt-4">
                We sell read tracking. Our tracker sends section titles and per-section seconds to
                our own servers, and the payload it sends is listed later in this piece. The person
                who opens a shared link did not sign up for anything, so what runs in their browser
                is worth writing down. I looked for a published answer to that and did not find one,
                so on 30 August 2026 I opened one public link from each of six other products and
                recorded the network requests, cookies, storage, scripts and frames listed below.
              </p>
              <p className="mt-4">
                We ran the same test on our own share link, and this piece publishes what came back,
                including the two findings we are acting on.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                How each link was captured
              </h2>
              <p className="mt-4">
                Common to every capture: one public, ungated share link per product. Playwright
                Chromium, viewport 1512x982. Load, wait ten seconds, capture, scroll to the bottom,
                wait five more seconds, capture - a fifteen-second window. Nothing was typed,
                clicked or submitted: no e-mail, no consent button, no page-advance control. All
                timestamps are UTC.
              </p>
              <p className="mt-4">
                What each capture recorded: every network request and its host,{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">localStorage</code> keys,
                every script <code className="font-mono text-[14px] text-signal-dark">src</code> in
                the DOM, and the page&apos;s visible text.{' '}
                <code className="font-mono text-[14px] text-signal-dark">sessionStorage</code> was
                checked on five of the seven links - DocSend, Papermark, Peony, HummingDeck and
                HTMLRadar - and the Stacktree and Tiiny.host files do not record it. Iframes were
                counted on those same five. For Stacktree and Tiiny.host the capture transcribes the
                top and the bottom of the page rather than the whole text.
              </p>
              <p className="mt-4">
                One thing to carry through the whole piece:{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>{' '}
                cannot see HttpOnly cookies, and it reads only the top-level origin. Every cookie
                count here is therefore a lower bound, and is written as &quot;visible to{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>
                &quot; rather than &quot;set&quot;.
              </p>
              <p className="mt-4">How each one was captured, from its own evidence file:</p>
              <ul className="mt-4 ml-5 list-disc space-y-4 marker:text-signal-dark">
                <li>
                  <strong className="font-semibold text-ink">DocSend</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://docsend.com/view/58em2uebezhisqvy
                  </code>{' '}
                  (published on nextgencodingcompany.com), 2026-08-30T06:59:08Z. A browser launched
                  fresh for this subject, a brand-new context with no profile and no cookies carried
                  in, a normal desktop Chrome user-agent string. Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Papermark</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://www.papermark.com/view/cmkz9p9de0014js04sf4ex5u8
                  </code>{' '}
                  (publicly posted by its sender), 2026-08-30T06:56:48Z. A browser launched fresh
                  for this subject, a brand-new context with no profile and no cookies carried in, a
                  normal desktop Chrome user-agent string. Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Peony</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://app.peony.ink/view/daa6031a-a4d2-42bd-a85b-e3f1dc345b82
                  </code>
                  , 2026-08-30T06:41:27Z. A new tab in the running browser. The evidence file
                  records no separate context and no user-agent override. Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Stacktree</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://example-brand-audit.stacktr.ee/
                  </code>{' '}
                  (vendor&apos;s own live example), 2026-08-30T06:34:21Z. The evidence file records
                  the browser and viewport only: no separate context, no user-agent override.
                  Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Tiiny.host</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://ai-agents-guide.tiiny.site/
                  </code>{' '}
                  (a real user-published site), 2026-08-30T06:35:31Z. The evidence file records the
                  browser and viewport only: no separate context, no user-agent override.
                  Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">HummingDeck</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://hummingdeck.com/r/mt3uu5qwv7kpxb3g
                  </code>{' '}
                  (vendor&apos;s own demo room), 2026-08-30T06:36:41Z. The evidence file records the
                  browser and viewport only: no separate context, no user-agent override.
                  Fifteen-second window.
                </li>
                <li>
                  <strong className="font-semibold text-ink">HTMLRadar</strong> -{' '}
                  <code className="font-mono text-[14px] text-signal-dark">
                    https://htmlradar.com/r/lumenforge-demo
                  </code>{' '}
                  (our public demo), 2026-08-30T07:11:08Z. A browser launched fresh for this
                  subject, a brand-new context with no profile and no cookies carried in, a normal
                  desktop Chrome user-agent string, driven by a standalone script rather than the
                  shared browser. Two runs: the fifteen-second window used for comparison with the
                  six above, and a separate 55-second run from 07:12:27Z to 07:13:23Z made only to
                  observe the heartbeat, which falls outside the comparison window. Every heartbeat
                  line in this piece is labelled as coming from that longer run.
                </li>
              </ul>
              <p className="mt-4">
                One disclosure about our own link.{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  htmlradar.com/r/lumenforge-demo
                </code>{' '}
                had been revoked on 23 July 2026, and we un-revoked it ourselves immediately before
                measuring, with one database update that set{' '}
                <code className="font-mono text-[14px] text-signal-dark">revoked_at</code> to null
                and changed nothing else. It is the only link in this set that we control. The other
                six were opened the way any recipient opens one.
              </p>
              <p className="mt-4">The limits, stated plainly because they are real:</p>
              <ol className="mt-4 ml-5 list-decimal space-y-4 marker:text-signal-dark">
                <li>
                  <strong className="font-semibold text-ink">One link each.</strong> On DocSend and
                  on Papermark we opened gated links before finding an ungated one, and both
                  attempts are recorded in the evidence files, so gated and ungated links of the
                  same product plainly differ. A demo link and a customer&apos;s configured link can
                  differ too. Nothing here describes any other link.
                </li>
                <li>
                  <strong className="font-semibold text-ink">
                    We record what loaded, not why.
                  </strong>{' '}
                  No claim about who chose a given script, what any vendor intends, or what a
                  product does on any other page.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Vendors change things.</strong> This is
                  one fifteen-second window per product, on one day.
                </li>
                <li>
                  <strong className="font-semibold text-ink">
                    Cookie counts are a lower bound.
                  </strong>{' '}
                  <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>{' '}
                  cannot see HttpOnly cookies, and it reads only the top-level origin, so cookies
                  set inside a cross-origin iframe are not counted.
                </li>
              </ol>
              <p className="mt-4">
                <strong className="font-semibold text-ink">How vendors were notified.</strong> Each
                of the six vendors tested here - DocSend, Papermark, Peony, Stacktree, Tiiny.host
                and HummingDeck - was sent one note on 30 August 2026, naming the specific finding
                recorded on their product and 4 September 2026 as the date this piece would publish.
                Where a reply came back, it is reproduced below exactly as sent, under that
                vendor&apos;s own section. A vendor that had not replied by publication is marked as
                such in the same place.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                The table
              </h2>
              <div className="mt-4">
                <ResultsTable />
              </div>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Checked on 30 August 2026.</strong> Every
                cell in this table comes from a recorded network log, a{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code> read
                or a DOM capture inside the fifteen-second window described above. Two facts
                elsewhere in this piece come from outside that window, and both are labelled where
                they appear: HTMLRadar&apos;s heartbeat calls, which come from the separate
                55-second run, and the Cloudflare zone setting on{' '}
                <code className="font-mono text-[14px] text-signal-dark">htmlradar.com</code>, which
                we read from our own Cloudflare account. &quot;None observed&quot; means exactly
                that - not observed on this link, in this window, by this method.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Re-checked on 31 August 2026.</strong>{' '}
                Vendors change things, so all seven links were opened again on 31 August 2026 with
                the same script, the same viewport and the same fifteen-second window. The findings
                summarized in the table held. DocSend made the same advertising requests and wrote{' '}
                <code className="font-mono text-[14px] text-signal-dark">__Secure-dbx_consent</code>{' '}
                with all five categories{' '}
                <code className="font-mono text-[14px] text-signal-dark">true</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  &quot;userInteracted&quot;:false
                </code>{' '}
                while the banner sat untouched. Peony attempted a Mixpanel Session Replay upload
                through{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  app.peony.ink/mp/record
                </code>
                , answered <code className="font-mono text-[14px] text-signal-dark">402</code>.
                Papermark showed one non-first-party host and one visible cookie. Stacktree returned
                an empty{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code> and
                one{' '}
                <code className="font-mono text-[14px] text-signal-dark">cloudflareinsights</code>{' '}
                request blocked by its own policy. Tiiny.host returned an empty cookie and empty
                storage, with Plausible served from{' '}
                <code className="font-mono text-[14px] text-signal-dark">analytics.tiiny.site</code>
                . HummingDeck loaded the same Calendly frame, the same 24 non-first-party hosts and
                the same{' '}
                <code className="font-mono text-[14px] text-signal-dark">img.logo.dev</code>{' '}
                request. Four differences, all small: Peony attempted one replay upload instead of
                two, Tiiny.host&apos;s Plausible script loaded but sent no{' '}
                <code className="font-mono text-[14px] text-signal-dark">/api/event</code> POST
                inside the window, per-page request totals moved by a handful either way as image
                loads vary run to run, and HTMLRadar&apos;s own row changed for reasons given in its
                own section below. The counts in the table are the ones recorded on 30 August, which
                is the date the table carries.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  Checked again ahead of publication.
                </strong>{' '}
                A further check on 2 September 2026 found Peony&apos;s Mixpanel Session Replay
                upload answered <code className="font-mono text-[14px] text-signal-dark">200</code>,
                not the <code className="font-mono text-[14px] text-signal-dark">402</code> recorded
                on 30 and 31 August: the upload that had been stalling behind a payment gate went
                through this time. Everything else held. This piece re-runs the same check once more
                immediately before publishing, so this line is updated again if that changes.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Product by product
              </h2>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">DocSend</h3>
              <p className="mt-4">
                174 requests, the busiest page in the set. Alongside DocSend&apos;s own view
                tracking (
                <code className="font-mono text-[14px] text-signal-dark">
                  POST /presentation_analytics/record_page_view
                </code>
                , twice for a two-page deck, no e-mail entered and none requested), the browser made
                requests to three Google properties, each carrying the recipient&apos;s URL:
              </p>
              <div className="mt-6">
                <CodeBlock file="docsend · network log" code={DOCSEND_LOG} />
              </div>
              <p className="mt-4">
                Advertising-related hosts appeared on two of the seven links. On DocSend they were{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  googleads.g.doubleclick.net
                </code>
                ,{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  stats.g.doubleclick.net
                </code>
                , and{' '}
                <code className="font-mono text-[14px] text-signal-dark">pagead/1p-user-list</code>{' '}
                requests for Google Ads conversion id 982651595 on both{' '}
                <code className="font-mono text-[14px] text-signal-dark">www.google.com</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">www.google.co.in</code>. On
                HummingDeck it was{' '}
                <code className="font-mono text-[14px] text-signal-dark">connect.facebook.net</code>
                , serving{' '}
                <code className="font-mono text-[14px] text-signal-dark">fbevents.js</code>, which
                appeared after the{' '}
                <code className="font-mono text-[14px] text-signal-dark">calendly.com</code> frame
                loaded. On the other five links, none appeared.
              </p>
              <p className="mt-4">
                The cookie banner does offer &quot;Decline&quot; and &quot;Customize cookies&quot;.
                Nothing was clicked. The consent cookie written during that same load, verbatim:
              </p>
              <div className="mt-6">
                <CodeBlock file="docsend · __Secure-dbx_consent" code={DOCSEND_CONSENT} />
              </div>
              <p className="mt-4">
                Every category recorded as{' '}
                <code className="font-mono text-[14px] text-signal-dark">true</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">userInteracted</code>{' '}
                recorded as <code className="font-mono text-[14px] text-signal-dark">false</code>,
                and the advertising requests above already sent, while the banner was still on
                screen and untouched.
              </p>
              <p className="mt-4 italic">
                DocSend&apos;s owner, Dropbox, acknowledged the note through its privacy support
                desk on 30 August. No substantive response had arrived by 4 September 2026, the day
                this piece went up on the HTMLRadar blog.
              </p>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">Papermark</h3>
              <p className="mt-4">
                One non-first-party host across 70 requests, serving the document&apos;s own page
                images from CloudFront on signed URLs. That is the smallest recorded count among the
                products here that ship analytics. PostHog is present, loaded through a first-party
                proxy path on{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  app.papermark.com/ingest
                </code>
                ; no request went to a{' '}
                <code className="font-mono text-[14px] text-signal-dark">posthog.com</code> host.
                One cookie visible to page scripts, the PostHog one. Papermark&apos;s own view
                tracking fired:{' '}
                <code className="font-mono text-[14px] text-signal-dark">POST /api/views</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  POST /api/record_view
                </code>{' '}
                on load, and four{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  POST /api/views/pages
                </code>{' '}
                after the scroll moved the counter from 1 to 10.
              </p>
              <p className="mt-4 italic">
                No response by 4 September 2026, the day this piece went up on the HTMLRadar blog.
              </p>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">Peony</h3>
              <p className="mt-4">
                Two Mixpanel Session Replay uploads were attempted, both through the first-party
                proxy path{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  app.peony.ink/mp/record
                </code>
                . The query strings carry the numbers:
              </p>
              <div className="mt-6">
                <CodeBlock file="peony · mixpanel session replay" code={PEONY_REPLAY} />
              </div>
              <p className="mt-4">
                <code className="font-mono text-[14px] text-signal-dark">
                  replay_start_time=1788072088.388
                </code>{' '}
                is 2026-08-30T06:41:28Z, one second after load.{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  replay_length_ms=5020
                </code>{' '}
                is a 5.02-second segment, so the upload went out around 06:41:33Z, about five
                seconds before the ten-second wait finished and well before the scroll. A second
                upload followed with{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  replay_length_ms=2092
                </code>
                . Both were answered{' '}
                <code className="font-mono text-[14px] text-signal-dark">402 Payment Required</code>{' '}
                and did not complete.
              </p>
              <p className="mt-4">
                Also observed: Hotjar (
                <code className="font-mono text-[14px] text-signal-dark">
                  static.hotjar.com/c/hotjar-5115897.js
                </code>
                ), Sentry, Crisp live chat, thirteen{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  POST /api/track_page_view_time
                </code>{' '}
                calls, and one{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  POST /api/viewer/authenticate
                </code>{' '}
                issued without any e-mail being entered. The Mixpanel cookie carries{' '}
                <code className="font-mono text-[14px] text-signal-dark">distinct_id</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">$device_id</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">$user_id</code>.
              </p>
              <p className="mt-4 italic">
                No response by 4 September 2026, the day this piece went up on the HTMLRadar blog.
              </p>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">Stacktree</h3>
              <p className="mt-4">
                No cookies visible to{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>, no
                localStorage keys, one script tag, and one non-first-party request that did not
                complete:
              </p>
              <div className="mt-6">
                <CodeBlock file="stacktree · network log" code={STACKTREE_LOG} />
              </div>
              <p className="mt-4">
                The page&apos;s own Content-Security-Policy blocked it. That is the whole
                third-party surface I recorded on this link: one blocked request.
              </p>
              <p className="mt-4 italic">
                No response by 4 September 2026, the day this piece went up on the HTMLRadar blog.
              </p>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">Tiiny.host</h3>
              <p className="mt-4">
                Nine requests in total. Analytics is Plausible, served from the vendor&apos;s own{' '}
                <code className="font-mono text-[14px] text-signal-dark">analytics.tiiny.site</code>
                , not <code className="font-mono text-[14px] text-signal-dark">plausible.io</code>,
                with one POST to{' '}
                <code className="font-mono text-[14px] text-signal-dark">/api/event</code> answered{' '}
                <code className="font-mono text-[14px] text-signal-dark">202</code>. No cookies were
                visible to{' '}
                <code className="font-mono text-[14px] text-signal-dark">document.cookie</code> and
                no localStorage keys were written. The only non-first-party hosts are Google Fonts,
                for the three typefaces in the publisher&apos;s own page. Two further first-party
                resources loaded from{' '}
                <code className="font-mono text-[14px] text-signal-dark">tiiny.host</code> itself:{' '}
                <code className="font-mono text-[14px] text-signal-dark">/ad-script.js</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">/assets/img/ad.png</code>.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Tiiny.host&apos;s response</strong> (30
                August 2026, from their support channel):
              </p>
              <blockquote className="mt-6 border-l-2 border-signal-dark/40 bg-paper-2/40 py-4 pl-5 pr-4 text-[15.5px] leading-relaxed">
                <p>
                  Thank you for sharing the test results. Your observation is consistent with Tiiny
                  Host&apos;s analytics design: we do not use cookies or persistent identifiers, so
                  visitors are not tracked across sites. The analytics are intended to provide
                  aggregate metrics such as visits, page views, referrers, locations, browsers,
                  devices, and operating systems. Accordingly, the absence of document.cookie values
                  and localStorage entries is expected. The analytics script is included on projects
                  to measure usage and plan limits; analytics dashboards are available on paid
                  plans. We cannot independently confirm the exact nine-request count or the
                  specific behavior of the page at the timestamp provided, but we have no correction
                  to the privacy-related findings described above.
                </p>
              </blockquote>

              <h3 className="mt-8 font-serif text-[20px] leading-snug text-ink">HummingDeck</h3>
              <p className="mt-4">
                24 non-first-party hosts is the largest count in the table, and the structure behind
                it needs stating first. The room contains exactly one iframe:
              </p>
              <div className="mt-6">
                <CodeBlock file="hummingdeck · iframe" code={HUMMINGDECK_IFRAME} />
              </div>
              <p className="mt-4">
                The Calendly iframe is the room&apos;s &quot;Let&apos;s meet!&quot; section.
                Segment, Google Analytics, Google Tag Manager, Facebook, Amplitude, Sprig, Braze,
                Statsig, OneTrust, Airbrake, Stripe and reCAPTCHA all appear in the log after that
                frame loads. They are attributed here by timing, not by inspecting the frame. Per
                HummingDeck&apos;s reply below, these requests are initiated inside the Calendly
                embed configured in this room, not by HummingDeck&apos;s own analytics stack, which
                HummingDeck says is disabled on{' '}
                <code className="font-mono text-[14px] text-signal-dark">/r</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">/view</code> paths - our
                attribution by timing is consistent with that. The top-level cookie count is
                nonetheless not the whole picture: any cookie set inside that frame belongs to{' '}
                <code className="font-mono text-[14px] text-signal-dark">calendly.com</code>, and
                this test cannot read it.
              </p>
              <p className="mt-4">
                What HummingDeck&apos;s own page requested, separately from the frame: 18 Next.js
                build chunks on{' '}
                <code className="font-mono text-[14px] text-signal-dark">hummingdeck.com</code>;{' '}
                <code className="font-mono text-[14px] text-signal-dark">POST /api/room-views</code>{' '}
                and{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  GET /api/room-shares/b0c3f880-…/discussions
                </code>{' '}
                for its own view tracking; eight assets from a{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  storage.googleapis.com
                </code>{' '}
                bucket named &quot;hummingdeck&quot; on signed URLs; and one request, at view time,
                to a third-party logo service:
              </p>
              <div className="mt-6">
                <CodeBlock file="hummingdeck · logo.dev request" code={HUMMINGDECK_LOGO} />
              </div>
              <p className="mt-4">
                <code className="font-mono text-[14px] text-signal-dark">northstarlg.com</code> in
                that URL is buyer-branding metadata configured for the room, not the domain of the
                person opening the link. HummingDeck says it is fixed per room and identical for
                every visitor, and that it plans to fetch and cache the logo once, when the room is
                configured, instead of requesting it at view time.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Limit.</strong> The tested link is
                HummingDeck&apos;s own open example room, not a link configured for a specific
                recipient. A customer&apos;s configured room could differ.
              </p>
              <p className="mt-4">
                <code className="font-mono text-[14px] text-signal-dark">
                  Corrected 30 August 2026 after HummingDeck&apos;s reply.
                </code>
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">HummingDeck&apos;s response</strong>{' '}
                (Ilya, founder, 30 August 2026, 08:58 UTC):
              </p>
              <blockquote className="mt-6 border-l-2 border-signal-dark/40 bg-paper-2/40 py-4 pl-5 pr-4 text-[15.5px] leading-relaxed">
                <p>
                  Some context for accuracy: HummingDeck&apos;s own analytics and advertising
                  scripts are disabled on /r and /view paths. The tracker requests you mentioned
                  were initiated inside the Calendly iframe included in this demo room, rather than
                  by HummingDeck&apos;s analytics stack. It is third-party content configured in the
                  room (scheduling embed is preloaded). I&apos;d appreciate it if the piece made
                  that distinction clear. The tested URL is an open example room, not a
                  recipient-specific link. northstarlg.com is fixed buyer-branding metadata
                  configured for the room and is identical for every visitor; it is not inferred
                  from the person opening the link. That said, the Logo.dev finding is useful. We
                  should fetch and cache the logo once when the room is configured, rather than
                  request it at view time.
                </p>
              </blockquote>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                HTMLRadar, held to the same standard
              </h2>
              <p className="mt-4">
                HTMLRadar is ours, which is why the test covers seven links and not six. Same link
                type, same method. The fifteen-second window below is directly comparable with the
                six products above. The heartbeat lines come from the separate 55-second run and are
                labelled as such.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  Where the document is served from.
                </strong>{' '}
                On 30 August the link was{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  htmlradar.com/r/lumenforge-demo
                </code>
                . Recipient documents have since moved to their own domain: that address now answers{' '}
                <code className="font-mono text-[14px] text-signal-dark">301</code> to{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  htmlradar.page/r/lumenforge-demo
                </code>
                , and <code className="font-mono text-[14px] text-signal-dark">htmlradar.page</code>{' '}
                carries none of the application&apos;s cookies.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  What our tracker sends, and where.
                </strong>{' '}
                In the fifteen-second window, one remote procedure call to our own Supabase project
                at{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  ewennjnxuqjzsgawbzur.supabase.co
                </code>
                . In the 55-second run, three more, all to the same host. No other destination
                appeared in either log: no third endpoint, no image beacon, no separate event
                collector, no non-HTMLRadar host.
              </p>
              <div className="mt-6">
                <CodeBlock file="htmlradar · rpc payloads" code={HTMLRADAR_RPC} />
              </div>
              <p className="mt-4">
                <code className="font-mono text-[14px] text-signal-dark">start_session</code> fires
                about five seconds after load. On an ungated share{' '}
                <code className="font-mono text-[14px] text-signal-dark">p_email</code> carries no
                address. The geo fields are not empty labels: on this load they carried{' '}
                <code className="font-mono text-[14px] text-signal-dark">IN</code>,{' '}
                <code className="font-mono text-[14px] text-signal-dark">Bengaluru</code> and{' '}
                <code className="font-mono text-[14px] text-signal-dark">desktop</code>, set by our
                own configuration line in the page.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">What the sender is told.</strong> One
                e-mail, on the first open only, and nothing on repeat opens by the same reader. Its
                subject is the reader&apos;s address, or &quot;An anonymous viewer&quot; on an
                ungated link, then the document&apos;s title. The body is headed &quot;First
                open&quot; and carries the reader, the time in the sender&apos;s timezone, the
                title, and one link reading &quot;See the read&quot;. Section titles and per-section
                seconds are in the dashboard, not in that e-mail.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Cookies and storage.</strong> None
                readable, and none can be written by page script on this page. We serve recipient
                documents with{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
                  allow-downloads
                </code>
                . Without{' '}
                <code className="font-mono text-[14px] text-signal-dark">allow-same-origin</code>{' '}
                the document runs in an opaque origin, so:
              </p>
              <div className="mt-6">
                <CodeBlock file="htmlradar · sandboxed origin" code={HTMLRADAR_SANDBOX} />
              </div>
              <p className="mt-4">
                One consequence is visible in the payload above:{' '}
                <code className="font-mono text-[14px] text-signal-dark">p_fingerprint</code> is
                generated fresh on every load, because the tracker&apos;s attempt to persist it in{' '}
                <code className="font-mono text-[14px] text-signal-dark">localStorage</code> throws
                and is swallowed. Nothing identifying the reader is written to the reader&apos;s
                machine.
              </p>
              <p className="mt-4">
                A second policy rides alongside that one:{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  frame-ancestors &apos;none&apos;; base-uri &apos;none&apos;; form-action
                  &apos;none&apos;
                </code>
                . The last of those means a form inside an uploaded document cannot submit anywhere
                at all, so a convincing fake sign-in page cannot collect what a reader types into
                it.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">Google Fonts.</strong> Four requests went
                to Google on this page, from the sender&apos;s own document: that stylesheet line
                (Fraunces plus Inter) is in the uploaded source file. Our own injection asks for a
                different Fonts URL, and only on the gate and error pages. On a document page it
                adds no Google Fonts request.
              </p>
              <p className="mt-4">Two findings about HTMLRadar, treated the same way.</p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  One. A Cloudflare Web Analytics beacon loaded on our recipient pages.
                </strong>{' '}
                At the time of testing,{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  static.cloudflareinsights.com/beacon.min.js
                </code>{' '}
                returned <code className="font-mono text-[14px] text-signal-dark">200</code> and ran
                on this document page, and on the gate and not-found pages measured in an earlier
                pass. It came from a zone setting covering the whole{' '}
                <code className="font-mono text-[14px] text-signal-dark">htmlradar.com</code>{' '}
                domain, which we read from our own Cloudflare account rather than from the browser.
                A setting rather than our code is an explanation and not an excuse, because it is
                our zone. Its data POST to{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  htmlradar.com/cdn-cgi/rum
                </code>{' '}
                was recorded as{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  FAILED net::ERR_FAILED
                </code>
                , blocked by our sandbox header, so the payload (page timings, memory figures, the
                page URL) never left the browser - a side effect of a security control, not a
                decision. We switched the setting off on 30 August 2026, and the re-check on 31
                August recorded no request to{' '}
                <code className="font-mono text-[14px] text-signal-dark">cloudflareinsights</code>{' '}
                at all.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  Two. We show the reader nothing on the document itself.
                </strong>{' '}
                A search of the served HTML for &quot;we record&quot;, &quot;is tracked&quot;,
                &quot;being tracked&quot;, &quot;this data will be shared&quot;, &quot;opt out&quot;
                and &quot;do not track&quot; returns nothing, on both test dates. The only HTMLRadar
                chrome on the document is a &quot;Powered by HTMLRadar&quot; badge in the corner, on
                the free tier, and it says nothing about tracking. A gated link shows more: the
                e-mail gate says reading activity on the document is shared with the sender and
                links to our privacy page, and both gates carry a &quot;Report this document&quot;
                link to an anonymous form that reaches us, not the sender. An ungated document like
                this one shows neither. The opt-out is{' '}
                <code className="font-mono text-[14px] text-signal-dark">
                  window.HTMLRadar.optOut()
                </code>
                : it stops the running session, then sends the reader to a confirmation page, and
                the button there records the choice in a cookie the proxy sets and checks on every
                request. None of the other six tools in this set offers a way to opt out of its own
                read tracking - DocSend&apos;s cookie banner controls third-party advertising and
                analytics cookies, not DocSend&apos;s own page-view tracking.
              </p>
              <p className="mt-4">
                <strong className="font-semibold text-ink">
                  What we changed, and what we decided not to.
                </strong>
              </p>
              <ol className="mt-4 ml-5 list-decimal space-y-4 marker:text-signal-dark">
                <li>
                  Cloudflare Web Analytics auto-install on the{' '}
                  <code className="font-mono text-[14px] text-signal-dark">htmlradar.com</code> zone
                  is off, so the beacon no longer loads on recipient pages - done 30 August 2026,
                  confirmed by the re-test on 31 August.
                </li>
                <li>
                  We decided not to put a notice or a visible opt-out link on the document. Every
                  tool in this set treats read tracking as the sender&apos;s setting, and we&apos;re
                  not changing that. What we did instead is make the documented opt-out survive a
                  reload, behind a confirmation the reader presses, so that neither a mailed link
                  nor a document&apos;s own script can flip the setting for them.
                </li>
              </ol>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                What a recipient can check
              </h2>
              <p className="mt-4">
                The network and storage parts of this test can be run on any link, by the person who
                received it. In Chrome or Edge, press F12, or Ctrl+Shift+I, or Cmd+Option+I on a
                Mac, to open developer tools. Then:
              </p>
              <ul className="mt-4 ml-5 list-disc space-y-4 marker:text-signal-dark">
                <li>
                  <strong className="font-semibold text-ink">The Network tab.</strong> Reload the
                  page with the tab open. Every request the page makes is listed with its host, so
                  the number of other companies&apos; servers the browser talked to can be read
                  straight off the list.
                </li>
                <li>
                  <strong className="font-semibold text-ink">The Application tab.</strong> Under
                  Storage, &quot;Cookies&quot; lists the cookies for the page&apos;s origin,
                  including the HttpOnly ones that the{' '}
                  <code className="font-mono text-[14px] text-signal-dark">document.cookie</code>{' '}
                  check used in this piece cannot see. &quot;Local storage&quot; and &quot;Session
                  storage&quot; list what was written to the machine.
                </li>
              </ul>
              <p className="mt-4">
                Between them, the Network tab and the Application tab show what loaded and what was
                stored. It does not show who receives the data or what is done with it afterwards;
                no browser can show that.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-[26px] leading-snug text-ink md:text-[28px]">
                Corrections
              </h2>
              <p className="mt-4">
                If you build one of these products and something above is wrong, incomplete, or has
                changed since we tested, write to hello@htmlradar.com and say so. I&apos;ll re-run
                the same test on a link of your choosing, publish your response verbatim alongside
                the original numbers, and date the update. The capture files behind the 31 August
                re-check - every request, its host and its status, per link - are kept, and
                I&apos;ll send yours on request.
              </p>
              <p className="mt-4">
                Cheers,
                <br />
                Abhinandan
              </p>
            </section>
          </div>

          <div className="mt-20 border-t border-line pt-10">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              The launch piece explains why HTMLRadar exists:{' '}
              <Link
                href="/blog/why-i-built-read-tracking-for-html"
                className="text-signal-dark hover:underline"
              >
                decks moved to HTML, so I built the read tracking
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

// ─── The results table ────────────────────────────────────────────────────

// Cells are held as plain strings so the quotes and apostrophes inside them need
// no JSX escaping; `rich` turns their `code` and **bold** spans into elements.
function rich(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`')) {
      return (
        <code key={i} className="font-mono text-[14px] text-signal-dark">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

const HEADERS = [
  'Product',
  'Link tested',
  'Requests to non-first-party hosts',
  'Cookies visible to document.cookie',
  'Known analytics / advertising / replay vendors observed',
  'Notice to the reader',
  'Opt-out',
];

type Row = [string, string, string, string, string, string, string];

const ROWS: Row[] = [
  [
    '**DocSend**',
    '`docsend.com/view/58em2uebezhisqvy`',
    '16 hosts, 80 requests (of 174 total). Includes `www.dropbox.com`, `cfl.dropboxstatic.com`, `googleads.g.doubleclick.net`, `stats.g.doubleclick.net`, `www.google-analytics.com`, `analytics.google.com`, `www.googletagmanager.com`, `www.google.com`, `www.google.co.in`, `accounts.google.com`, `play.google.com`',
    '11, the full list: `dbx_js_analytics_id`, `statsig_stable_id`, `g_state`, `_v_`, `__dbx-consent-session-id__`, `__Secure-dbx_consent`, `_gcl_au`, `_ga`, `_gid`, `_gat_UA-40340055-1`, `_ga_JPP8SP2PRX`',
    'Google Analytics (`UA-40340055-1`, GA4 `G-JPP8SP2PRX`), Google Tag Manager (`GTM-5VPH2V`), Google Ads / DoubleClick (`AW-982651595`), Google Identity Services, Statsig, Sentry (`sentry.javascript.react` 8.37.1 via `d.dropbox.com`), Dropbox `pithos` telemetry bundles',
    "Cookie banner shown. No statement observed that the reader's own activity is recorded",
    'Cookie-level controls offered ("Customize cookies", "Decline"). See the DocSend section for what the consent cookie held before any was pressed',
  ],
  [
    '**Papermark**',
    '`papermark.com/view/cmkz9p9de0014js04sf4ex5u8`',
    "1 host, 15 requests (of 70 total): `d1ff41ind5a7r1.cloudfront.net`, serving the document's own page images on signed URLs",
    '1: `ph_phc_…_posthog` (the PostHog project key in the middle of the name is redacted here)',
    'PostHog (posthog-js 1.418.7), loaded through a first-party proxy path at `app.papermark.com/ingest`. No request reached a `posthog.com` host',
    'None observed',
    'None observed',
  ],
  [
    '**Peony**',
    '`app.peony.ink/view/daa6031a-…`',
    "6 hosts, 16 requests (of 107 total): `client.crisp.chat`, `image.crisp.chat`, `static.hotjar.com`, `script.hotjar.com`, `o336037.ingest.us.sentry.io`, and an R2 storage host serving the deck's own page images",
    '4: `_hjSessionUser_5115897`, `_hjSession_5115897`, `mp_…_mixpanel` (Mixpanel project token redacted), `crisp-client/session/95fd92d6-…`',
    'Hotjar (site id 5115897), Sentry, Mixpanel and Mixpanel Session Replay through a first-party proxy path at `app.peony.ink/mp/`, Crisp live chat',
    'None observed',
    'None observed',
  ],
  [
    '**Stacktree**',
    '`example-brand-audit.stacktr.ee`',
    "1 host, 1 request, 0 completed. `static.cloudflareinsights.com` was requested and recorded as `[FAILED] csp` - blocked by the page's own Content-Security-Policy",
    'None visible. `document.cookie` returned the empty string, before and after the scroll',
    'None observed',
    'None observed',
    'None observed',
  ],
  [
    '**Tiiny.host**',
    '`ai-agents-guide.tiiny.site`',
    '2 hosts, 4 requests (of 9 total): `fonts.googleapis.com` and `fonts.gstatic.com`, both Google Fonts',
    'None visible. `document.cookie` returned the empty string, before and after the scroll',
    "Plausible Analytics, served from the vendor's own subdomain `analytics.tiiny.site` (`/js/plausible.js`, one POST to `/api/event` answered `202`)",
    'None observed',
    'None observed',
  ],
  [
    '**HummingDeck**',
    '`hummingdeck.com/r/mt3uu5qwv7kpxb3g`',
    '24 hosts, 76 requests (of 101 total). Most appear after an embedded Calendly iframe loads - see the HummingDeck section',
    'None visible to page scripts on the top-level `hummingdeck.com` document. Cookies inside the `calendly.com` frame belong to that origin and are not readable from, or counted by, this test',
    "Observed as requests, all after the Calendly frame loads: Segment (11 requests), Google Analytics, Google Tag Manager, Facebook (`fbevents.js`), Amplitude (as a Segment destination bundle), Sprig (including `dependencies/record.min.js`), Braze, Statsig, OneTrust, Airbrake. Per HummingDeck's reply, these are initiated inside the Calendly embed configured in the room, not HummingDeck's own analytics stack; our attribution by timing is consistent with that",
    'None observed',
    'None observed at the top level. The OneTrust consent SDK that loaded belongs to the Calendly frame',
  ],
  [
    '**HTMLRadar** (ours)',
    '`htmlradar.com/r/lumenforge-demo`, which now redirects to `htmlradar.page/r/lumenforge-demo`',
    "4 hosts, 6 requests (of 9 total): `fonts.googleapis.com` and `fonts.gstatic.com` (requested by the sender's own document), `static.cloudflareinsights.com` (a Cloudflare zone setting on our domain, at the time of testing, since switched off), and our own Supabase project `ewennjnxuqjzsgawbzur.supabase.co`",
    'None readable. `document.cookie` threw `SecurityError` - the page is sandboxed into an opaque origin, so cookies and storage are unavailable to any script on it',
    'None observed',
    'None observed',
    'Programmatic (`window.HTMLRadar.optOut()`), which sends the reader to a confirmation page whose button records the choice; no visible link on the document',
  ],
];

function ResultsTable() {
  return (
    <figure className="my-2 overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="bg-paper-2/50 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
            <tr>
              {HEADERS.map((h) => (
                <th key={h} className="px-4 py-3 align-top">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ROWS.map((row) => (
              <tr key={row[0]}>
                <td className="px-4 py-3 align-top font-mono text-[12.5px] text-ink">
                  {rich(row[0])}
                </td>
                <td className="px-4 py-3 align-top font-mono text-[11.5px] text-graphite">
                  {rich(row[1])}
                </td>
                {row.slice(2).map((cell, i) => (
                  <td key={i} className="px-4 py-3 align-top text-[13px] text-ink-soft">
                    {rich(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function CodeBlock({ file, code }: { file: string; code: string }) {
  return (
    <div className="my-1 overflow-hidden rounded-xl border border-line bg-paper-2/40">
      <div className="border-b border-line bg-paper-2/60 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
        {file}
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.55] text-ink">
        {code}
      </pre>
    </div>
  );
}

// ─── Verbatim capture excerpts ────────────────────────────────────────────

const DOCSEND_LOG = `149. [POST] https://www.google.com/ccm/collect?…&en=page_view&dl=https%3A%2F%2Fdocsend.com%2Fview%2F58em2uebezhisqvy…
152. [XHR]  https://www.google-analytics.com/j/collect?…&tid=UA-40340055-1&cid=1353163225.1788073151…
153. [GET]  https://googleads.g.doubleclick.net/pagead/viewthroughconversion/982651595/?…
158. [GET]  https://www.google.com/pagead/1p-user-list/982651595/?…&is_vtc=1&cid=CAQS0wEAQM4h…
159. [GET]  https://www.google.co.in/pagead/1p-user-list/982651595/?…&rmt_tld=1…
160. [POST] https://analytics.google.com/g/collect?v=2&tid=G-JPP8SP2PRX&…
161. [POST] https://stats.g.doubleclick.net/g/collect?v=2&tid=G-JPP8SP2PRX&…`;

const DOCSEND_CONSENT = `__Secure-dbx_consent = {"consentType":1,
  "consentDate":"2026-08-30T06:59:11.034Z",
  "categories":{"strictly necessary":true,
                "general marketing and advertising":true,
                "analytics":true,
                "performance and functionality":true,
                "social media advertising":true},
  "userInteracted":false,"numDots":1}`;

const PEONY_REPLAY = `95. [POST] …/mp/record/?…&seq=0&batch_start_time=1788072088.388&replay_id=1a05166d344321-…
      &replay_length_ms=5020&replay_start_time=1788072088.388&…&format=gzip => [308]
96. [POST] …/mp/record?…(same, no trailing slash)…                          => [402]`;

const STACKTREE_LOG = `2. [GET] https://static.cloudflareinsights.com/beacon.min.js/v3d52b479… => [FAILED] csp`;

const HUMMINGDECK_IFRAME = `https://calendly.com/ilya-hummingdeck/30min`;

const HUMMINGDECK_LOGO = `https://img.logo.dev/northstarlg.com?token=[redacted]&size=128`;

const HTMLRADAR_RPC = `Fifteen-second window
POST /rest/v1/rpc/start_session   => 200
  p_share_slug, p_email, p_fingerprint, p_referrer, p_user_agent,
  p_country_code, p_city, p_device_type, p_os, p_browser

55-second run only - heartbeat, three times
POST /rest/v1/rpc/update_session  => 200
  p_session_id, p_token, p_active_seconds, p_max_scroll, p_sections[]
    p_sections[].section_id, p_sections[].section_title,
    p_sections[].depth, p_sections[].ordinal, p_sections[].time_seconds`;

const HTMLRADAR_SANDBOX = `window.origin                 -> "null"
document.cookie               -> THREW SecurityError: The document is sandboxed and
                                 lacks the 'allow-same-origin' flag.
localStorage / sessionStorage -> THREW SecurityError: same message.`;
