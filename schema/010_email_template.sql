-- 010_email_template.sql
-- ------------------------------------------------------------
-- Branded "first open" notification email. Replaces the plain-text body
-- from 003 with an editorial template — HTMLRadar oxblood pill, serif
-- headline, single CTA back into the app.
--
-- Intentional information design: the email is a TEASE, not a report.
-- The sender gets enough to know who + what + when. Country, device,
-- scroll %, dwell, sections — all of that lives in the app. That's the
-- value of the click-through.
--
-- Apply: paste into Supabase SQL editor, run once. Safe to re-run (the
-- `create or replace function` makes it idempotent).
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

  -- share.first_view event still goes into app_events (006 trigger)
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
      'has_password_gate', v_share.require_password
    ),
    v_owner.id
  );

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
  -- Avatar letter — first character of the viewer email, uppercased.
  -- "?" for anonymous viewers (no email gate). Gives the email a human
  -- anchor without leaking any analytics.
  v_avatar_letter := upper(coalesce(nullif(substring(v_viewer.email from 1 for 1), ''), '?'));
  -- "Direct link" fallback if the recipient came via a paste/bookmark
  -- (document.referrer empty) — softer than blanking the field.
  -- Otherwise prettify the referrer to just the host (no path / query)
  -- so the viewer chip doesn't leak the sender's traffic source URL.
  v_referrer_label := coalesce(
    nullif(regexp_replace(coalesce(v_viewer.referrer, ''), '^https?://([^/]+).*$', '\1'), ''),
    'Direct link'
  );
  v_when_label := to_char(now() at time zone 'utc', 'Mon DD, HH24:MI') || ' UTC';
  v_dashboard_url := 'https://htmlradar.com/dashboard/' || v_share.slug;

  v_subject := format('%s opened %s', v_viewer_label, v_doc.title);

  -- Editorial template. Tease, don't dump. Single CTA back to the app.
  -- Inline styles only (email clients drop <style> blocks). Table outer
  -- scaffold for Outlook. Web-safe serif fallback (Georgia / Charter)
  -- so the Fraunces-style headline degrades gracefully when Gmail/
  -- Apple Mail decline to load Google Fonts inside the body.
  v_body := format($html$
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>%s</title>
</head>
<body style="margin:0;padding:0;background:#FBF1E8;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,Segoe UI,Roboto,sans-serif;color:#1F1108;-webkit-font-smoothing:antialiased;mso-line-height-rule:exactly;">
  <!-- preheader: shown as the email preview line, hidden in the body -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    %s just opened %s. Read it in HTMLRadar.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%%" style="background:#FBF1E8;padding:64px 16px 48px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;width:100%%;background:#FFFFFF;border:1px solid #E8D5BD;border-radius:18px;overflow:hidden;box-shadow:0 1px 0 rgba(31,17,8,0.04);">
          <!-- Brand pill, top-left -->
          <tr>
            <td style="padding:32px 36px 0 36px;">
              <span style="display:inline-block;background:#7A1F2E;color:#FBF1E8;font:600 11px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;text-transform:uppercase;letter-spacing:0.18em;padding:8px 13px;border-radius:999px;">HTMLRadar</span>
            </td>
          </tr>

          <!-- Kicker -->
          <tr>
            <td style="padding:28px 36px 0 36px;">
              <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.20em;text-transform:uppercase;color:#876959;">A new read</p>
            </td>
          </tr>

          <!-- Viewer chip: 40px avatar + email line. Personal anchor
               before the doc-title headline. The avatar is a single
               uppercase letter in cream on oxblood; round via 50%%
               border-radius (some Outlook builds drop this — degrades
               to a square chip, still readable). -->
          <tr>
            <td style="padding:18px 36px 0 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" width="40" height="40" align="center" style="background:#7A1F2E;color:#FBF1E8;font-family:Georgia,Charter,'Iowan Old Style',serif;font-size:17px;font-weight:500;border-radius:20px;line-height:40px;text-transform:uppercase;mso-line-height-rule:exactly;">
                    %s
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <p style="margin:0;font-size:14.5px;line-height:1.3;color:#1F1108;font-weight:500;">%s</p>
                    <p style="margin:2px 0 0 0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;letter-spacing:0.06em;color:#876959;">just opened &middot; %s</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Doc title — the visual hero. Italic oxblood serif. -->
          <tr>
            <td style="padding:18px 36px 0 36px;">
              <h1 style="margin:0;font-family:Georgia,Charter,'Iowan Old Style',serif;font-weight:400;font-style:italic;font-size:34px;line-height:1.12;letter-spacing:-0.022em;color:#7A1F2E;">
                %s
              </h1>
            </td>
          </tr>

          <!-- One-line context -->
          <tr>
            <td style="padding:22px 36px 0 36px;">
              <p style="margin:0;font-size:15.5px;line-height:1.55;color:#3A2818;">
                Hey %s — the how-long, how-far, and which-section details are waiting in the dashboard.
              </p>
            </td>
          </tr>

          <!-- Timestamp pill (the only fact we surface in the email) -->
          <tr>
            <td style="padding:20px 36px 0 36px;">
              <span style="display:inline-block;background:#FBF1E8;border:1px solid #E8D5BD;color:#3A2818;font:500 12px/1 ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;letter-spacing:0.06em;padding:7px 11px;border-radius:6px;">
                Read &middot; %s
              </span>
            </td>
          </tr>

          <!-- CTA — primary anchor of the email -->
          <tr>
            <td style="padding:30px 36px 36px 36px;">
              <a href="%s" style="display:inline-block;background:#7A1F2E;color:#FBF1E8;text-decoration:none;font-size:16px;font-weight:500;padding:15px 32px;border-radius:10px;letter-spacing:0.005em;box-shadow:0 1px 0 rgba(31,17,8,0.18),0 6px 14px -8px rgba(122,31,46,0.35);">
                See the read &rarr;
              </a>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;width:100%%;margin-top:22px;">
          <tr>
            <td align="center" style="padding:0 12px;">
              <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#876959;">
                HTMLRadar &middot; Document tracking, built for HTML
              </p>
              <p style="margin:8px 0 0 0;font-size:11.5px;color:#876959;line-height:1.5;">
                Sent because you have a tracked share at <a href="https://htmlradar.com/dashboard/%s" style="color:#876959;text-decoration:underline;">htmlradar.com/dashboard/%s</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
$html$,
    v_subject,                      -- <title>
    v_viewer_label, v_doc.title,    -- preheader
    v_avatar_letter,                -- avatar circle letter
    v_viewer_label,                 -- viewer chip email
    v_referrer_label,               -- viewer chip subtitle ("Direct link" or host)
    v_doc.title,                    -- doc-title headline (italic oxblood)
    v_owner_first,                  -- "Hey {name}"
    v_when_label,                   -- timestamp pill
    v_dashboard_url,                -- CTA href
    v_share.slug, v_share.slug      -- footer link text + href
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
