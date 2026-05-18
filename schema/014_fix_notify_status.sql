-- 014_fix_notify_status.sql
-- ------------------------------------------------------------
-- Fix: notify_on_first_open silently dropping emails since migration 013.
--
-- Root cause: migration 013 changed the success-path insert from
--   insert into notifications_log (..., request_id, status)
--   values (..., v_request_id, 'queued')
-- to
--   insert into notifications_log (..., status, request_id)
--   values (..., 'sent', v_request_id)
--
-- The CHECK constraint on `notifications_log.status` (set in 003) only
-- allows ('queued','delivered','failed','skipped'). 'sent' is NOT in
-- that list. So the success-path INSERT raises a check_violation, which
-- in PL/pgSQL aborts the surrounding BEGIN..EXCEPTION block AND its
-- implicit savepoint — which includes the `net.http_post` queue row
-- that was inserted moments earlier inside the same block. pg_net
-- never sees the request → email never sends.
--
-- The catch block then inserts a status='failed' row with error_message
-- containing the constraint-violation text, masking the underlying bug.
--
-- Validation evidence (2026-05-18):
--   select status, count(*), max(error_message)
--   from notifications_log where created_at > now() - interval '30 days'
--   group by status;
--   → status='failed' rows dominate; all error_messages identical:
--     "new row for relation \"notifications_log\" violates check
--      constraint \"notifications_log_status_check\""
--
-- Fix: rewrite notify_on_first_open with status='queued' (the original
-- semantics — pg_net has accepted the request and queued it for
-- delivery; whether Resend ultimately accepts is async). Column order
-- restored to match the historical 010 form so a future diff stays
-- readable.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

create or replace function notify_on_first_open()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recent_session_id uuid;
  v_share document_shares%rowtype;
  v_viewer viewers%rowtype;
  v_doc documents%rowtype;
  v_owner profiles%rowtype;
  v_resend_key text;
  v_from text;
  v_payload jsonb;
  v_subject text;
  v_body text;
  v_request_id bigint;
  v_owner_first text;
  v_viewer_label text;
  v_avatar_letter text;
  v_referrer_label text;
  v_when_label text;
  v_dashboard_url text;
