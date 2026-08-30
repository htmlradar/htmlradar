-- HTMLRadar — initial schema
-- Apply in order: 001_init.sql, 002_rpcs.sql, 003_triggers.sql
-- Requires Supabase project with auth.users available.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid, hmac, digest
create extension if not exists "pg_net";     -- async http for email triggers

-- ============================================================
-- profiles: mirrors auth.users, adds tier + display fields
-- ============================================================
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  display_name    text,
  tier            text not null default 'free' check (tier in ('free', 'pro')),
  created_at      timestamptz not null default now(),
  pro_since       timestamptz,
  pro_until       timestamptz
);

create index if not exists idx_profiles_email on profiles (lower(email));

-- Auto-create profile on auth.users insert
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- documents: a piece of content the user uploads or links
-- ============================================================
create table if not exists documents (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  source_type       text not null check (source_type in ('upload', 'url')),
  source_url        text,                       -- nullable: present when source_type='url'
  current_version   integer not null default 1, -- bumps when re-uploaded
  r2_key            text,                       -- 'docs/{user_id}/{doc_id}/v{N}.html' when uploaded
  retention_days    integer not null default 365,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,                -- soft delete
  config            jsonb not null default '{}'::jsonb,
  -- A document is either an upload (has r2_key) or a URL (has source_url), not both:
  constraint chk_source check (
    (source_type = 'upload' and r2_key is not null and source_url is null) or
    (source_type = 'url' and source_url is not null and r2_key is null)
  )
);

create index if not exists idx_documents_owner on documents (owner_id) where deleted_at is null;
create index if not exists idx_documents_created on documents (created_at desc);

-- ============================================================
-- document_shares: per-recipient tracked links
-- One document, many shares. Each with own gate/password/expiry/revoke.
-- ============================================================
create table if not exists document_shares (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents(id) on delete cascade,
  owner_id            uuid not null references auth.users(id) on delete cascade,
  slug                text not null unique,
  recipient_label     text,                          -- "Marc at Example Ventures" (optional)
  require_email       boolean not null default true,
  require_password    boolean not null default false,
  password_hash       text,                          -- bcrypt/argon2 hash
  allowed_email_domains text[],                      -- e.g. {'example.com'} — nullable = any
  expires_at          timestamptz,                   -- nullable = no expiry
  revoked_at          timestamptz,                   -- nullable = not revoked
  created_at          timestamptz not null default now(),
  config              jsonb not null default '{}'::jsonb,
  constraint chk_password_pair check (
    (require_password = false) or (require_password = true and password_hash is not null)
  )
);

create index if not exists idx_shares_doc on document_shares (document_id);
create index if not exists idx_shares_owner on document_shares (owner_id);
create index if not exists idx_shares_slug on document_shares (slug);

-- ============================================================
-- viewers: identified recipients (by email or anonymous fingerprint)
-- Scoped per share so the same email viewing two shares = two viewer rows.
-- ============================================================
create table if not exists viewers (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references document_shares(id) on delete cascade,
  email           text,
  fingerprint     text,                         -- for anonymous mode (random uuid in localStorage)
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  visit_count     integer not null default 1,
  user_agent      text,
  referrer        text,
  country_code    text,                          -- ISO 3166-1 alpha-2, populated by proxy
  city            text,
  device_type     text,                          -- 'mobile' | 'tablet' | 'desktop'
  os              text,
  browser         text,
  constraint chk_identity check (email is not null or fingerprint is not null)
);

create unique index if not exists idx_viewers_share_email on viewers (share_id, lower(email)) where email is not null;
create unique index if not exists idx_viewers_share_fp on viewers (share_id, fingerprint) where fingerprint is not null;
create index if not exists idx_viewers_share on viewers (share_id);

