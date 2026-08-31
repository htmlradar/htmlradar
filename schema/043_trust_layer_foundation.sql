-- 043_trust_layer_foundation.sql
-- ------------------------------------------------------------
-- The database half of the trust layer: per-customer handles, the permanent
-- claim registry behind them, the per-share hostname the router follows, and
-- the private lookup the proxy reads instead of three separate tables.
--
-- The design this implements is
--   docs/workstreams/content-domain/TRUST-LAYER-DESIGN-2026-08-31.md
-- (revised after Sol's review, 31 August 2026). Read "Handles" and "Which host
-- serves what" before changing anything here.
--
-- WHAT A HANDLE IS, AND WHAT IT IS NOT
--
-- Every account gets a subdomain label, so a tracked link can be served from
-- `{handle}.htmlradar.page` instead of the shared apex. Google Safe Browsing
-- and Microsoft SmartScreen flag a bad page at the address, then at the host,
-- and only then at the whole registrable domain. Per-customer hosts do not
-- isolate customers from each other — a domain-wide warning still reaches
-- everyone — but a warning scoped to ONE HOSTNAME damages one customer instead
-- of all of them. That is the whole benefit, and nothing we say to customers
-- should claim more.
--
-- A handle is a routing and reputation boundary. It is NOT an identity check
-- and it verifies nothing about who the sender is.
--
-- WHY THIS IS ENFORCED IN THE DATABASE AND NOT IN TYPESCRIPT
--
-- Same reason 032 and 033 spell out: row-level security scopes ROWS, not
-- COLUMNS or VALUES. A signed-in customer can PATCH their own profile row and
-- their own share rows straight through PostgREST with the public anon key and
-- never touch a line of our application code. 032 already narrowed the profile
-- write grant to `(display_name, timezone)`, so `handle` is unreachable that
-- way today — but `document_shares` still carries a table-level grant, so
-- `host_handle` genuinely is reachable, and a customer who could write it
-- freely could have their document served on `microsoft.htmlradar.page` and
-- poison a name they do not own. The triggers below are the control. Any
-- application check written later is for the error message only.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not allocate a single handle. Allocation — deriving a base from the
-- account, shortening it on collision, falling back to a generated name — is
-- application code in a later lane. This file creates the column, the format
-- rule, the availability rule and the claim record, so that whatever allocates
-- cannot allocate something unsafe. Every handle and every host_handle is null
-- after this runs, and the product behaves exactly as it does today.
--
-- Nor does it backfill `host_handle` onto existing shares. That backfill was
-- cancelled by Sol's fifth finding: every link already in somebody's inbox
-- keeps being served on the apex, forever.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create-table-if-not-exists + add-column-if-not-exists + drop-if-exists +
-- create-or-replace + an ON CONFLICT DO NOTHING seed).
--
-- ORDERING: run this AFTER 001 (profiles, document_shares, documents) and
-- after 032 (the profiles column grants this relies on).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. handle_registry — the permanent record of every name that is spoken for
--
-- A profile row is deleted with its authentication account (`on delete
-- cascade` from auth.users). If availability were decided by "is this handle
-- on some profile row", a deleted account would silently release its name and
-- the next signup could inherit an old one's links, its reputation, and any
-- Safe Browsing history attached to its hostname. So the claim outlives the
-- profile: rows here are never deleted, only stamped `released_at`.
--
-- Reserved names live here too, as rows with `claimed_by` null. That is the
-- whole reason this is a table and not an array inside a function: the rule is
-- "any row here means unavailable", so reserving one more name is an INSERT,
-- not a migration that rewrites a function body.
--
-- No foreign key on `claimed_by`. A key to profiles or auth.users would
-- cascade the row away on account deletion, which is the exact failure this
-- table exists to prevent. The value is the account that held the name, kept
-- as a plain uuid on purpose.
--
-- RLS is deny-all with no policies, the same posture as abuse_reports (037),
-- telegram_outbox (038) and radar_items (042). Nothing customer-facing has any
-- business reading which names are taken — that would be a free enumeration of
-- who our customers are. The claim is written by the SECURITY DEFINER trigger
-- below, which owns the table and therefore bypasses this.
-- ------------------------------------------------------------
create table if not exists public.handle_registry (
  -- The name itself is the key. The primary-key index IS the race resolution:
  -- two accounts claiming the same handle at the same instant both try to
  -- insert, one commits, the other blocks and then fails with 23505, which the
  -- trigger below turns into handle_unavailable. No advisory lock needed.
  handle      text primary key,
  -- The account that holds it. Null on a reserved name — nobody holds those
  -- and nobody ever can.
  claimed_by  uuid,
  -- When it was claimed. Null on a reserved name.
  claimed_at  timestamptz,
  -- Stamped when the holding profile is deleted. The row STAYS, so the name
  -- stays unavailable; this column only records that the holder is gone, which
  -- is what support needs to answer "why can I not have this name".
  released_at timestamptz
);