begin
  -- Dedup: same viewer, same share, within 5 minutes -> skip
  select id into v_recent_session_id
  from sessions
  where viewer_id = new.viewer_id and share_id = new.share_id and id <> new.id
    and started_at > now() - interval '5 minutes'
  limit 1;
  if v_recent_session_id is not null then
    return new;
  end if;

  select * into v_share from document_shares where id = new.share_id;
  select * into v_viewer from viewers where id = new.viewer_id;
  select * into v_doc from documents where id = v_share.document_id;
  select * into v_owner from profiles where id = v_doc.owner_id;

  -- share.first_view event still goes into app_events — we want
  -- telemetry on every read regardless of internal status.
  insert into app_events (distinct_id, event, properties, user_id)
  values (
    v_owner.id::text,
    'share.first_view',
    jsonb_build_object(
      'slug', v_share.slug,
      'document_id', v_doc.id,
      'recipient_label', v_share.recipient_label,
      'viewer_country', v_viewer.country_code,
      'viewer_device', v_viewer.device_type,
      'has_email_gate', v_share.require_email,
      'has_password_gate', v_share.require_password,
      'viewer_is_internal', coalesce(v_viewer.is_internal, false)
    ),
    v_owner.id
  );

  -- Internal viewer guard (013): no email for owner-self / staff QA.
  if coalesce(v_viewer.is_internal, false) then
    insert into notifications_log (session_id, email_to, status, error_message)
    values (new.id, v_owner.email, 'skipped', 'viewer marked internal');
    return new;
  end if;

  begin
    select decrypted_secret into v_resend_key
    from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    select decrypted_secret into v_from
    from vault.decrypted_secrets where name = 'resend_from' limit 1;
  exception when others then
    v_resend_key := null;
    v_from := null;
  end;
  if v_resend_key is null or v_from is null then
    insert into notifications_log (session_id, email_to, status, error_message)
    values (new.id, v_owner.email, 'skipped', 'resend secrets not in Vault');
    return new;
  end if;

  -- Body builder (template carried forward from 010).
  v_owner_first := coalesce(
    nullif(split_part(coalesce(v_owner.display_name, ''), ' ', 1), ''),
    split_part(v_owner.email, '@', 1)
  );
  v_viewer_label := coalesce(v_viewer.email, 'An anonymous viewer');
  v_avatar_letter := upper(coalesce(nullif(substring(v_viewer.email from 1 for 1), ''), '?'));
  v_referrer_label := coalesce(
    nullif(regexp_replace(coalesce(v_viewer.referrer, ''), '^https?://([^/]+).*$', '\1'), ''),
    'Direct link'
  );
  v_when_label := to_char(now() at time zone 'utc', 'Mon DD, HH24:MI') || ' UTC';
  v_dashboard_url := 'https://htmlradar.com/dashboard/' || v_share.slug;

  v_subject := format('%s opened %s', v_viewer_label, v_doc.title);

  v_body := format($html$
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background:#FBF1E8;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,Segoe UI,Roboto,sans-serif;color:#1F1108;-webkit-font-smoothing:antialiased;mso-line-height-rule:exactly;">
  <div style="display:none;visibility:hidden;opacity:0;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;mso-hide:all;color:#FBF1E8;">
    %s just opened %s. Read it in HTMLRadar.
  </div>
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" border="0" style="background:#FBF1E8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%%;">
        <tr><td style="padding:0 0 18px 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11.5px;letter-spacing:0.04em;color:#4B2D1E;">
          HTML<span style="color:#7A1F2E;">Radar</span>
        </td></tr>
        <tr><td style="padding:0 0 14px 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:#876959;">
          First open
        </td></tr>
        <tr><td style="padding:0 0 22px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
            <tr>
              <td style="width:36px;vertical-align:middle;">
                <div style="width:36px;height:36px;border-radius:18px;background:#7A1F2E;color:#FBF1E8;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:13.5px;line-height:36px;text-align:center;letter-spacing:0;">
                  %s
                </div>
              </td>
              <td style="padding-left:12px;vertical-align:middle;">
                <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,Segoe UI,Roboto,sans-serif;font-size:13.5px;font-weight:500;color:#1F1108;">%s</p>
                <p style="margin:2px 0 0 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.06em;color:#876959;">just opened &middot; %s</p>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 0 28px 0;">
          <p style="margin:0;font-family:Georgia,'Hoefler Text',Charter,serif;font-style:italic;font-size:22px;line-height:1.28;color:#1F1108;letter-spacing:-0.01em;">"%s"</p>
        </td></tr>
        <tr><td style="padding:0 0 22px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr><td bgcolor="#7A1F2E" style="border-radius:6px;">
              <a href="%s" style="display:inline-block;padding:13px 22px;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;font-weight:500;color:#FBF1E8;text-decoration:none;border-radius:6px;">See the read &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 0 0 0;border-top:1px solid #E8D9CA;">
          <p style="margin:14px 0 0 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:10.5px;letter-spacing:0.06em;color:#876959;">
            Referrer &middot; %s
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
$html$,
    v_subject,
    v_viewer_label, v_doc.title,
    v_avatar_letter,
    v_viewer_label, v_when_label,
    v_doc.title,
    v_dashboard_url,
    v_referrer_label
  );

  v_payload := jsonb_build_object(
    'from', v_from,
    'to', jsonb_build_array(v_owner.email),
    'subject', v_subject,
    'html', v_body
  );

  begin
    select net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_resend_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    ) into v_request_id;
    -- IMPORTANT: status='queued' (not 'sent'). The HTTP request has
    -- been handed to pg_net; whether Resend ACCEPTS is async and may
    -- arrive later via the net._http_response table. 'queued' is one
    -- of the four values allowed by the notifications_log_status_check
    -- constraint defined in 003_triggers.sql.
    insert into notifications_log (session_id, email_to, request_id, status)
    values (new.id, v_owner.email, v_request_id, 'queued');
  exception when others then
    insert into notifications_log (session_id, email_to, status, error_message)
    values (new.id, v_owner.email, 'failed', sqlerrm);
  end;

  return new;
end;
$$;
