-- 006_observability.sql — analytics + error + feedback capture
--
-- Three tables, three pg_net triggers, three RLS policies. Schema is
-- PostHog-compatible (distinct_id / event / properties / timestamp) so
-- we can replay app_events into PostHog later without remodeling.
--
-- Apply AFTER 005_security_followup.sql.

-- ============================================================
-- app_events: PostHog-compatible event capture
-- ============================================================
-- Why PostHog-shaped: when (if) we wire PostHog Cloud later, we replay
-- this table via /capture/ in one batch. No schema migration needed.
create table if not exists app_events (
  id            bigserial primary key,
  distinct_id   text not null,                       -- user.id or anon fingerprint
  event         text not null,                       -- 'user.signed_up', 'document.created', etc.
  properties    jsonb not null default '{}'::jsonb,  -- arbitrary event metadata
  timestamp     timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete set null
);

create index if not exists idx_app_events_distinct_id on app_events (distinct_id);
create index if not exists idx_app_events_event       on app_events (event);
create index if not exists idx_app_events_timestamp   on app_events (timestamp desc);
create index if not exists idx_app_events_user_id     on app_events (user_id) where user_id is not null;

-- Row-level security: service-role writes, owner reads own
alter table app_events enable row level security;

drop policy if exists app_events_service_all on app_events;
create policy app_events_service_all on app_events
  for all to service_role using (true) with check (true);

drop policy if exists app_events_owner_select on app_events;
create policy app_events_owner_select on app_events
  for select to authenticated
  using (user_id = auth.uid());

-- Anon clients can INSERT their own events (page views, etc.) but not read
drop policy if exists app_events_anon_insert on app_events;
create policy app_events_anon_insert on app_events
  for insert to anon
  with check (user_id is null);

