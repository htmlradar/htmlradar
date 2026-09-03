// POST /api/auth/magic-link — server-side proxy for the magic-link sign-in
// request. SignInForm posts here instead of calling
// supabase.auth.signInWithOtp directly from the browser, so a burst from one
// address or one network never reaches Supabase's own auth-email budget on
// its own.
//
// Two independent budgets, both the same per-address limiter every other
// route uses (see api-auth.ts): one keyed by the email itself (a script
// hammering one inbox), one keyed by the caller's IP (a script rotating
// addresses from one network). Either tripping is enough to refuse.
// Supabase's project-wide rate_limit_email_sent (raised to 30/hour,
// 2026-09-05 — see OVERNIGHT-DISCOVERABILITY-PLAN-2026-09-04.md item 2) is
// the last line shared by every caller combined, not the first.

import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  addressRetryAfter,
  addressRetryAfterFor,
  errorResponse,
  jsonResponse,
  rateLimited,
  readBodyCapped,
  validationError,
} from '@/lib/api-auth';
import { isDisposableEmail } from '@/lib/disposable-emails';
import { safeNext } from '@/lib/safe-next';

export const runtime = 'edge';

const SITE_URL = 'https://htmlradar.com';

// Small on purpose — Supabase's project limit is the shared safety net, so
// one address or one network gets a fraction of it, not the whole hourly
// allowance.
const PER_EMAIL_PER_HOUR = 3;
const PER_IP_PER_HOUR = 8;

interface Body {
  email?: unknown;
  next?: unknown;
}

export async function POST(req: NextRequest): Promise<Response> {
  const raw = await readBodyCapped(req, 1024);
  let body: Body | null = null;
  try {
    body = typeof raw === 'string' && raw ? (JSON.parse(raw) as Body) : null;
  } catch {
    body = null;
  }
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const next = safeNext(typeof body?.next === 'string' ? body.next : null);

  if (!email || !email.includes('@')) {
    return errorResponse(validationError('A valid email address is required.'));
  }
  if (isDisposableEmail(email)) {
    return errorResponse(validationError("Disposable email addresses aren't accepted for signup."));
  }

  // Checked email-first: a caller inside its own address budget is the only
  // one who ever spends network budget, same ordering as authenticateApiKey.
  const emailWait = await addressRetryAfterFor(
    email.toLowerCase(),
    'magic-link-email',
    PER_EMAIL_PER_HOUR,
  );
  if (emailWait > 0) return errorResponse(rateLimited(emailWait));

  const ipWait = await addressRetryAfter(req, 'magic-link-ip', PER_IP_PER_HOUR);
  if (ipWait > 0) return errorResponse(rateLimited(ipWait));

  const supabase = createClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
  );
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    return jsonResponse(400, { error: 'otp_error', message: error.message });
  }
  return jsonResponse(200, { ok: true });
}
