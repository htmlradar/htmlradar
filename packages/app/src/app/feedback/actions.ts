'use server';

// Feedback submit handler. Anyone can submit (anon or signed in). Inserts
// into feedback table; trigger fires notify_on_feedback() which emails
// the founder via pg_net + Resend.

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { captureServerEvent } from '@/lib/events';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

export async function submitFeedback(formData: FormData) {
  const body = String(formData.get('body') ?? '').trim();
  if (!body) redirect('/feedback?error=empty');

  const email = String(formData.get('email') ?? '').trim() || null;
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