comment on table public.handle_registry is
  'Every subdomain label that is spoken for: reserved names (claimed_by null) and names allocated to accounts. Rows are never deleted — a retired handle stays unavailable so a new account can never inherit an old one''s hostname reputation. Deny-all RLS; written by the claim_profile_handle trigger.';
comment on column public.handle_registry.claimed_by is
  'The account holding this handle, or null for a reserved name. Deliberately NOT a foreign key: a key would cascade this row away on account deletion, which is the failure this table exists to prevent.';
comment on column public.handle_registry.released_at is
  'Set when the holding profile row was deleted. The claim itself is permanent regardless; this is a record, not a release.';

alter table public.handle_registry enable row level security;
revoke all on public.handle_registry from anon, authenticated;

-- ------------------------------------------------------------
-- 2. The reserved names
--
-- Three groups, per the design:
--
--   (a) The impersonation bait already reserved for link endings in 033. A
--       memorable name on our own domain serving sender-supplied HTML is a
--       better phishing tool than a random one, and a hostname reads as more
--       official than a path segment does.
--   (b) Infrastructure names a wildcard record makes dangerous, plus the
--       RFC 2142 mailbox names, because `*.htmlradar.page` means every one of
--       these resolves the moment somebody claims it.
--   (c) Imitations of HTMLRadar itself and of the providers whose sign-in
--       pages are the usual targets of credential phishing. ASCII-only
--       matching stops Unicode and Punycode lookalikes, but nothing about
--       `html-radar` or `micros0ft` — which is why the list has to name them
--       rather than lean on the character set.
--
-- This list is a speed bump, not the control. The controls are the strip on
-- every document, the report form, the upload screen and Safe Browsing. It is
-- deliberately incomplete and deliberately additive: reserving another name
-- later is one INSERT against this table.
--
-- Names shorter than three characters (`r`, `f`, `m`) cannot pass the format
-- rule below anyway. They are seeded regardless, so the reason a name is
-- refused stays the same reason no matter which rule happens to catch it.
-- ------------------------------------------------------------
insert into public.handle_registry (handle)
values
  -- (a) impersonation bait, carried over from 033
  ('login'), ('signin'), ('sign-in'), ('signup'), ('sign-up'), ('logout'),
  ('support'), ('verify'), ('verification'), ('account'), ('accounts'),
  ('billing'), ('payment'), ('payments'), ('invoice'), ('invoices'),
  ('secure'), ('security'), ('admin'), ('administrator'), ('auth'), ('email'),
  ('password'), ('reset'), ('confirm'), ('unsubscribe'), ('m'), ('_doc'),

  -- (b) infrastructure a wildcard makes dangerous, and the RFC 2142 mailboxes
  ('www'), ('mail'), ('smtp'), ('imap'), ('pop'), ('mx'), ('ns'), ('ns1'),
  ('ns2'), ('dns'), ('api'), ('app'), ('apps'), ('cdn'), ('assets'),
  ('static'), ('media'), ('img'), ('images'), ('status'), ('docs'), ('doc'),
  ('drive'), ('share'), ('shares'), ('files'), ('file'), ('download'),
  ('downloads'), ('upload'), ('uploads'), ('r'), ('f'), ('v1'), ('v2'),
  ('dev'), ('staging'), ('stage'), ('test'), ('qa'), ('preview'), ('demo'),
  ('sandbox'), ('local'), ('localhost'), ('internal'), ('private'),
  ('public'), ('root'), ('system'), ('host'), ('proxy'), ('gateway'),
  ('webmail'), ('postmaster'), ('hostmaster'), ('webmaster'), ('noreply'),
  ('no-reply'), ('abuse'), ('info'), ('help'), ('contact'), ('sales'),
  ('marketing'), ('press'), ('legal'), ('privacy'), ('terms'), ('trust'),
  ('blog'), ('news'), ('careers'), ('jobs'), ('about'), ('pricing'),
  ('well-known'), ('metrics'), ('monitor'), ('health'), ('ping'),

  -- (c1) HTMLRadar imitating itself
  ('htmlradar'), ('html-radar'), ('htmlradars'), ('htmlradar-app'),
  ('htmlradar-support'), ('htmlradar-security'), ('htmlradar-billing'),
  ('htmlradar-team'), ('htmlradar-help'), ('htmlradar-com'),
  ('htmlradar-page'), ('radar'), ('official'), ('team'), ('staff'),
  ('draconic'),

  -- (c2) the providers a fake sign-in page usually imitates
  ('microsoft'), ('micros0ft'), ('ms'), ('msft'), ('office'), ('office365'),
  ('outlook'), ('onedrive'), ('sharepoint'), ('azure'), ('windows'),
  ('google'), ('g00gle'), ('gmail'), ('gdrive'), ('googledrive'), ('gsuite'),
  ('workspace'), ('apple'), ('icloud'), ('appleid'), ('itunes'),
  ('paypal'), ('pay-pal'), ('stripe'), ('visa'), ('mastercard'), ('amex'),
  ('amazon'), ('aws'), ('amazonaws'), ('dropbox'), ('box'), ('adobe'),
  ('acrobat'), ('docusign'), ('docsend'), ('hellosign'), ('dropboxsign'),
  ('meta'), ('facebook'), ('instagram'), ('whatsapp'), ('linkedin'),
  ('slack'), ('zoom'), ('notion'), ('salesforce'), ('github'), ('gitlab'),
  ('atlassian'), ('cloudflare'), ('supabase'), ('openai'), ('anthropic'),
  ('claude'), ('chatgpt'), ('netflix'), ('coinbase'), ('binance'),
  ('revolut'), ('wise'), ('chase'), ('hsbc'), ('barclays'), ('citi'),
  ('santander'), ('wellsfargo')
