'use server';

// Feedback submit handler. Sign-in REQUIRED (gated 2026-05-17 after a
// spam submission tried to sell us something). Page-level check renders
// a sign-in CTA for anon users; this server-side check is defense in
// depth — a direct POST without a session is rejected.
//
// Inserts into feedback table; trigger fires notify_on_feedback() which
// emails the founder via pg_net + Resend.

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { captureServerEvent } from '@/lib/events';
import { serverClient } from '@/lib/supabase-server';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

export async function submitFeedback(formData: FormData) {
  const supabase = serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/feedback');

  const body = String(formData.get('body') ?? '').trim();
  if (!body) redirect('/feedback?error=empty');

  // Always source email from the authenticated session — ignore whatever
  // the form posted. Stops a signed-in user from spoofing someone else's
  // address into the feedback row.
  const email = user.email ?? null;
  const page = String(formData.get('page') ?? '/feedback');
  const ua = headers().get('user-agent') ?? null;

  // Insert MUST succeed before we show success. Without this check the
  // form silently appears to work even when the row never lands (network,
  // RLS misconfig, schema drift). The recipient thinks we received their
  // feedback, we never did, trust is gone.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email,
      body: body.slice(0, 4000),
      page,
      user_agent: ua,
    }),
  });
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn('[feedback] insert failed', res.status, await res.text());
    redirect('/feedback?error=submit');
  }

  await captureServerEvent({
    event: 'feedback.submitted',
    distinctId: email ?? 'anon',
    properties: { has_email: !!email, page, body_length: body.length },
  });

  redirect('/feedback?sent=1');
}
