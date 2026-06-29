-- 028_notify_disabled_link_attempt.sql
-- ------------------------------------------------------------
-- Email the OWNER when a recipient tries to open a DISABLED link
-- (revoked or expired). DocSend parity: "someone came back to a link
-- you'd turned off" is a strong signal — the recipient is still
-- interested, and the owner may want to re-enable or extend.
--
-- Why this lives here (SQL) and not in the proxy: every other
-- owner-facing email already goes Resend-via-pg_net at the DB layer
-- (notify_on_first_open, 003/020/025). We mirror that exactly — same
-- Vault secrets, same notifications_log, same template shell — so the
-- proxy needs no new secret and there's one email path to reason about.
--
-- Why the PROXY calls it (not a trigger): a disabled open serves the
-- recipient an error shell and never loads the tracker, so NO session
-- row is ever written. The proxy is the only thing that knows the
-- attempt happened; it fire-and-forgets this RPC on the revoked/expired
-- branch (ctx.waitUntil) with the service-role key.
--
-- THROTTLE: a dead link gets refreshed / bot-hammered. We email at most
-- once per share per cooldown window (default 6h), tracked by
-- document_shares.last_disabled_notify_at, serialised by a per-share
-- advisory lock so two simultaneous opens can't double-send.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (add column if not exists + create or replace).
-- ------------------------------------------------------------

-- Step 1: per-share throttle timestamp (nullable = never alerted yet).
alter table document_shares
  add column if not exists last_disabled_notify_at timestamptz;

