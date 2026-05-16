// Public /feedback page. Anyone can submit, signed-in or not. Submissions
// trigger an email to the founder via pg_net (see schema/006_observability.sql
// notify_on_feedback trigger).

import { SectionMark } from '@/components/SectionMark';
import { NavBar } from '@/components/NavBar';
import { submitFeedback } from './actions';

export const runtime = 'edge';

export const metadata = {
  title: 'Feedback',
  description:
    'Tell us what we missed, what broke, or what you wish HTMLRadar did. Goes straight to the founder.',
};

export default function FeedbackPage({
  searchParams,
}: {
  searchParams?: { sent?: string; error?: string };
}) {
  const sent = searchParams?.sent === '1';
  const error = searchParams?.error;
  const errorMessage =
    error === 'empty'
      ? 'Looks like the message was empty. Add a few words and try again.'
      : error === 'submit'
        ? 'Something went wrong on our side saving your message. Try again, or email hello@htmlradar.com directly.'
        : null;

  return (
    <>
      <NavBar />
      <main className="relative">
        <article className="mx-auto max-w-2xl px-6 py-20 md:py-28">
          <SectionMark>HTMLRadar · Feedback</SectionMark>
          <h1 className="text-letterpress mt-6 font-serif text-[44px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[60px]">
            Tell us what we missed.
          </h1>
          <p className="mt-6 max-w-lg text-[15.5px] leading-relaxed text-ink-soft">
            Bugs, feature requests, opinions on the pricing, things that confused you, things that
            worked well, comparisons to other tools you've used. We read every message. Replies land
            in your inbox if you leave an email.
          </p>

          {sent ? (
            <div className="mt-10 rounded-2xl border border-signal/40 bg-paper p-8 shadow-[0_30px_60px_-30px_rgba(122,31,46,0.18)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-dark">
                Sent. Thanks.
              </p>
              <p className="mt-3 text-[16px] leading-relaxed text-ink">
                We'll read it within a day. If you left an email, expect a reply.
              </p>
              <a
                href="/feedback"
                className="mt-6 inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
              >
                Submit another →
              </a>
            </div>
          ) : (
            <form
              action={submitFeedback}
              className="mt-12 space-y-6 rounded-2xl border border-line bg-paper p-6 md:p-8"
            >
              {errorMessage && (
                <div className="rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[13.5px] text-alert">
                  {errorMessage}
                </div>
              )}
              <div>
                <label
                  htmlFor="email"
                  className="block font-mono text-[11px] uppercase tracking-[0.16em] text-graphite"
                >
                  Email (optional)
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  className="mt-2 w-full rounded-md border border-line bg-paper px-4 py-3 text-[16px] text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)] md:text-[14.5px]"
                />
                <p className="mt-2 text-[12.5px] text-graphite">
                  Leave it blank for anonymous. Add it if you want a reply.
                </p>
              </div>

              <div>
                <label
                  htmlFor="body"
                  className="block font-mono text-[11px] uppercase tracking-[0.16em] text-graphite"
                >
                  Your message
                </label>
                <textarea
                  id="body"
                  name="body"
                  required
                  rows={8}
                  maxLength={4000}
                  placeholder="What's on your mind?"
                  className="mt-2 w-full rounded-md border border-line bg-paper px-4 py-3 text-[14.5px] leading-relaxed text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
                />
              </div>

              <input type="hidden" name="page" value="/feedback" />

              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3 text-[15px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark"
              >
                Send feedback
              </button>
            </form>
          )}

          <div className="mt-20 border-t border-line pt-10">
            <a
              href="/"
              className="link-slide font-mono text-[12px] uppercase tracking-[0.16em] text-graphite hover:text-signal-dark"
            >
              ← Back to home
            </a>
          </div>
        </article>
      </main>
    </>
  );
}
