-- 020_notify_real_first_open_and_owner_tz.sql
-- ------------------------------------------------------------
-- Two related fixes to the first-open notification:
--
-- 1. "FIRST OPEN" was firing on every repeat session by the same
--    viewer once the 5-minute dedup window expired. The trigger
--    fired correctly but the email body said FIRST OPEN every time,
--    flooding the sender. Repeat-open alerts are a Pro-tier feature
--    in the roadmap (see /upgrade); v1 should be silent on repeats.
--    NEW behavior: skip the email if the same viewer has ANY prior
--    session on this share. The `share.first_view` telemetry event
--    still fires on every visit (it's a "first view this session"
--    signal for analytics, not a notification trigger).
--
-- 2. Timestamps rendered in UTC regardless of where the sender
--    actually lives. Senders are mostly outside UTC; "May 19, 05:20
--    UTC" forces them to do timezone math every time. NEW behavior:
--    `profiles.timezone` (default 'UTC') stores each sender's IANA
--    timezone; the trigger renders the timestamp in that zone and
--    appends the short name ("May 19, 10:50 IST"). The app captures
--    the browser's timezone on first authenticated render and
--    UPDATEs profiles if it's still 'UTC'.
--
-- Apply: paste into Supabase SQL editor, run once. Idempotent.
-- ------------------------------------------------------------

-- Step 1: column for the sender's timezone. Default 'UTC' is safe;
-- the app upgrades it on first render via the timezone-sync action.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'profiles' and column_name = 'timezone'
  ) then
    alter table profiles
      add column timezone text not null default 'UTC';
  end if;
end$$;

-- Step 2: rewrite notify_on_first_open. Diff vs 014:
--   - 5-min dedup → ANY prior session by same viewer+share = skip
--   - SET LOCAL TimeZone to v_owner.timezone before formatting the
--     timestamp, so to_char(now(), 'TZ') renders the abbreviation
--   - everything else is unchanged from 014 (template body, internal
--     viewer guard, Vault secret lookup, pg_net POST, notifications_log)

create or replace function notify_on_first_open()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prior_session_id uuid;
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
  -- TRUE first-open dedup: skip the email if THIS viewer has opened
  -- THIS share before, ever. Repeat-open alerts are a Pro feature
  -- not shipped yet. The `share.first_view` event below still fires
  -- on every session so analytics is uninterrupted.
  select id into v_prior_session_id
  from sessions
  where viewer_id = new.viewer_id and share_id = new.share_id and id <> new.id
  limit 1;

  select * into v_share from document_shares where id = new.share_id;
  select * into v_viewer from viewers where id = new.viewer_id;
  select * into v_doc from documents where id = v_share.document_id;
  select * into v_owner from profiles where id = v_doc.owner_id;

  -- share.first_view event always fires (analytics signal).
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
      'viewer_is_internal', coalesce(v_viewer.is_internal, false),
      'is_repeat_open', v_prior_session_id is not null
    ),
    v_owner.id
  );

  -- Skip email on repeat opens (NEW).
  if v_prior_session_id is not null then
    insert into notifications_log (session_id, email_to, status, error_message)
    values (new.id, v_owner.email, 'skipped', 'repeat open by same viewer');
    return new;
  end if;

  -- Internal viewer guard (carried from 013).
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

  -- Render the timestamp in the sender's timezone (NEW). set_config
  -- with the third arg = true scopes the TZ change to this transaction
  -- so we don't leak it to other queries. The 'TZ' format token reads
  -- from the session's current TimeZone setting, so this gives us
  -- "May 19, 10:50 IST" when v_owner.timezone is 'Asia/Kolkata',
  -- "May 19, 05:20 UTC" when it's the default, etc.
  perform set_config('TimeZone', coalesce(v_owner.timezone, 'UTC'), true);
  v_when_label := to_char(now(), 'Mon DD, HH24:MI TZ');

  v_dashboard_url := 'https://htmlradar.com/dashboard/' || v_share.slug;
  v_subject := format('%s opened %s', v_viewer_label, v_doc.title);

  -- Body template unchanged from 014.
  v_body := format($html$
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background:#FBF1E8;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,'Segoe UI',Roboto,sans-serif;color:#1F1108;-webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background:#FBF1E8;">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;background:#FBF1E8;">
      <tr><td style="padding:0 8px 28px 8px;">
        <span style="display:inline-block;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#5A1521;font-weight:600;">HTML<span style="color:#7A1F2E;font-style:italic;font-weight:500;">Radar</span></span>
      </td></tr>
      <tr><td style="padding:0 8px 12px 8px;">
        <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#876959;">First open</p>
      </td></tr>
      <tr><td style="padding:0 8px 18px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle" style="padding-right:12px;">
              <div style="width:36px;height:36px;border-radius:9999px;background:#7A1F2E;color:#FBF1E8;display:inline-block;text-align:center;line-height:36px;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;font-weight:600;">%s</div>
            </td>
            <td valign="middle">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;color:#1F1108;font-weight:600;line-height:1.3;">%s</p>
              <p style="margin:2px 0 0 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.06em;color:#876959;">just opened &middot; %s</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 8px 28px 8px;">
        <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:26px;line-height:1.2;color:#1F1108;font-weight:400;font-style:italic;letter-spacing:-0.01em;">&ldquo;%s&rdquo;</p>
      </td></tr>
      <tr><td style="padding:0 8px 12px 8px;">
        <a href="%s" style="display:inline-block;background:#7A1F2E;color:#FBF1E8;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:14px;font-weight:600;padding:12px 22px;border-radius:6px;letter-spacing:0.01em;">See the read &rarr;</a>
      </td></tr>
      <tr><td style="padding:24px 8px 0 8px;border-top:1px solid #E8D5BD;">
        <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;color:#876959;letter-spacing:0.02em;">Referrer &middot; <a href="https://htmlradar.com" style="color:#5A1521;text-decoration:none;">%s</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
$html$,
    v_subject,
    v_avatar_letter,
    v_viewer_label,
    v_when_label,
    v_doc.title,
    v_dashboard_url,
    v_referrer_label
  );

  v_payload := jsonb_build_object(
    'from', v_from,
    'to', array[v_owner.email],
    'subject', v_subject,
    'html', v_body
  );

  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type', 'application/json'
    ),
    body := v_payload
  ) into v_request_id;

  insert into notifications_log (session_id, email_to, request_id, status)
  values (new.id, v_owner.email, v_request_id, 'queued');

  update sessions set notification_sent_at = now() where id = new.id;
  return new;
end;
$$;