-- Step 2: the RPC. SECURITY DEFINER so it can read profiles + write
-- app_events / notifications_log + call pg_net, exactly like
-- notify_on_first_open. Returns void; never raises to the caller (the
-- proxy treats it as best-effort).
create or replace function notify_disabled_attempt(p_share_id uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_share document_shares%rowtype;
  v_doc documents%rowtype;
  v_owner profiles%rowtype;
  v_resend_key text;
  v_from text;
  v_payload jsonb;
  v_subject text;
  v_body text;
  v_request_id bigint;
  v_who text;
  v_reason_label text;
  v_action_label text;
  v_kicker text;
  v_when_label text;
  v_dashboard_url text;
  v_cooldown interval := interval '6 hours';
begin
  -- Only the two states the proxy reports. Anything else is a no-op.
  if p_kind not in ('revoked', 'expired') then
    return;
  end if;

  -- Serialise concurrent attempts on this share so two simultaneous
  -- opens can't both pass the throttle and double-send. Releases at
  -- xact end; deadlock-free (single key per transaction).
  perform pg_advisory_xact_lock(hashtext('disabled_notify:' || p_share_id::text));

  select * into v_share from document_shares where id = p_share_id;
  if not found then
    return;
  end if;

  -- Re-validate state server-side — never trust the caller. If the
  -- share is NOT actually in the claimed disabled state right now (the
  -- owner may have un-revoked or extended in the meantime), send nothing.
  if p_kind = 'revoked' and v_share.revoked_at is null then
    return;
  end if;
  if p_kind = 'expired'
     and (v_share.expires_at is null or v_share.expires_at > now()) then
    return;
  end if;

  -- Throttle: at most one disabled-attempt email per share per cooldown.
  if v_share.last_disabled_notify_at is not null
     and v_share.last_disabled_notify_at > now() - v_cooldown then
    return;
  end if;

  select * into v_doc from documents where id = v_share.document_id;
  select * into v_owner from profiles where id = v_share.owner_id;
  if v_owner.email is null then
    return;
  end if;

  -- Analytics signal (mirrors share.first_view). Fires once we've decided
  -- to alert (post-throttle), so the count == number of alerts, not clicks.
  insert into app_events (distinct_id, event, properties, user_id)
  values (
    v_owner.id::text,
    'share.disabled_open_attempt',
    jsonb_build_object(
      'slug', v_share.slug,
      'document_id', v_share.document_id,
      'recipient_label', v_share.recipient_label,
      'kind', p_kind
    ),
    v_owner.id
  );

  -- Resend config from Vault (same secrets as notify_on_first_open).
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
    values (null, v_owner.email, 'skipped', 'resend secrets not in Vault');
    -- Stamp the throttle anyway so a misconfigured instance doesn't
    -- re-attempt + re-log on every single refresh of the dead link.
    update document_shares set last_disabled_notify_at = now() where id = p_share_id;
    return;
  end if;

  -- Owner-authored, owner-bound copy (recipient_label + title are the
  -- owner's own text going to the owner's own inbox — same no-escape
  -- convention as notify_on_first_open).
  v_who := coalesce(nullif(v_share.recipient_label, ''), 'Someone');
  if p_kind = 'revoked' then
    v_kicker := 'Revoked link · attempted open';
    v_reason_label := 'turned off';
    v_action_label := 'Turn the link back on';
  else
    v_kicker := 'Expired link · attempted open';
    v_reason_label := 'past its expiry';
    v_action_label := 'Extend or re-send the link';
  end if;

  -- Timestamp in the owner's timezone (same dance as 020/025).
  perform set_config('TimeZone', coalesce(v_owner.timezone, 'UTC'), true);
  v_when_label := to_char(now(), 'Mon DD, HH24:MI TZ');

  v_dashboard_url := 'https://htmlradar.com/dashboard/' || v_share.slug;
  v_subject := format('%s tried to open "%s" — but the link is %s',
                      v_who, v_doc.title, v_reason_label);

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
        <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#876959;">%s</p>
      </td></tr>
      <tr><td style="padding:0 8px 6px 8px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:15px;color:#1F1108;font-weight:600;line-height:1.3;">%s tried to open</p>
      </td></tr>
      <tr><td style="padding:0 8px 18px 8px;">
        <p style="margin:0;font-family:'Newsreader',Georgia,serif;font-size:26px;line-height:1.2;color:#1F1108;font-weight:400;font-style:italic;letter-spacing:-0.01em;"><a href="%s" style="color:inherit;text-decoration:none;">&ldquo;%s&rdquo;</a></p>
      </td></tr>
      <tr><td style="padding:0 8px 26px 8px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:14.5px;line-height:1.55;color:#3A2818;">&hellip; but the link is currently <strong>%s</strong>, so they hit a closed door. <span style="color:#876959;">%s</span></p>
      </td></tr>
      <tr><td style="padding:0 8px 12px 8px;">
        <a href="%s" style="display:inline-block;background:#7A1F2E;color:#FBF1E8;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;font-size:14px;font-weight:600;padding:12px 22px;border-radius:6px;letter-spacing:0.01em;">%s &rarr;</a>
      </td></tr>
      <tr><td style="padding:24px 8px 0 8px;border-top:1px solid #E8D5BD;">
        <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;color:#876959;letter-spacing:0.02em;line-height:1.5;">Someone returning to a link you closed is usually still interested. You'll get at most one of these per link every few hours.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
$html$,
    v_subject,
    v_kicker,
    v_who,
    v_dashboard_url,
    v_doc.title,
    v_reason_label,
    v_when_label,
    v_dashboard_url,
    v_action_label
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
  values (null, v_owner.email, v_request_id, 'queued');

  update document_shares set last_disabled_notify_at = now() where id = p_share_id;
end;
$$;

-- Lock it down: only the proxy (service-role) may fire these. Without
-- the revoke, the default PUBLIC execute grant would let any anon /
-- authenticated caller POST to the RPC and spam an owner's inbox.
revoke all on function notify_disabled_attempt(uuid, text) from public;
grant execute on function notify_disabled_attempt(uuid, text) to service_role;

-- Make the new RPC callable immediately (PostgREST schema cache reload).
notify pgrst, 'reload schema';