on conflict (handle) do nothing;

-- ------------------------------------------------------------
-- 3. profiles.handle
--
-- Nullable: null until a later lane allocates one, and null forever on a
-- self-hosted install that never turns handle links on.
--
-- The format rule is the design's, character for character:
--   3 to 24 characters, lowercase letters, digits and hyphens, starting and
--   ending with a letter or digit, and no two hyphens in a row.
--
-- The no-double-hyphen clause is what bans a `xn--` prefix, and therefore
-- every Punycode-encoded Unicode lookalike, without a second rule: `xn--`
-- cannot appear without `--` appearing.
--
-- No column grant is added for `authenticated`. 032 revoked the table-level
-- UPDATE and re-granted only `(display_name, timezone)`, and a column added
-- afterwards inherits no grant, so this column is already unwritable through
-- PostgREST. The trigger below is the second line, not the first.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists handle text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_handle_key'
  ) then
    alter table public.profiles add constraint profiles_handle_key unique (handle);
  end if;
end $$;

alter table public.profiles
  drop constraint if exists chk_profiles_handle_format;

alter table public.profiles
  add constraint chk_profiles_handle_format check (
    handle is null
    or (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$' and handle not like '%--%')
  );

comment on column public.profiles.handle is
  'The account''s subdomain label: links are served from {handle}.htmlradar.page. Allocated once by application code, immutable afterwards, and claimed permanently in handle_registry. A routing and reputation boundary — NOT an identity claim about the sender.';

-- ------------------------------------------------------------
-- 4. Claiming a handle, and never letting go of it
--
-- One BEFORE trigger does three things: refuses a name somebody else has or
-- that is reserved, refuses to let an allocated name change, and writes the
-- permanent claim. The insert IS the availability check — the primary key
-- decides it, so two concurrent allocations of the same name cannot both win
-- and no lock is taken.
--
-- SECURITY DEFINER so it can write handle_registry, whose RLS is deny-all.
-- `update of handle` so an ordinary settings save (display_name, timezone)
-- does not pay for any of this.
-- ------------------------------------------------------------
create or replace function public.claim_profile_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Links carrying this name are already in inboxes. Changing it would strand
  -- them, and freeing it would let the next account inherit them.
  if tg_op = 'UPDATE' and old.handle is not null
     and new.handle is distinct from old.handle then
    raise exception 'handle_immutable'
      using errcode = 'P0040',
            hint = 'An account''s handle is permanent — links already sent use it as their address.';
  end if;

  if new.handle is null then
    return new;
  end if;

  begin
    insert into handle_registry (handle, claimed_by, claimed_at)
    values (new.handle, new.id, now());
  exception when unique_violation then
    -- Something already holds the name: a reserved row, another account's live
    -- claim, or a retired claim from a deleted account. All three are refused
    -- identically. The one tolerated case is this same account re-asserting
    -- the claim it already holds, which is what re-running a backfill or an
    -- idempotent write looks like.
    if not exists (
      select 1 from handle_registry
      where handle = new.handle and claimed_by = new.id and released_at is null
    ) then
      raise exception 'handle_unavailable'
        using errcode = 'P0041',
              hint = 'That handle is not available. Please choose another.';
    end if;
  end;

  return new;
end;
$$;

drop trigger if exists trg_claim_profile_handle on public.profiles;
create trigger trg_claim_profile_handle
  before insert or update of handle on public.profiles
  for each row execute function public.claim_profile_handle();

-- The profile is gone; the claim is not. Stamping released_at here is
-- bookkeeping — the row surviving is what keeps the name unavailable — but
-- without it nothing records that the holder ever went away, and support
-- cannot tell a reserved name from a retired one.
create or replace function public.release_profile_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.handle is not null then
    update handle_registry
       set released_at = now()
     where handle = old.handle
       and claimed_by = old.id
       and released_at is null;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_release_profile_handle on public.profiles;
create trigger trg_release_profile_handle
  after delete on public.profiles
  for each row execute function public.release_profile_handle();

-- ------------------------------------------------------------
-- 5. document_shares.host_handle — the hostname the router follows
--
-- Null on every share that exists today, and null forever on those shares:
-- they are served on the apex, no redirect, no moved link. Set only when a
-- share is created after handle links are switched on.
--
-- ROUTING FOLLOWS THIS VALUE, NEVER THE OWNER'S CURRENT HANDLE. That is what
-- keeps "already-sent links never move" true when an owner is given a handle
-- later, and it is why the first draft's backfill was cancelled.
--
-- Two rules, both trigger-enforced because `authenticated` still holds a
-- table-level UPDATE grant on document_shares:
--
--   Immutable once set. A share whose hostname could change is a link that
--   can be made to 404 — or be moved onto a host the recipient did not expect.
--
--   It must be the owner's own handle at the moment it is set. Without this,
--   a customer PATCHes host_handle to `microsoft` through PostgREST, and the
--   router — which checks the request's hostname against THIS COLUMN — happily
--   serves their document on microsoft.htmlradar.page. That is the exact
--   reputation-poisoning the per-share hostname was introduced to prevent
--   (design property P10), so it is checked here rather than in the route.
-- ------------------------------------------------------------
alter table public.document_shares
  add column if not exists host_handle text;

alter table public.document_shares
  drop constraint if exists chk_shares_host_handle_format;

alter table public.document_shares
  add constraint chk_shares_host_handle_format check (
    host_handle is null
    or (host_handle ~ '^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$' and host_handle not like '%--%')
  );

comment on column public.document_shares.host_handle is
  'The hostname label this link was created for: null means it is served on the apex forever, a value means {host_handle}.htmlradar.page. Immutable, and required to equal the owner''s handle when set. Routing follows THIS column, never profiles.handle, so an already-sent link never moves.';

create or replace function public.validate_share_host_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.host_handle is not null
     and new.host_handle is distinct from old.host_handle then
    raise exception 'host_handle_immutable'
      using errcode = 'P0042',
            hint = 'A link''s hostname cannot be changed after the link is created.';
  end if;

  if new.host_handle is not null
     and (tg_op = 'INSERT' or old.host_handle is null)
     and new.host_handle is distinct from
         (select handle from profiles where id = new.owner_id) then
    raise exception 'host_handle_not_owned'
      using errcode = 'P0043',
            hint = 'A link can only be created on its own account''s handle.';
  end if;

  return new;
end;
$$;

-- Trigger name order against 027's cap trigger and 033's slug trigger does not
-- matter: this one returns immediately when host_handle is null, which is every
-- path a customer sees an error message from today.
drop trigger if exists trg_validate_share_host_handle on public.document_shares;
create trigger trg_validate_share_host_handle
  before insert or update of host_handle on public.document_shares
  for each row execute function public.validate_share_host_handle();

-- ------------------------------------------------------------
-- 6. share_lookup — the one read the proxy makes
--
-- The proxy needs the share's stored hostname BEFORE it checks the gate
-- cookies, because rule 3 ("a handle host that does not match the share's
-- stored hostname is not found") has to answer before anything else does. It
-- also needs the document and the owner's tier, which are two more round trips
-- today. This view collapses all three into one.
--
-- The private-view pattern from 006: `security_invoker = off`, so the view runs
-- with its owner's privileges and the caller's RLS view of the base tables is
-- irrelevant; every grant is then revoked and re-granted to service_role alone.
-- Supabase's default privileges hand new objects in `public` to anon and
-- authenticated, and PostgREST exposes every view in `public`, so the REVOKE is
-- not tidiness — without it this is a public index of every share, every
-- customer's handle, and every document's storage key.
--
-- `left join profiles`: document_shares.owner_id points at auth.users, not at
-- profiles, so no foreign key guarantees the profile row. An inner join would
-- turn a missing profile into a 404 on a live link.
-- ------------------------------------------------------------
drop view if exists public.share_lookup;

create view public.share_lookup with (security_invoker = off) as
select
  s.id,
  s.slug,
  s.document_id,
  s.owner_id,
  s.recipient_label,
  s.require_email,
  s.require_password,
  s.allowed_email_domains,
  s.allowed_emails,
  s.lock_deck,
  s.expires_at,
  s.revoked_at,
  s.host_handle,
  p.handle                as owner_handle,
  p.tier                  as owner_tier,
  d.title                 as document_title,
  d.source_type           as document_source_type,
  d.source_url            as document_source_url,
  d.current_version       as document_current_version,
  d.r2_key                as document_r2_key,
  d.deleted_at            as document_deleted_at
from document_shares s
join documents d on d.id = s.document_id
left join profiles p on p.id = s.owner_id;

comment on view public.share_lookup is
  'Everything the proxy needs to answer one recipient request: the share, its stored hostname, the owner''s handle and tier, and the document''s storage key and version. Service role only — it exposes every customer''s handle and every document''s R2 key.';

revoke all on public.share_lookup from public, anon, authenticated;
grant select on public.share_lookup to service_role;

-- The password hash is deliberately absent. Password checking goes through
-- verify_share_password (002/004), which rate-limits per slug; a hash on a
-- view the proxy reads on every request would be an offline-cracking target
-- sitting in a response body for no reason.
