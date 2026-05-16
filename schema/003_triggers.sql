-- HTMLRadar — triggers
-- - enforce_doc_cap: blocks 21st document for free-tier users
-- - notify_on_first_open: dispatches Resend email when a new session is created
-- Apply AFTER 001_init.sql and 002_rpcs.sql.

-- ============================================================
-- enforce_doc_cap: free tier = 10 documents lifetime.
-- HARD CAP: deletes do NOT free slots. Once a free-tier user has
-- ever created 10 documents (deleted or not), the 11th raises P0030.
-- This is the conversion lever — without it the cap is symbolic
-- because heavy users rotate by deleting and reusing slots.
-- Pricing v2 (2026-05-12) lowered cap 20 → 10. Pricing v3
-- (2026-05-14) removed the slot-refund.
-- ============================================================
create or replace function enforce_doc_cap()
returns trigger language plpgsql as $$
declare
  v_tier text;
  v_count int;
  v_cap int := 10;
begin
  select tier into v_tier from profiles where id = new.owner_id;
  if v_tier = 'pro' then
    return new;
  end if;

  -- Serialise concurrent inserts per owner so two simultaneous uploads
  -- can't both see count=9 and pass the cap. The lock releases at xact
  -- end; deadlock-free because keyed on a single owner_id per transaction.
  perform pg_advisory_xact_lock(hashtext('doc_cap:' || new.owner_id::text));

  -- All documents ever created count, including soft-deleted ones.
  -- That's the lifetime-cap behaviour: free-tier users can't keep
  -- rotating slots forever.
  select count(*) into v_count from documents where owner_id = new.owner_id;
  if v_count >= v_cap then
    raise exception 'free_tier_cap_reached'
      using errcode = 'P0030',
            hint = format(
              'Free tier is %s documents lifetime. Upgrade to Pro for unlimited.',
              v_cap
            );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_doc_cap on documents;
create trigger trg_enforce_doc_cap
  before insert on documents
  for each row execute function enforce_doc_cap();

-- ============================================================
-- notifications_log
-- Audit trail for first-open emails. Trigger writes one row per send attempt;
-- a separate poller (or manual query) can join with `net._http_response` to
-- mark rows delivered or failed. Without this table, pg_net failures are
-- silent and unobservable.
-- ============================================================
create table if not exists notifications_log (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references sessions(id) on delete cascade,
  email_to        text not null,
  request_id      bigint,                                       -- pg_net.request_id, for join with net._http_response
  status          text not null default 'queued' check (status in ('queued','delivered','failed','skipped')),
  error_message   text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notifications_log_session on notifications_log (session_id);
create index if not exists idx_notifications_log_open on notifications_log (status, created_at) where status in ('queued','failed');

alter table notifications_log enable row level security;

drop policy if exists "notifications_log_owner_select" on notifications_log;
create policy "notifications_log_owner_select" on notifications_log
  for select to authenticated using (
    exists (
      select 1 from sessions sn
      join document_shares s on s.id = sn.share_id
      where sn.id = notifications_log.session_id and s.owner_id = auth.uid()
    )
  );

revoke all on notifications_log from anon;

-- ============================================================
-- notify_on_first_open
-- Fires the first time a session is created for a viewer.
-- Uses pg_net to POST to a Resend-compatible endpoint set in app settings.
-- Skips repeated opens within 5 minutes (dedup).
-- Writes to notifications_log for observability.
-- ============================================================
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

  -- Load related rows
  select * into v_share from document_shares where id = new.share_id;
  select * into v_viewer from viewers where id = new.viewer_id;
  select * into v_doc from documents where id = v_share.document_id;
  select * into v_owner from profiles where id = v_doc.owner_id;

  -- Pull Resend config from Supabase Vault (works on free tier — ALTER
  -- DATABASE SET would require superuser, which Supabase doesn't grant).
  -- Set the secrets once via:
  --   select vault.create_secret('re_xxx', 'resend_api_key');
  --   select vault.create_secret('hello@htmlradar.com', 'resend_from');
  begin
    select decrypted_secret into v_resend_key
    from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    select decrypted_secret into v_from
    from vault.decrypted_secrets where name = 'resend_from' limit 1;
  exception when others then
    -- Vault schema not available (older Supabase / self-host); fall back.
    v_resend_key := null;
    v_from := null;
  end;
  if v_resend_key is null or v_from is null then
    insert into notifications_log (session_id, email_to, status, error_message)
    values (new.id, v_owner.email, 'skipped', 'resend secrets not in Vault');
    return new;
  end if;

  v_subject := format('Someone opened "%s"', v_doc.title);
  v_body := format(
    '<p>Hi,</p><p><strong>%s</strong> just opened <strong>%s</strong>.</p>'
    || '<ul><li>Recipient: %s</li><li>Country: %s</li><li>Device: %s</li></ul>'
    || '<p><a href="https://htmlradar.com/dashboard/%s">View analytics &rarr;</a></p>'
    || '<p style="color:#888;font-size:12px;">— HTMLRadar</p>',
    coalesce(v_viewer.email, 'an anonymous viewer'),
    v_doc.title,
    coalesce(v_share.recipient_label, '—'),
    coalesce(v_viewer.country_code, '—'),
    coalesce(v_viewer.device_type, '—'),
    v_share.slug
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

drop trigger if exists trg_notify_on_first_open on sessions;
create trigger trg_notify_on_first_open
  after insert on sessions
  for each row execute function notify_on_first_open();
