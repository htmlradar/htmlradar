'use client';

// Sign-in page. Two paths: Google OAuth or magic-link email. The actual
// auth mechanics are untouched from the original — only the surrounding
// chrome was rewritten to match landing v4 voice + palette. A small
// HeroRadar at the top gives visual continuity with the marketing pages.

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabase-browser';
import { HeroRadar } from '@/components/HeroRadar';
import { isDisposableEmail } from '@/lib/disposable-emails';

export const runtime = 'edge';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInBody />
    </Suspense>
  );
}

// Map server-side error codes (from /auth/callback failure paths) to a
// human-readable message. Without this the form silently shows nothing
// and the user just sees an empty sign-in page after a failed OAuth round-trip.
function errorCopy(code: string | null): string | null {
  switch (code) {
    case 'callback':
      return "We couldn't complete the sign-in. Try again, or use the magic-link option below.";
    case 'expired':
      return 'That magic link expired. Send yourself a fresh one.';
    case null:
    case '':
      return null;
    default:
      return 'Something went wrong signing in. Try again, or email hello@htmlradar.com.';
  }
}

function SignInBody() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/docs';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface server-side callback errors. /auth/callback redirects to
  // /sign-in?error=callback on failure; without this hydration step the
  // user sees a fresh-looking form and has no idea sign-in failed.
  useEffect(() => {
    const code = params.get('error');
    const msg = errorCopy(code);
    if (msg) setError(msg);
  }, [params]);

  async function signInWithGoogle() {
    setBusy(true);
    const supabase = browserClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Client-side block before the magic link gets generated. Saves us
    // a Supabase Auth call and gives the user immediate feedback instead
    // of a magic link they can't actually receive (or that just makes
    // multi-account abuse trivial). Same disposable list lives in the
    // start_session RPC so recipients are blocked the same way.
    if (isDisposableEmail(email)) {
      setError(
        "Disposable email addresses aren't accepted for signup. Use a real work or personal email.",
      );
      setBusy(false);
      return;
    }
    const supabase = browserClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (err) setError(err.message);
    else setSent(true);
    setBusy(false);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div aria-hidden className="hero-bloom pointer-events-none absolute inset-0" />

      <div
        aria-hidden
        className="pointer-events-none absolute right-[-80px] top-[-60px] opacity-50 md:right-[-40px] md:top-[-20px]"
      >
        <HeroRadar size={280} />
      </div>

      <div className="relative w-full max-w-md">
        <a href="/" className="mb-10 block font-mono text-[13px] tracking-wide text-ink">
          HTML<span className="text-signal">Radar</span>
        </a>

        <h1 className="text-letterpress font-serif text-[40px] font-normal leading-[1.05] tracking-tightest text-ink md:text-[48px]">
          Sign in.
        </h1>
        <p className="mt-3 text-[15px] text-ink-soft">
          Continue with Google or get a magic link in your inbox.
        </p>

        {error && !sent && (
          <div
            role="alert"
            className="mt-8 rounded-md border border-alert/40 bg-alert/5 px-4 py-3 text-[13.5px] leading-relaxed text-alert"
          >
            {error}
          </div>
        )}

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-[14.5px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark disabled:opacity-50"
        >
          Continue with Google
        </button>

        <p className="mt-3 text-[11.5px] leading-relaxed text-graphite">
          Google may briefly show <span className="font-mono">supabase.co</span> — that&rsquo;s the
          open-source auth backend HTMLRadar runs on. Stack is auditable at{' '}
          <a
            href="https://github.com/htmlradar/htmlradar"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-line decoration-2 underline-offset-4 hover:text-signal-dark hover:decoration-signal"
          >
            github.com/htmlradar/htmlradar
          </a>
          .
        </p>

        <div className="my-7 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        {sent ? (
          <div className="rounded-md border border-line bg-paper-2/60 p-5 text-[14px] leading-relaxed text-ink-soft">
            HTMLRadar sent a sign-in link to <strong className="text-ink">{email}</strong>. Open the
            email and click through to finish.
          </div>
        ) : (
          <form onSubmit={signInWithEmail} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-line bg-paper px-3.5 py-3 text-[14.5px] text-ink outline-none transition placeholder:text-graphite/70 focus:border-signal focus:shadow-[0_0_0_3px_rgba(122,31,46,0.08)]"
            />
            {/* form-specific (magic-link) error: only show here if not already shown above */}
            <button
              type="submit"
              disabled={busy}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-4 py-3 text-[14.5px] font-medium text-paper shadow-[0_1px_0_rgba(31,17,8,0.15)] transition hover:bg-signal-dark disabled:opacity-50"
            >
              Send magic link
            </button>
          </form>
        )}

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">
          No card needed. 10 documents free.
        </p>
      </div>
    </main>
  );
}