-- ============================================================
-- error_log: client-side JS errors + server-side fatal errors
-- ============================================================
create table if not exists error_log (
  id            bigserial primary key,
  timestamp     timestamptz not null default now(),
  source        text not null,                        -- 'client', 'server', 'worker'
  message       text not null,
  stack         text,
  url           text,
  user_agent    text,
  user_id       uuid references auth.users(id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb
);

create index if not exists idx_error_log_timestamp on error_log (timestamp desc);
create index if not exists idx_error_log_source    on error_log (source);
create index if not exists idx_error_log_user_id   on error_log (user_id) where user_id is not null;

alter table error_log enable row level security;

drop policy if exists error_log_service_all on error_log;
create policy error_log_service_all on error_log
  for all to service_role using (true) with check (true);

-- Anon clients write errors (we ingest from /api/errors)
drop policy if exists error_log_anon_insert on error_log;
create policy error_log_anon_insert on error_log
  for insert to anon with check (true);

-- ============================================================
-- feedback: user-submitted feedback from /feedback page
-- ============================================================
create table if not exists feedback (
  id            bigserial primary key,
  timestamp     timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete set null,
  email         text,                                  -- optional email if user not signed in
  body          text not null,
  page          text,                                  -- where they were when they submitted
  user_agent    text,
  resolved      boolean not null default false,
  notes         text                                   -- founder's notes after triage
);

create index if not exists idx_feedback_timestamp on feedback (timestamp desc);
create index if not exists idx_feedback_resolved  on feedback (resolved);

alter table feedback enable row level security;

drop policy if exists feedback_service_all on feedback;
create policy feedback_service_all on feedback
  for all to service_role using (true) with check (true);

-- Anyone can submit feedback
drop policy if exists feedback_anon_insert on feedback;
create policy feedback_anon_insert on feedback
  for insert to anon with check (true);
drop policy if exists feedback_auth_insert on feedback;
create policy feedback_auth_insert on feedback
  for insert to authenticated with check (true);

-- Only the founder can read feedback (gated in app code via auth.uid)
drop policy if exists feedback_owner_select on feedback;
create policy feedback_owner_select on feedback
  for select to authenticated using (false);  -- gated at API level via service_role

-- ============================================================
-- Trigger: email founder on new feedback submission
-- Uses pg_net same pattern as the first-read notifications.
-- ============================================================
create or replace function notify_on_feedback()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_subject text;
  v_body    text;
begin
  v_subject := 'HTMLRadar feedback from ' || coalesce(new.email, 'anonymous');
  v_body := format(
    'New feedback received at %s.%sFrom: %s%sPage: %s%sUser-Agent: %s%s%s%s%s---%sFeedback row id: %s',
    new.timestamp,
    chr(10), coalesce(new.email, '(anonymous)'),
    chr(10), coalesce(new.page, '(unknown)'),
    chr(10), coalesce(new.user_agent, '(unknown)'),
    chr(10), chr(10),
    new.body,
    chr(10),
    chr(10),
    new.id
  );

  -- Vault secret name matches 003_triggers.sql convention: lowercase
  -- `resend_api_key`. Mismatched casing makes the trigger silently fail
  -- (decrypted_secret returns null → Bearer with empty token → 401).
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1)
    ),
    body := jsonb_build_object(
      'from',    'HTMLRadar feedback <notifications@htmlradar.com>',
      'to',      array['hello@htmlradar.com'],
      'subject', v_subject,
      'text',    v_body
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_on_feedback on feedback;
create trigger trg_notify_on_feedback
  after insert on feedback
  for each row execute function notify_on_feedback();

-- ============================================================
-- Extend notify_on_first_open() (defined in 003) to also write a
-- share.first_view event into app_events.
--
-- Why here and not in 003: 003 doesn't know about app_events (table is
-- introduced in this migration). Re-defining the function below is
-- idempotent (create or replace) so it's safe to apply in any order.
-- The original Resend pg_net call is preserved 1:1; this version just
-- inserts an app_events row before the email path.
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

  select * into v_share from document_shares where id = new.share_id;
  select * into v_viewer from viewers where id = new.viewer_id;
  select * into v_doc from documents where id = v_share.document_id;
  select * into v_owner from profiles where id = v_doc.owner_id;

  -- share.first_view event — the product's most important metric
  -- ("% of shares actually opened") is queryable from the same place
  -- as every other event.
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

  v_subject := format('%s opened "%s"', coalesce(v_viewer.email, 'Someone'), v_doc.title);
  v_body := format(
    '<p><strong>%s</strong> opened <strong>%s</strong>.</p>'
    || '<ul style="padding-left:18px;margin:12px 0;">'
    || '<li>Share label: %s</li>'
    || '<li>Country: %s</li>'
    || '<li>Device: %s</li>'
    || '</ul>'
    || '<p><a href="https://htmlradar.com/dashboard/%s" style="color:#7A1F2E;">See section-level read &rarr;</a></p>'
    || '<p style="color:#888;font-size:12px;margin-top:18px;">— HTMLRadar</p>',
    coalesce(v_viewer.email, 'An anonymous viewer'),
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

-- ============================================================
-- Helper view: recent events for the /admin/events page
-- Filtered to the last 7 days; founder reads via service role.
--
-- `security_invoker = on` makes the view honour the caller's RLS on
-- app_events + auth.users (avoids Supabase Advisor "Security Definer
-- View" + "Exposed Auth Users" findings). Anon never gets here (revoked
-- below). Authenticated users querying directly would only see their
-- own events via app_events_owner_select RLS.
-- ============================================================
drop view if exists recent_events;

create view recent_events with (security_invoker = on) as
select
  e.id,
  e.timestamp,
  e.event,
  e.distinct_id,
  e.properties,
  e.user_id,
  u.email as user_email
from app_events e
left join auth.users u on u.id = e.user_id
where e.timestamp >= now() - interval '7 days'
order by e.timestamp desc;

-- security_invoker=on means the caller's grants are checked when the
-- view joins auth.users. Service role needs an explicit grant.
grant select on auth.users to service_role;

revoke all on recent_events from anon, public;
grant select on recent_events to authenticated, service_role;

-- =============================================================
-- Comment block: how to use this schema
-- =============================================================
-- Server-side (from Next.js server actions or Cloudflare Worker):
--   insert into app_events (distinct_id, event, properties, user_id)
--   values ('user-uuid', 'document.created', '{"source_type":"upload"}'::jsonb, 'user-uuid');
--
-- Client-side (from browser via Supabase anon key):
--   await supabase.from('app_events').insert({
--     distinct_id: fingerprint, event: 'page.viewed',
--     properties: { path: location.pathname }
--   });
--
-- Reading (founder admin only, via service role):
--   select * from recent_events limit 50;
--
-- PostHog migration when ready:
--   export to JSONL, batch-send to https://app.posthog.com/capture/
--   format: { distinct_id, event, properties, timestamp }