-- ============================================================
-- sessions: one row per page-open
-- ============================================================
create table if not exists sessions (
  id                    uuid primary key default gen_random_uuid(),
  share_id              uuid not null references document_shares(id) on delete cascade,
  viewer_id             uuid not null references viewers(id) on delete cascade,
  document_version      integer not null,             -- version they actually saw (for forensics post-update)
  -- Per-session bearer token returned from start_session, presented by the
  -- tracker on every update. 32-byte random hex; uniqueness comes from the
  -- session_id FK so we don't need a separate unique index. This replaces
  -- an HMAC-with-shared-secret scheme that required `ALTER DATABASE SET`
  -- (blocked on Supabase free tier — needs superuser).
  token                 text not null default encode(gen_random_bytes(32), 'hex'),
  started_at            timestamptz not null default now(),
  last_heartbeat_at     timestamptz not null default now(),
  active_time_seconds   integer not null default 0 check (active_time_seconds between 0 and 86400),
  max_scroll_depth      real    not null default 0 check (max_scroll_depth between 0 and 1),
  bounced               boolean generated always as (max_scroll_depth < 0.05) stored,
  notification_sent_at  timestamptz                    -- for dedup of view notifications
);

create index if not exists idx_sessions_share on sessions (share_id, started_at desc);
create index if not exists idx_sessions_viewer on sessions (viewer_id, started_at desc);

-- ============================================================
-- section_events: section-level dwell records
-- ============================================================
create table if not exists section_events (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions(id) on delete cascade,
  section_id      text not null,
  section_title   text,
  depth           integer,                          -- 1/2/3 for h1/h2/h3
  ordinal         integer,                          -- DOM position at first observation
  time_seconds    real not null default 0 check (time_seconds between 0 and 86400),
  entered_at      timestamptz not null default now(),
  unique (session_id, section_id)
);

create index if not exists idx_section_session on section_events (session_id);

-- ============================================================
-- waitlist: v1.1 paid feature interest capture
-- ============================================================
create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text,                                  -- 'cap_hit' | 'pricing_page' | other
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists idx_waitlist_email on waitlist (lower(email));

-- ============================================================
-- Rate limiting table (for RPC abuse prevention)
-- ============================================================
create table if not exists rate_limits (
  key         text primary key,                       -- e.g. 'ip:1.2.3.4:start_session'
  window_at   timestamptz not null default now(),
  count       integer not null default 1
);

create index if not exists idx_rate_limits_window on rate_limits (window_at);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles          enable row level security;
alter table documents         enable row level security;
alter table document_shares   enable row level security;
alter table viewers           enable row level security;
alter table sessions          enable row level security;
alter table section_events    enable row level security;
alter table waitlist          enable row level security;
alter table rate_limits       enable row level security;

-- profiles: owner sees own, can update display_name only
drop policy if exists "profiles_owner_select" on profiles;
create policy "profiles_owner_select" on profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_owner_update" on profiles;
create policy "profiles_owner_update" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- documents: owner sees own. Anon: no direct access (proxy uses service-role).
drop policy if exists "documents_owner_all" on documents;
create policy "documents_owner_all" on documents
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- document_shares: owner manages own. No anon access.
drop policy if exists "shares_owner_all" on document_shares;
create policy "shares_owner_all" on document_shares
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- viewers/sessions/section_events: owner reads via share ownership. Writes via RPCs only.
drop policy if exists "viewers_owner_select" on viewers;
create policy "viewers_owner_select" on viewers
  for select to authenticated using (
    exists (select 1 from document_shares s where s.id = viewers.share_id and s.owner_id = auth.uid())
  );

drop policy if exists "sessions_owner_select" on sessions;
create policy "sessions_owner_select" on sessions
  for select to authenticated using (
    exists (select 1 from document_shares s where s.id = sessions.share_id and s.owner_id = auth.uid())
  );

drop policy if exists "section_events_owner_select" on section_events;
create policy "section_events_owner_select" on section_events
  for select to authenticated using (
    exists (
      select 1 from sessions sn
      join document_shares s on s.id = sn.share_id
      where sn.id = section_events.session_id and s.owner_id = auth.uid()
    )
  );

-- waitlist: anon can insert (cap-hit form). Nothing else.
drop policy if exists "waitlist_anon_insert" on waitlist;
create policy "waitlist_anon_insert" on waitlist
  for insert to anon with check (true);

-- rate_limits: locked down to service-role only (RPCs)
-- (no policies = no access for anon/authenticated)

-- ============================================================
-- Explicit REVOKEs so anon cannot bypass RLS via PostgREST
-- All viewer-side writes go through SECURITY DEFINER RPCs (see 002_rpcs.sql).
-- ============================================================
revoke insert, update, delete on viewers, sessions, section_events from anon;
revoke select, insert, update, delete on documents, document_shares, profiles from anon;
revoke all on rate_limits from anon, authenticated;
