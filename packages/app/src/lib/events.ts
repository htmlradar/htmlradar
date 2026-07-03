// Server-side event capture. Insert into app_events via service-role
// REST so writes succeed regardless of caller auth state.
//
// Why not posthog-node: zero vendor footprint. The app_events table is
// PostHog-shaped, so we can replay later. See schema/006_observability.sql.

import 'server-only';

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

export type AppEvent =
  | 'user.signed_up'
  | 'user.signed_in'
  | 'user.signed_out'
  | 'document.created'
  | 'document.deleted'
  | 'document.replaced'
  | 'version.v1_seed_failed'
  | 'share.created'
  | 'share.edited'
  | 'share.revoked'
  | 'share.reactivated'
  | 'share.deleted'
  | 'share.preview_opened'
  | 'document.preview_opened'
  | 'attachment.uploaded'
  | 'attachment.deleted'
  | 'attachment.downloaded'
  | 'attachment.r2_orphan'
  | 'share.copied'
  | 'upgrade.viewed'
  | 'upgrade.clicked'
  | 'feedback.submitted'
  | 'pricing.viewed'
  | 'free_tier.cap_hit'
  | 'free_tier.share_cap_hit'
  | 'share.first_view'
  | 'viewer.hidden_toggled'
  | 'payment.received'
  | 'subscription.activated'
  | 'subscription.canceled'
  | 'subscription.revoked'
  | '$identify';

interface CaptureOpts {
  event: AppEvent;
  distinctId: string;
  userId?: string;
  properties?: Record<string, unknown>;
}

// Fire-and-forget event capture. Never throws — analytics must never
// break the request path. Logs to console on failure.
export async function captureServerEvent(opts: CaptureOpts): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        distinct_id: opts.distinctId,
        event: opts.event,
        properties: opts.properties ?? {},
        user_id: opts.userId ?? null,
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('[events] capture failed', res.status, await res.text());
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[events] capture threw', err);
  }
}
