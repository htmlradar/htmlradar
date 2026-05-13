'use client';

// Sign-in page. Two paths: Google OAuth or magic-link email. The actual
// auth mechanics are untouched from the original — only the surrounding
// chrome was rewritten to match landing v4 voice + palette. A small
// HeroRadar at the top gives visual continuity with the marketing pages.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabase-browser';
import { HeroRadar } from '@/components/HeroRadar';

export const runtime = 'edge';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInBody />
    </Suspense>
  );
}

function SignInBody() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/docs';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-10 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-[14.5px] font-medium text-ink shadow-[0_1px_0_rgba(31,17,8,0.04)] transition hover:border-signal hover:text-signal-dark disabled:opacity-50"
        >
          Continue with Google
        </button>

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
            {error && <p className="text-[13px] text-alert">{error}</p>}
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
