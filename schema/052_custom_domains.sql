-- 052_custom_domains.sql
-- ------------------------------------------------------------
-- The database half of customer domains: a Pro account serves its tracked
-- links on its own subdomain (decks.acme.com/r/deal-name) instead of the
-- shared apex, with tracking, gates and recipient controls unchanged.
--
-- The contract this implements is
--   docs/workstreams/content-domain/CUSTOM-DOMAINS-PRD-2026-09-16.md
-- and the task list it builds to is CUSTOM-DOMAINS-SPRINT-2026-09-16.md (v2,
-- after Astra's review: the amendments at the end of that file override the
-- track text). Read "Which host serves what" in TRUST-LAYER-DESIGN-2026-08-31
-- first — this is the third host shape added to the two 043 created, and it
-- reuses 043's rule unchanged: ROUTING FOLLOWS WHAT THE SHARE STORED, NEVER
-- THE OWNER'S CURRENT SETTING.
--
-- WHAT A CUSTOM DOMAIN IS, AND WHAT IT IS NOT
--
-- It is a routing and reputation boundary that the customer owns, one step
-- further than the handle: a Safe Browsing warning earned on decks.acme.com
-- damages acme.com and nothing of ours, and a link that reads as the sender's
-- is why a founder decides the tool is theirs. It is NOT an identity check.
-- We verify that the name points at us, not that the person typing it is
-- entitled to the name, and nothing we say to a customer should claim more.
--
-- WHY THIS IS ENFORCED IN THE DATABASE AND NOT IN TYPESCRIPT
--
-- The same reason 032, 033 and 043 spell out: row-level security scopes ROWS,
-- not COLUMNS or VALUES. `authenticated` still holds a table-level UPDATE
-- grant on document_shares, so a signed-in customer can PATCH
-- `custom_domain_id` straight through PostgREST with the public anon key and
-- never touch a line of our application code — pointing their share at
-- somebody else's live domain, which serves their HTML on a hostname they do
-- not own. The triggers below are the control. Every check written in the app
-- is for the error message only.
--
-- THE FOUR THINGS THIS FILE MAKES TRUE
--
--   1. A hostname belongs to at most one account at a time, and a name a
--      different account once held cannot be re-claimed without a human
--      looking at it (`previous_owner_review`, cleared only by
--      approve_custom_domain_reclaim, which insists on a reason and records
--      it). This is the mitigation for the refused second DNS record: with
--      only a CNAME to go on, first claim wins, so the claim has to be hard
--      to take back — including by deleting the account, which retires the
--      claim but does not erase it.
--   2. A share's hostname is chosen and written in the SAME INSERT that
--      creates the share, and is frozen afterwards INCLUDING null. 043 left
--      null-to-handle open; a later stamp would expose a custom share on
--      htmlradar.page for the width of that window, and a link that can be
--      moved is a link that can be made to 404.
--   3. Eligibility (tier 'pro' OR comped) gates enrolment and new custom
--      shares, and nothing else. A downgraded owner can still check,
--      disconnect and be monitored; their issued links keep serving; only
--      new branded links stop. One trigger on profiles clears the default the
--      moment a profile stops being eligible, so the monitor's expirePro
--      sweep and the Polar webhook need no code change at all.
--   4. Every place the database prints a link address builds it from the
--      share's stored host. report_abuse (037) hard-coded htmlradar.page and
--      is rewritten below for exactly that reason.
--
-- THE ERROR CODES THIS FILE RAISES, so the app lane has one list to map:
--
--   P0044 custom_domain_invalid_format     not a usable hostname
--   P0045 custom_domain_bare               the registrable domain itself
--   P0046 custom_domain_reserved           our own names, Punycode, lookalike
--   P0047 custom_domain_requires_pro       owner is neither pro nor comped
--   P0048 custom_domain_limit              second non-retired domain
--   P0049 custom_domain_immutable          hostname/owner/flag/un-retire
--   P0050 custom_domain_needs_review       re-claim of another account's name
--   P0051 share_custom_domain_immutable    a link's address is fixed
--   P0052 share_custom_domain_not_owned    not this account's domain
--   P0053 share_custom_domain_not_live     domain is not serving
--   P0054 share_host_conflict              handle and domain both set
--   P0055 default_custom_domain_invalid    default is not a live own domain
--   P0056 custom_domain_unavailable        claimed by another account
--   P0057 reclaim_note_required             support approval with no reason
--   P0058 custom_domain_not_found           approval named a row that is gone
--   P0059 custom_domain_not_under_review    approval of a row needing none
--
-- 043's P0042 (host_handle_immutable) and P0043 (host_handle_not_owned) are
-- still raised, by the replacement trigger in section 3.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create-table-if-not-exists + add-column-if-not-exists + drop-if-exists +
-- create-or-replace).
--
-- ORDERING: run this AFTER 001 (profiles, document_shares), 027 (the share
-- cap trigger this sorts against), 032 (profiles.comped and the profiles
-- column lockdown), 033 (create_share's current signature), 037 (report_abuse)
-- and 043 (host_handle, share_lookup, the trigger this replaces).
--
-- BEFORE APPLYING: section 1 carries a PILOT OWNER PLACEHOLDER. Put the pilot
-- account's uuid in it, or leave it as the nil uuid, which matches nothing.
--
-- ONE TRANSACTION. Everything below is wrapped in begin/commit, because
-- section 5 DROPS create_share and create_share_as before recreating them
-- with their new signatures. Outside a transaction that is a window — however
-- short — in which the application's share-creating call 404s on a missing
-- function. Inside one, no session ever sees the gap: the old signatures are
-- there until commit and the new ones from commit onwards. Every statement
-- here is transactional (no CREATE INDEX CONCURRENTLY, no VACUUM), and the
-- `notify pgrst` at the end fires at commit, which is exactly when the new
-- signatures become visible.
-- ------------------------------------------------------------

begin;

-- ------------------------------------------------------------
-- 1. custom_domains — one row per claimed hostname
--
-- Rows are never deleted, only stamped `retired_at`. Same reasoning as
-- handle_registry (043) and chosen link endings (033): the name is already in
-- somebody's inbox as part of a link address, and a freed name is a name the
-- next account can inherit along with the previous holder's reputation and
-- their recipients' bookmarks.
--
-- `state` is OUR serving decision and it is the only thing the worker reads.
-- `cloudflare_status` and `ssl_status` are what the provider last told us,
-- kept for support and for the Settings copy; they are evidence, not
-- authority, which is why they are plain text with no check constraint — a
-- provider that invents a new status string must not break a write.
--
--   pending      claimed, not serving. Answers exactly one content-free probe
--                path on its hostname (worker, Track B) and nothing else.
--   live         serving. The only state a share may point at.
--   disconnected the name stopped answering (two consecutive failures) or the
--                customer's DNS changed. Serves nothing; can recover to live.
--   retired      the customer disconnected it. Terminal, by trigger.
--
-- RLS: the owner may SELECT their own row and may write nothing at all.
-- `api_keys` (034) is deliberately NOT the pattern copied here — that table
-- lets a customer insert and revoke their own rows, which is right for a
-- credential they mint and wrong for a claim on a public hostname. Every
-- write here goes through the service role (the Settings server actions and
-- the monitor), so the state machine has exactly one author.
-- ------------------------------------------------------------
create table if not exists public.custom_domains (
  id                    uuid primary key default gen_random_uuid(),
  -- NO FOREIGN KEY, deliberately, and for handle_registry's reason (043): a
  -- key to auth.users would cascade this row away when the account is
  -- deleted, and this row IS the record that the name was taken. Delete the
  -- account and the claim would vanish with it, so the next person to claim
  -- the same hostname would look like the first — which is precisely the
  -- re-claim the review flag below exists to stop. The value is the account
  -- that held the name, kept as a plain uuid on purpose.
  owner_id              uuid not null,
  -- Lowercase, dotted, at least two labels by the constraint below and at
  -- least three (four under a multi-part suffix) by the trigger. Immutable
  -- after insert: it is half of the address of every link issued on it.
  hostname              text not null,
  -- The provider's id for the custom hostname, so get/restart/delete have
  -- something to name. Null until the create call returns, and NEVER nulled
  -- afterwards — not even on retire. A retired row whose id had been cleared
  -- is a custom hostname left standing at Cloudflare with nothing recording
  -- that it is ours to remove.
  cloudflare_id         text,
  -- When Cloudflare confirmed the custom hostname was deleted. Set only after
  -- the delete call came back, never hopefully. The monitor's sweep is
  -- exactly the rows where `retired_at is not null and cloudflare_id is not
  -- null and cloudflare_deleted_at is null`: disconnected here, still there.
  cloudflare_deleted_at timestamptz,
  state                 text not null default 'pending'
                          check (state in ('pending', 'live', 'disconnected', 'retired')),
  cloudflare_status     text,
  ssl_status            text,
  verified_at           timestamptz,
  last_checked_at       timestamptz,
  last_error            text,
  -- Consecutive failed probes. Two means disconnected (Track D). Reset to 0
  -- by any success, which is why it lives on the row rather than being
  -- counted from a log we do not keep.
  consecutive_failures  integer not null default 0,
  -- True when some OTHER account has held this hostname before. Computed by
  -- the trigger, never taken from the client, and it blocks the row from ever
  -- reaching 'live' until a human clears it. This is the whole mitigation for
  -- having no ownership proof beyond the CNAME: taking a name back has to
  -- cost a support conversation, or a lapsed customer's name is a free
  -- hijack for whoever claims it next.
  previous_owner_review boolean not null default false,
  -- Cleared by approve_custom_domain_reclaim (section 2b) and by nothing
  -- else. Who, when and why, so support can answer "why is this serving now"
  -- a year later. `reclaim_approved_by` is the database role that ran the
  -- approval, which is the granularity the database actually has; the human
  -- goes in the note.
  reclaim_approved_at   timestamptz,
  reclaim_approved_by   text,
  reclaim_note          text,
  created_at            timestamptz not null default now(),
  retired_at            timestamptz,
  -- Stamped when the holding profile row is deleted. The claim itself is
  -- permanent regardless; this only records that the holder is gone, which is
  -- what support needs to tell a retired claim from a live one.
  owner_deleted_at      timestamptz,
  -- State and the tombstone cannot disagree. Without this a row could be
  -- stamped retired while still reading 'live' to the worker, or hold the
  -- unique partial indexes below while claiming to be gone.
  constraint chk_custom_domains_state_retired
    check ((state = 'retired') = (retired_at is not null)),
  -- The format FLOOR, under the trigger: lowercase, valid label shape, at
  -- least two labels, at most 253 characters. The trigger is the policy (bare
  -- domains, lookalikes, our own names); this is what still holds if a later
  -- migration ever loosens the trigger.
  constraint chk_custom_domains_hostname_format
    check (
      length(hostname) <= 253
      and hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
);

-- An earlier draft of this migration carried `references auth.users(id) on
-- delete cascade` here. Dropping it is the fix for account deletion defeating
-- the re-claim review, and it has to be dropped explicitly because
-- `create table if not exists` does nothing on a database where the table is
-- already there.
alter table public.custom_domains
  drop constraint if exists custom_domains_owner_id_fkey;

-- Columns added after the first draft of this file, for the same reason: the
-- create-table above does nothing where the table already exists.
alter table public.custom_domains
  add column if not exists owner_deleted_at      timestamptz,
  add column if not exists cloudflare_deleted_at timestamptz,
  add column if not exists reclaim_approved_at   timestamptz,
  add column if not exists reclaim_approved_by   text,
  add column if not exists reclaim_note          text;

comment on table public.custom_domains is
  'One row per hostname a customer has claimed for their tracked links. Rows are never deleted, only stamped retired_at, so a name can never be silently re-issued. `state` is our serving decision and the only field the worker trusts; cloudflare_status and ssl_status are the provider''s last word, kept for support. Owners may read their own row and write nothing.';
comment on column public.custom_domains.state is
  'Our serving decision: pending (claimed, answers only the probe path), live (serving; the only state a share may point at), disconnected (stopped answering, can recover), retired (terminal — the customer disconnected it).';
comment on column public.custom_domains.owner_id is
  'The account that claimed this hostname. Deliberately NOT a foreign key: a key would cascade the row away on account deletion, and the row surviving is what keeps a deleted account''s hostname from being silently re-claimed as if it were new.';
comment on column public.custom_domains.owner_deleted_at is
  'Set when the holding profile row was deleted. The claim is permanent regardless; this is a record, not a release.';
comment on column public.custom_domains.previous_owner_review is
  'True when another account has held this hostname before. Computed on insert, immutable, and blocks the row from reaching ''live'' until support clears it. With no DNS proof beyond the CNAME, first claim wins — so taking a claim back must cost a human conversation.';
comment on column public.custom_domains.cloudflare_deleted_at is
  'When Cloudflare confirmed the custom hostname was deleted, set only after the call returned. Retiring a row never clears cloudflare_id, so `retired_at is not null and cloudflare_id is not null and cloudflare_deleted_at is null` is the monitor''s list of hostnames still standing at the provider.';
comment on column public.custom_domains.consecutive_failures is
  'Consecutive failed probes; two means disconnected. Reset to zero by any success.';

-- The race resolution, not a nicety. Two accounts claiming the same hostname
-- at the same instant both insert; one commits, the other fails with 23505.
-- `where retired_at is null` is what lets a retired row keep sitting in the
-- table as the permanent record without holding the name against its own
-- former owner re-claiming it.
create unique index if not exists uq_custom_domains_hostname_active
  on public.custom_domains (hostname) where retired_at is null;

-- One domain per account is a product decision (PRD §7), and it is enforced
-- here rather than only in the trigger for the same reason: two simultaneous
-- enrolments would both pass a trigger's count.
create unique index if not exists uq_custom_domains_owner_active
  on public.custom_domains (owner_id) where retired_at is null;

alter table public.custom_domains enable row level security;

-- Supabase's default privileges hand every new table in `public` to anon and
-- authenticated, and PostgREST publishes it. Without this revoke, the claim
-- list — which is a list of who our customers are and what they send from —
-- is readable with the public anon key.
revoke all on public.custom_domains from anon, authenticated;
grant select on public.custom_domains to authenticated;

drop policy if exists custom_domains_owner_select on public.custom_domains;
create policy custom_domains_owner_select on public.custom_domains
  for select to authenticated using (owner_id = auth.uid());

-- Deliberately no insert, update or delete policy, and no write grant. The
-- Settings actions and the monitor use the service role, which bypasses both.

-- ------------------------------------------------------------
-- 2. validate_custom_domain — every rule about what may be claimed
--
-- SECURITY DEFINER with an EMPTY search_path and every object written out in
-- full, the posture 034/035/037 settled on: a definer function resolves names
-- on its owner's behalf, so any schema a search path names is a place a role
-- holding CREATE could plant a shadow object and have it run as the owner.
--
-- The rules, in the order a customer meets them:
--
--   format     a hostname that cannot resolve, or that is a Punycode
--              lookalike (`xn--`), or that carries our own name in a label.
--   reserved   our own registrable domains. gethtmlradar.com is allowed for
--              the pilot owners listed below and for nobody else, because
--              those two test names are how the feature is verified on
--              production before a customer ever sees it.
--   bare       a bare registrable domain (acme.com, acme.co.uk). Refused on
--              purpose: pointing a whole domain at us takes the customer's
--              website down, and the CNAME we ask for cannot coexist with
--              their apex records. The rule is "at least one label BELOW the
--              registrable domain", which is three labels normally and four
--              under a multi-part suffix — three labels alone would admit
--              `acme.co.uk`, which is Astra's finding.
--   eligible   tier 'pro' or comped. `comped` is a boolean on profiles, not
--              a tier value (032), so reading tier alone would refuse the
--              internal accounts the pilot runs on.
--   limit      one non-retired domain per owner.
--
-- Eligibility and the claim rules are checked on INSERT ONLY. A downgraded or
-- lapsed owner must still be able to disconnect, be checked and be monitored:
-- those are UPDATEs, and an UPDATE here only ever checks immutability.
-- ------------------------------------------------------------
create or replace function public.validate_custom_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ----------------------------------------------------------
  -- PILOT OWNER PLACEHOLDER — REPLACE BEFORE APPLYING.
  --
  -- The accounts allowed to claim a `*.gethtmlradar.com` name. That zone is
  -- ours, and the two test subdomains on it (decks. and links.) are how M5
  -- verifies the whole journey on production. Nobody else may claim a name
  -- under a domain we control, or "your own domain" would be a hostname we
  -- could read the mail of.
  --
  -- The nil uuid below matches no account, so an unedited file simply refuses
  -- every gethtmlradar.com name — which is the safe way for it to be wrong.
  -- Add the pilot account's id (select id from auth.users where email = …).
  -- ----------------------------------------------------------
  v_pilot_owners uuid[] := array[
    '2a840f99-24e7-46d9-8ba7-03fe9a58bc47'  -- pilot account id goes here
  ]::uuid[];

  -- Public suffixes that are themselves two labels. This is NOT the Public
  -- Suffix List and must not grow into a copy of it — it is the second-level
  -- suffixes a customer of ours plausibly sits under, and it errs towards
  -- being long because the cost of a miss is admitting a bare domain, which
  -- takes the customer's own website down. Adding one later is one array
  -- element.
  v_multi_suffixes text[] := array[
    -- United Kingdom
    'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
    -- India
    'co.in', 'net.in', 'org.in', 'firm.in',
    -- Australia and New Zealand
    'com.au', 'net.au', 'org.au', 'co.nz', 'net.nz', 'org.nz',
    -- Asia
    'com.sg', 'co.jp', 'ne.jp', 'or.jp', 'com.hk', 'com.cn', 'co.kr',
    'com.my', 'com.ph', 'com.pk', 'co.id', 'co.il',
    -- Americas, Africa, Middle East, Turkey
    'com.br', 'com.mx', 'com.ar', 'co.za', 'com.sa', 'com.tr',
    'com.ng', 'com.eg'
  ];

  v_labels   text[];
  v_n        integer;
  v_label    text;
  v_suffix   text;
  v_min      integer := 3;
  v_pilot    boolean;
  v_eligible boolean;
begin
  -- Normalise first, so everything after this — the immutability comparison,
  -- the unique index, the worker's hostname match — sees one spelling. A
  -- trailing dot is a legal fully-qualified name and is not a different host.
  new.hostname := nullif(
    pg_catalog.rtrim(pg_catalog.btrim(pg_catalog.lower(coalesce(new.hostname, ''))), '.'),
    ''
  );

  -- ----------------------------------------------------------
  -- UPDATE: nothing about the claim may change. Only the state machine moves.
  -- ----------------------------------------------------------
  if tg_op = 'UPDATE' then
    if new.hostname is distinct from old.hostname then
      raise exception 'custom_domain_immutable'
        using errcode = 'P0049',
              hint = 'A connected domain''s hostname cannot be changed — links already sent use it as their address. Disconnect it and claim the new one.';
    end if;

    if new.owner_id is distinct from old.owner_id then
      raise exception 'custom_domain_immutable'
        using errcode = 'P0049',
              hint = 'A domain claim cannot be moved between accounts.';
    end if;

    -- Computed on insert, and afterwards moved by exactly one thing:
    -- approve_custom_domain_reclaim (section 2b), which announces itself with
    -- a transaction-local setting naming the row it is approving. A plain
    -- UPDATE — from the app, from the monitor, from psql — cannot clear this
    -- flag, because clearing it is what lets a stranger serve on a hostname
    -- somebody else's customers have in their inboxes.
    --
    -- Binding the setting to the row id rather than to a boolean means a
    -- stale setting cannot launder a different row, which is the reasoning
    -- 033 wrote down for `app.generated_slug`. A client cannot set it either:
    -- PostgREST exposes only functions in the public schema, and set_config
    -- lives in pg_catalog.
    if new.previous_owner_review is distinct from old.previous_owner_review then
      if not (old.previous_owner_review
              and not new.previous_owner_review
              -- `is not distinct from` rather than `=`: the setting is null
              -- when nobody set it, and a null there would make the whole
              -- condition null, which `if` treats as false — meaning the
              -- refusal below would never fire. Three-valued logic is how a
              -- guard like this quietly stops guarding.
              and nullif(pg_catalog.current_setting('app.reclaim_approved', true), '')
                  is not distinct from new.id::text) then
        raise exception 'custom_domain_immutable'
          using errcode = 'P0049',
                hint = 'The re-claim review flag is set by the database, and cleared only by support approval.';
      end if;
    end if;

    -- Retired is terminal. A retired row is the permanent record that this
    -- account once held the name; un-retiring it would resurrect serving on a
    -- hostname whose customer was told, in the disconnect confirmation, that
    -- its links had stopped.
    if old.state = 'retired' and new.state is distinct from 'retired' then
      raise exception 'custom_domain_immutable'
        using errcode = 'P0049',
              hint = 'A disconnected domain cannot be brought back. Claim it again to reconnect it.';
    end if;

    if new.previous_owner_review and new.state = 'live' then
      raise exception 'custom_domain_needs_review'
        using errcode = 'P0050',
              hint = 'This domain was connected to a different account before. Support has to confirm the change before it can serve links.';
    end if;

    -- Keep the tombstone and the state agreeing without making every caller
    -- remember to write both (the check constraint would otherwise fire).
    if new.state = 'retired' and new.retired_at is null then
      new.retired_at := pg_catalog.now();
    end if;

    return new;
  end if;

  -- ----------------------------------------------------------
  -- INSERT: the claim itself.
  -- ----------------------------------------------------------
  if new.hostname is null then
    raise exception 'custom_domain_invalid_format'
      using errcode = 'P0044',
            hint = 'Enter the subdomain you want to use, for example decks.yourcompany.com.';
  end if;

  v_labels := pg_catalog.string_to_array(new.hostname, '.');
  v_n      := pg_catalog.array_length(v_labels, 1);

  -- Decided before the label rules, because the pilot names contain our own
  -- name and would otherwise be refused by the lookalike rule below.
  v_pilot := (new.hostname like '%.gethtmlradar.com')
             and (new.owner_id = any (v_pilot_owners));

  if v_n is null or v_n < 2 or pg_catalog.length(new.hostname) > 253 then
    raise exception 'custom_domain_invalid_format'
      using errcode = 'P0044',
            hint = 'That is not a hostname we can use. Use a subdomain of a domain you own, for example decks.yourcompany.com.';
  end if;

  foreach v_label in array v_labels loop
    -- One to sixty-three characters, letters digits and hyphens, never
    -- starting or ending with a hyphen. Anything else either cannot resolve
    -- or resolves to something other than what the customer typed.
    if v_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
      raise exception 'custom_domain_invalid_format'
        using errcode = 'P0044',
              hint = 'Each part of the name may use letters, numbers and hyphens, and cannot start or end with a hyphen.';
    end if;

    -- Punycode. A name that renders as one thing and resolves as another is
    -- the whole of the homograph attack, and we have no way to show a
    -- recipient which it is.
    if v_label like 'xn--%' then
      raise exception 'custom_domain_reserved'
        using errcode = 'P0046',
              hint = 'Internationalised (Punycode) names cannot be used for tracked links.';
    end if;

    -- Our own name in any position: htmlradar-login.acme.com reads as ours
    -- to a recipient and is precisely the phishing shape this refuses.
    -- 043's reserved handle list is deliberately NOT applied here: it would
    -- refuse ordinary names like docs.acme.com and support.acme.com.
    --
    -- Tested against the label with digits folded back to the letters they
    -- imitate, so htm1radar, htmlr3dar-login and h7mlradar are refused too.
    -- `1` is folded twice because it stands in for both `l` and `i`; only the
    -- `l` form can spell our name, but reading it both ways costs one call
    -- and stops the rule depending on that staying true.
    if not v_pilot
       and (v_label like '%htmlradar%'
            or pg_catalog.translate(v_label, '01357', 'olest') like '%htmlradar%'
            or pg_catalog.translate(v_label, '01357', 'ilest') like '%htmlradar%') then
      raise exception 'custom_domain_reserved'
        using errcode = 'P0046',
              hint = 'A name containing "htmlradar" cannot be used — it would read as one of ours to the person receiving the link.';
    end if;
  end loop;

  -- Our own registrable domains. htmlradar.page and htmlradar.com are refused
  -- outright; gethtmlradar.com only for the pilot owners above.
  if new.hostname = 'htmlradar.page' or new.hostname like '%.htmlradar.page'
     or new.hostname = 'htmlradar.com' or new.hostname like '%.htmlradar.com'
     or ((new.hostname = 'gethtmlradar.com' or new.hostname like '%.gethtmlradar.com')
         and not v_pilot) then
    raise exception 'custom_domain_reserved'
      using errcode = 'P0046',
            hint = 'That name is one of ours. Use a subdomain of a domain you own, for example decks.yourcompany.com.';
  end if;

  -- The bare-domain rule: at least one label BELOW the registrable domain.
  v_suffix := pg_catalog.array_to_string(v_labels[v_n - 1 : v_n], '.');
  if v_suffix = any (v_multi_suffixes) then
    v_min := 4;
  end if;

  if v_n < v_min then
    raise exception 'custom_domain_bare'
      using errcode = 'P0045',
            hint = pg_catalog.format(
              'Use a subdomain rather than the domain itself — try decks.%s. Pointing %s at us would take your website down.',
              new.hostname, new.hostname);
  end if;

  -- Eligibility. `comped` is a boolean, not a tier (032): reading tier alone
  -- would refuse the internal accounts, which is how the pilot runs.
  select (p.tier = 'pro' or p.comped) into v_eligible
    from public.profiles p where p.id = new.owner_id;

  if not coalesce(v_eligible, false) then
    raise exception 'custom_domain_requires_pro'
      using errcode = 'P0047',
            hint = 'Connecting your own domain is part of Pro.';
  end if;

  -- One at a time. The unique partial index is the race-safe control; this is
  -- here so the customer reads a sentence instead of a raw 23505 (the same
  -- argument 033 makes for the slug check).
  if exists (
    select 1 from public.custom_domains d
     where d.owner_id = new.owner_id and d.retired_at is null
  ) then
    raise exception 'custom_domain_limit'
      using errcode = 'P0048',
            hint = 'One domain per account. Disconnect the current one first.';
  end if;

  -- Taken by somebody else right now. The unique partial index is the
  -- race-safe control; this is the sentence the customer reads instead of a
  -- raw 23505, and it is the one refusal the Settings copy has to explain,
  -- because the customer can see their DNS pointing at us and will not
  -- otherwise understand why the claim will not take.
  if exists (
    select 1 from public.custom_domains d
     where d.hostname = new.hostname and d.retired_at is null
  ) then
    raise exception 'custom_domain_unavailable'
      using errcode = 'P0056',
            hint = 'That hostname is already connected to an HTMLRadar account. If it is yours, write to support.';
  end if;

  -- Computed, never trusted from the caller. Any earlier row for this
  -- hostname under a different account — retired or not — means somebody else
  -- has been here, and a human has to agree before it serves anything.
  new.previous_owner_review := exists (
    select 1 from public.custom_domains d
     where d.hostname = new.hostname
       and d.owner_id is distinct from new.owner_id
  );

  if new.previous_owner_review and new.state = 'live' then
    raise exception 'custom_domain_needs_review'
      using errcode = 'P0050',
            hint = 'This domain was connected to a different account before. Support has to confirm the change before it can serve links.';
  end if;

  if new.state = 'retired' and new.retired_at is null then
    new.retired_at := pg_catalog.now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_custom_domain on public.custom_domains;
create trigger trg_validate_custom_domain
  before insert or update on public.custom_domains
  for each row execute function public.validate_custom_domain();

-- ------------------------------------------------------------
-- 2a. The profile is gone; the claim is not
--
-- The row surviving is what keeps the hostname from being re-claimed as if
-- nobody had ever held it — that is why owner_id carries no foreign key.
-- Stamping owner_deleted_at is the bookkeeping on top: without it nothing
-- records that the holder went away, and support cannot tell a claim whose
-- customer left from one whose customer is sitting in front of them.
--
-- It also RETIRES the claim, which 043's handle version has no equivalent of
-- because a handle is a label and this is a running service. The account is
-- gone and its shares went with it, so the hostname is serving nothing and
-- must stop holding the "one account per hostname" index against everybody
-- else — while the row itself stays, so the next claimant is still flagged
-- for review. Retiring also puts the row in front of the monitor's sweep for
-- Cloudflare hostnames that still need deleting.
-- ------------------------------------------------------------
create or replace function public.release_custom_domains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.custom_domains
     set owner_deleted_at = pg_catalog.now(),
         state            = 'retired',
         retired_at       = coalesce(retired_at, pg_catalog.now())
   where owner_id = old.id
     and owner_deleted_at is null;
  return old;
end;
$$;

drop trigger if exists trg_release_custom_domains on public.profiles;
create trigger trg_release_custom_domains
  after delete on public.profiles
  for each row execute function public.release_custom_domains();

-- ------------------------------------------------------------
-- 2b. approve_custom_domain_reclaim — the one way past the review flag
--
-- A hostname another account once held is flagged on claim and cannot serve
-- until a person agrees. This is that person's button, and it is the whole
-- reason the flag is worth having: a safeguard with no documented way through
-- it becomes a safeguard somebody disables at two in the morning.
--
-- Service role only, for api_keys' reason (034) turned around: the caller
-- chooses the row, so a caller who could choose any row could approve their
-- own re-claim of somebody else's name. There is no owner-facing path to it
-- at all — the customer writes to support, and support runs this.
--
-- What it records: when, the database role that ran it, and the note. The
-- note is where the human and the reason go, because `service_role` is the
-- only role that can ever appear in `reclaim_approved_by` and a column that
-- always says the same thing answers nothing on its own.
--
-- Returns the row, so the operator sees what they just did rather than
-- trusting that they named the right id.
-- ------------------------------------------------------------
create or replace function public.approve_custom_domain_reclaim(
  p_domain_id uuid,
  p_note      text
)
returns public.custom_domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note   text;
  v_domain public.custom_domains%rowtype;
begin
  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  if v_note is null then
    raise exception 'reclaim_note_required'
      using errcode = 'P0057',
            hint = 'Say who asked and what you checked. This is the record of why a hostname changed hands.';
  end if;

  select * into v_domain from public.custom_domains d where d.id = p_domain_id;
  if not found then
    raise exception 'custom_domain_not_found' using errcode = 'P0058';
  end if;

  if not v_domain.previous_owner_review then
    raise exception 'custom_domain_not_under_review'
      using errcode = 'P0059',
            hint = 'That domain is not waiting on a review. Nothing to approve.';
  end if;

  -- Announce the approval to the immutability trigger, bound to this exact
  -- row and gone at commit.
  perform pg_catalog.set_config('app.reclaim_approved', p_domain_id::text, true);

  update public.custom_domains
     set previous_owner_review = false,
         reclaim_approved_at   = pg_catalog.now(),
         reclaim_approved_by   = current_user::text,
         reclaim_note          = v_note
   where id = p_domain_id
  returning * into v_domain;

  return v_domain;
end;
$$;

revoke all on function public.approve_custom_domain_reclaim(uuid, text)
  from public, anon, authenticated;
grant execute on function public.approve_custom_domain_reclaim(uuid, text)
  to service_role;

-- ------------------------------------------------------------
-- 3. document_shares.custom_domain_id — the hostname this link was issued on
--
-- Beside 043's host_handle, never with it: a link has exactly one address.
-- Null and null means the apex, forever, which is every share that exists
-- today and every share a free account creates.
--
-- This REPLACES 043's validate_share_host_handle with one function covering
-- both columns, because the rules are now one rule ("which host serves this
-- share, decided once, at creation") and two triggers would have to agree
-- about the conflict case.
--
-- The change 043 would not have made: null is frozen too. 043 permitted
-- null → the owner's own handle so that a later lane could stamp a hostname
-- onto a share it had just created. Astra's finding is that the stamp is the
-- bug — `stampShareHost` updates after the insert and swallows its failures,
-- so a custom share exists on htmlradar.page for the width of that window and
-- stays there if the update fails. Section 5 moves the choice inside
-- create_share; this closes the door the stamp came through.
-- ------------------------------------------------------------
alter table public.document_shares
  add column if not exists custom_domain_id uuid references public.custom_domains(id);

comment on column public.document_shares.custom_domain_id is
  'The customer domain this link was issued on: null means host_handle decides (and null host_handle means the apex, forever). Immutable, must belong to the share''s owner and must have been live when the share was created. Routing follows THIS column, never the owner''s current default, so an already-sent link never moves.';

create index if not exists idx_document_shares_custom_domain
  on public.document_shares (custom_domain_id) where custom_domain_id is not null;

create or replace function public.validate_share_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain   public.custom_domains%rowtype;
  v_eligible boolean;
begin
  -- ----------------------------------------------------------
  -- UPDATE: a link's address is fixed at creation. Both columns, both
  -- directions, including null in either direction.
  -- ----------------------------------------------------------
  if tg_op = 'UPDATE' then
    if new.host_handle is distinct from old.host_handle then
      raise exception 'host_handle_immutable'
        using errcode = 'P0042',
              hint = 'A link''s hostname cannot be changed after the link is created.';
    end if;

    if new.custom_domain_id is distinct from old.custom_domain_id then
      raise exception 'share_custom_domain_immutable'
        using errcode = 'P0051',
              hint = 'A link''s hostname cannot be changed after the link is created.';
    end if;

    return new;
  end if;

  -- ----------------------------------------------------------
  -- INSERT: one address, owned, and serving.
  -- ----------------------------------------------------------
  if new.host_handle is not null and new.custom_domain_id is not null then
    raise exception 'share_host_conflict'
      using errcode = 'P0054',
            hint = 'A link has one address: either the account handle or the custom domain, not both.';
  end if;

  if new.host_handle is not null
     and new.host_handle is distinct from
         (select p.handle from public.profiles p where p.id = new.owner_id) then
    raise exception 'host_handle_not_owned'
      using errcode = 'P0043',
            hint = 'A link can only be created on its own account''s handle.';
  end if;

  if new.custom_domain_id is not null then
    select * into v_domain
      from public.custom_domains d where d.id = new.custom_domain_id;

    -- `not found` rather than a foreign-key violation: a BEFORE trigger runs
    -- ahead of the key check, and "that is not your domain" is the true
    -- answer to both a made-up id and somebody else's.
    if not found or v_domain.owner_id is distinct from new.owner_id then
      raise exception 'share_custom_domain_not_owned'
        using errcode = 'P0052',
              hint = 'A link can only be created on a domain connected to its own account.';
    end if;

    -- The whole point of the state column. A pending, disconnected or retired
    -- domain serves nothing, so a link issued on one would be born broken.
    if v_domain.state is distinct from 'live' then
      raise exception 'share_custom_domain_not_live'
        using errcode = 'P0053',
              hint = 'That domain is not serving yet. Wait for it to go live, or create this link on the HTMLRadar address.';
    end if;

    -- Eligibility again, on the share itself: 027 still lets a free account
    -- create its first two links, and a lapsed Pro keeps a live domain (we
    -- never stop serving what was already sent). New branded links are what
    -- stop.
    select (p.tier = 'pro' or p.comped) into v_eligible
      from public.profiles p where p.id = new.owner_id;

    if not coalesce(v_eligible, false) then
      raise exception 'custom_domain_requires_pro'
        using errcode = 'P0047',
              hint = 'Links on your own domain are part of Pro. Links already sent keep working.';
    end if;
  end if;

  return new;
end;
$$;

-- Replaces 043's trigger and its function. Named to sort BEFORE
-- trg_validate_share_slug (033) and AFTER trg_enforce_share_cap (027), which
-- is the order 033 asked for: a free customer over their link cap is told
-- about the cap, the thing they can act on.
drop trigger if exists trg_validate_share_host_handle on public.document_shares;
drop trigger if exists trg_validate_share_host on public.document_shares;
create trigger trg_validate_share_host
  before insert or update of host_handle, custom_domain_id on public.document_shares
  for each row execute function public.validate_share_host();

drop function if exists public.validate_share_host_handle();

-- ------------------------------------------------------------
-- 4. profiles.default_custom_domain_id — what a new link uses by default
--
-- The customer never sees a toggle (the founder's simplicity rule): a domain
-- that goes live becomes the default for new links on its own, and the
-- per-share "use the HTMLRadar address" choice stays available at creation.
-- This column is that default, and nothing else — routing never reads it.
--
-- Two rules, and they are deliberately not the same shape.
--
-- A PROFILE THAT IS NOT ELIGIBLE HOLDS NO DEFAULT is a state rule, checked on
-- every write: "not eligible ⇒ null", not "pro → free". A transition test has
-- to be right about every writer; a state rule cannot be stale. It is also
-- why neither `expirePro` in the monitor nor the Polar webhook needs a code
-- change — both already write `tier`, and that write is what fires this.
--
-- A DEFAULT HAS TO BE A LIVE DOMAIN OF THIS ACCOUNT is checked only when the
-- default itself is being SET. It is an admission rule, not a standing one,
-- and the difference matters: a customer's domain can go disconnected at
-- three in the morning without anyone writing to their profile, and if the
-- rule were standing, the next unrelated write to that row would fail. The
-- next unrelated write to that row is a Polar renewal setting tier = 'pro'.
-- Refusing it would fail the webhook, Polar would retry, and a paying
-- customer would be stuck off Pro because their DNS was down. So a default
-- that was valid when it was set stays put; what it is worth at serving time
-- is decided at serving time, by create_share and by the worker, both of
-- which read the domain's current state.
--
-- 032 revoked the table-level UPDATE on profiles and re-granted only
-- (display_name, timezone), so this column is unreachable through PostgREST
-- to begin with. The trigger is the second line, not the first.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists default_custom_domain_id uuid references public.custom_domains(id);

comment on column public.profiles.default_custom_domain_id is
  'The live custom domain new links are issued on by default. Cleared automatically when the account stops being Pro or comped. Never read by routing — a sent link follows what its own row stored.';

create or replace function public.validate_profile_default_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain public.custom_domains%rowtype;
begin
  if new.default_custom_domain_id is null then
    return new;
  end if;

  -- The downgrade rule, checked on every write. Silent, because it is not a
  -- refusal: the account keeps its domain row, keeps serving every link
  -- already issued on it, and gets the default back by becoming Pro again.
  if not (new.tier = 'pro' or coalesce(new.comped, false)) then
    new.default_custom_domain_id := null;
    return new;
  end if;

  -- The default is not being touched by this write, so this write is not the
  -- place to re-litigate it. Anything else refuses a Polar renewal because a
  -- customer's DNS went down overnight.
  if tg_op = 'UPDATE'
     and new.default_custom_domain_id is not distinct from old.default_custom_domain_id then
    return new;
  end if;

  select * into v_domain
    from public.custom_domains d where d.id = new.default_custom_domain_id;

  if not found
     or v_domain.owner_id is distinct from new.id
     or v_domain.state is distinct from 'live' then
    raise exception 'default_custom_domain_invalid'
      using errcode = 'P0055',
            hint = 'A default link domain has to be a live domain connected to this account.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_profile_default_domain on public.profiles;
create trigger trg_validate_profile_default_domain
  before insert or update of tier, comped, default_custom_domain_id on public.profiles
  for each row execute function public.validate_profile_default_domain();

-- ------------------------------------------------------------
-- 5. create_share chooses the hostname, in the insert that creates the share
--
-- TWO new arguments, both last, both defaulted, so every existing call site
-- keeps working unchanged:
--
--   p_custom_domain_id       null  = use the account's default domain
--                            a uuid = use exactly this domain (the API's
--                                     `domain_id`; must be owned and live)
--   p_use_htmlradar_address  true  = ignore the default, issue on
--                                     htmlradar.page (the per-share selector)
--
-- Why two and not one: PostgreSQL cannot tell an omitted argument from an
-- explicit null, so a single nullable uuid cannot express both "I did not
-- choose" and "I chose the HTMLRadar address". A sentinel uuid would encode
-- it in one argument and would be the kind of cleverness somebody has to
-- decode at three in the morning. The boolean is boring on purpose.
--
-- Old callers therefore issue on the account's domain automatically once one
-- is live, which is the product behaviour ("from then on every new link is on
-- their domain") and is why no share-creating path — app, public API, MCP
-- connector — needs to learn about domains at all.
--
-- THE STALE-DEFAULT FALLBACK. If the default domain is no longer live, an
-- IMPLIED choice falls back to the apex and an EXPLICIT one raises. A
-- customer whose DNS broke this morning must still be able to send a link;
-- an API caller that named a domain must be told it did not get it.
--
-- The previous 9-argument form is dropped rather than left beside this one:
-- two overloads that both accept the old named arguments make the PostgREST
-- call ambiguous (033's reason, unchanged).
-- ------------------------------------------------------------
drop function if exists create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz, text);

create or replace function create_share(
  p_document_id           uuid,
  p_recipient_label       text,
  p_require_email         boolean,
  p_require_password      boolean,
  p_password_plain        text,
  p_allowed_email_domains text[],
  p_allowed_emails        text[],
  p_expires_at            timestamptz,
  p_slug                  text default null,
  p_custom_domain_id      uuid default null,
  p_use_htmlradar_address boolean default false
)
returns document_shares
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user_id    uuid := auth.uid();
  v_doc        documents%rowtype;
  v_slug       text;
  v_hash       text;
  v_domain_id  uuid;
  v_share      document_shares%rowtype;
  v_adjectives text[] := array['swift','silent','bright','golden','crisp','steady','quick','noble','vivid','calm'];
  v_nouns      text[] := array['falcon','river','meadow','signal','beacon','compass','glass','harbor','prism','ember'];
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  select * into v_doc from documents where id = p_document_id and owner_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'document_not_found' using errcode = 'P0021';
  end if;

  v_slug := nullif(lower(trim(coalesce(p_slug, ''))), '');

  if v_slug is null then
    loop
      v_slug := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
             || '-' || v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int]
             || '-' || encode(gen_random_bytes(3), 'hex');
      exit when not exists (select 1 from document_shares where slug = v_slug);
    end loop;
    -- Tell the validation trigger this exact slug came from us, so it marks
    -- the row generated and skips the Pro check. Transaction-local: gone at
    -- commit.
    perform set_config('app.generated_slug', v_slug, true);
  end if;

  -- Which host this link is born on. Decided here, written in the insert
  -- below, frozen by trg_validate_share_host from that moment.
  if not coalesce(p_use_htmlradar_address, false) then
    v_domain_id := coalesce(
      p_custom_domain_id,
      (select default_custom_domain_id from profiles where id = v_user_id)
    );

    -- A default that is no longer serving REFUSES, and says so. An earlier
    -- draft quietly fell back to htmlradar.page, on the theory that a
    -- customer whose DNS broke should still be able to send. That is the
    -- wrong kindness: the customer picks the link out of the dashboard,
    -- e-mails it to a buyer believing it carries their own domain, and
    -- nothing anywhere tells them it does not. A refusal they can read is
    -- better than a link that is silently not what they asked for, and the
    -- per-share HTMLRadar choice is one argument away for anyone in a hurry.
    --
    -- The explicit case (p_custom_domain_id given) falls through to the same
    -- refusal via the share trigger; this branch exists so the IMPLIED case
    -- gets a message about the default rather than about an id the caller
    -- never named.
    if p_custom_domain_id is null and v_domain_id is not null
       and not exists (
         select 1 from custom_domains
          where id = v_domain_id and owner_id = v_user_id and state = 'live'
       ) then
      raise exception 'share_custom_domain_not_live'
        using errcode = 'P0053',
              hint = 'Your domain is not serving at the moment, so this link cannot be created on it. Reconnect it in Settings, or create this link on the HTMLRadar address.';
    end if;
  end if;

  if p_require_password then
    if p_password_plain is null or length(p_password_plain) < 8 then
      raise exception 'password_too_short' using errcode = 'P0022';
    end if;
    v_hash := crypt(p_password_plain, gen_salt('bf', 10));
  end if;

  insert into document_shares (
    document_id, owner_id, slug, recipient_label,
    require_email, require_password, password_hash,
    allowed_email_domains, allowed_emails, expires_at,
    custom_domain_id
  )
  values (
    p_document_id, v_user_id, v_slug, p_recipient_label,
    coalesce(p_require_email, true), coalesce(p_require_password, false), v_hash,
    p_allowed_email_domains, p_allowed_emails, p_expires_at,
    v_domain_id
  )
  returning * into v_share;

  return v_share;
end;
$$;

revoke all on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz, text, uuid, boolean) from public, anon;
grant execute on function create_share(uuid, text, boolean, boolean, text, text[], text[], timestamptz, text, uuid, boolean) to authenticated;

-- create_share_as (034) is create_share with p_user_id prepended; it sets the
-- identity and delegates, and validation is not repeated. The two new
-- arguments are passed straight through so the public API can send
-- `domain_id` and the per-share HTMLRadar choice.
drop function if exists public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text);

create or replace function public.create_share_as(
  p_user_id               uuid,
  p_document_id           uuid,
  p_recipient_label       text,
  p_require_email         boolean,
  p_require_password      boolean,
  p_password_plain        text,
  p_allowed_email_domains text[],
  p_allowed_emails        text[],
  p_expires_at            timestamptz,
  p_slug                  text default null,
  p_custom_domain_id      uuid default null,
  p_use_htmlradar_address boolean default false
)
returns public.document_shares
language plpgsql security definer set search_path = '' as $$
declare
  v_share       public.document_shares%rowtype;
  v_prev_sub    text := coalesce(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
  v_prev_claims text := coalesce(pg_catalog.current_setting('request.jwt.claims', true), '');
begin
  if p_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0020';
  end if;

  -- Both forms auth.uid() understands, transaction-local.
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );

  v_share := public.create_share(
    p_document_id,
    p_recipient_label,
    p_require_email,
    p_require_password,
    p_password_plain,
    p_allowed_email_domains,
    p_allowed_emails,
    p_expires_at,
    p_slug,
    p_custom_domain_id,
    p_use_htmlradar_address
  );

  -- Put the connection back as we found it. On an exception the transaction
  -- aborts and the local settings are rolled back anyway, so this only
  -- matters on the success path.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_prev_sub, true);
  perform pg_catalog.set_config('request.jwt.claims', v_prev_claims, true);

  return v_share;
end;
$$;

-- The whole security argument for this function is this grant. A customer who
-- could execute it could pass any p_user_id and create links in anyone's
-- account.
revoke all on function public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.create_share_as(uuid, uuid, text, boolean, boolean, text, text[], text[], timestamptz, text, uuid, boolean)
  to service_role;

-- ------------------------------------------------------------
-- 6. share_lookup — the proxy's one read learns the third host shape
--
-- Four columns added, all of them things the worker must decide with BEFORE
-- it answers: the share's stored domain id, and the CURRENT hostname, state
-- and owner of that domain. Astra's finding is that a cached "live" survives
-- retirement, so there is no cache anywhere and the state is read on every
-- lookup from here.
--
-- `left join custom_domains`: the join must not turn a share with no domain
-- into a missing row, which is every share that exists today.
--
-- The view is rebuilt rather than altered because a view's column list cannot
-- be changed in place. Grants are re-stated below for the same reason.
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
  s.custom_domain_id,
  cd.hostname             as custom_domain_hostname,
  cd.state                as custom_domain_state,
  cd.owner_id             as custom_domain_owner_id,
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
left join profiles p on p.id = s.owner_id
left join custom_domains cd on cd.id = s.custom_domain_id;

comment on view public.share_lookup is
  'Everything the proxy needs to answer one recipient request: the share, its stored hostname (handle or custom domain), that domain''s current hostname, state and owner, the owner''s handle and tier, and the document''s storage key and version. Service role only — it exposes every customer''s handle, domain and document storage key.';

revoke all on public.share_lookup from public, anon, authenticated;
grant select on public.share_lookup to service_role;

-- ------------------------------------------------------------
-- 7. report_abuse builds the link from the share's stored host
--
-- 037 hard-codes `https://htmlradar.page/r/<slug>` in the abuse e-mail. On a
-- custom-domain share that address is a 404, which would send the operator
-- looking at nothing during the one workflow where minutes matter.
--
-- This is 037's function, unchanged except for the address: same signature,
-- same empty search_path, same grants (create-or-replace keeps them; they are
-- re-stated below so a fresh chain does not depend on ordering). The address
-- rule is the routing rule — follow what the share stored — so a retired or
-- disconnected domain still produces the address the report came in on.
-- ------------------------------------------------------------
create or replace function public.report_abuse(
  p_slug     text,
  p_reason   text,
  p_note     text,
  p_ip_hash  text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_share      public.document_shares%rowtype;
  v_doc        public.documents%rowtype;
  v_report_id  uuid;
  v_note       text;
  v_host       text;
  v_resend_key text;
  v_from       text;
  v_to         text := 'abuse@htmlradar.com';
  v_subject    text;
  v_body       text;
  v_request_id bigint;
  v_cooldown   interval := interval '6 hours';
begin
  if p_reason not in ('phishing', 'malware', 'personal_data', 'other') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;

  -- Counted before the slug is resolved, so a script walking made-up slugs
  -- spends its five the same way a real reporter does.
  if not public.check_rate_limit(
       'abuse_report:' || coalesce(p_ip_hash, 'unknown'), 3600, 5) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select * into v_share from public.document_shares where slug = p_slug;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_share');
  end if;

  -- Trim, cap, and treat an empty note as no note. The proxy caps at 500 too;
  -- this is the cap that holds when the caller is not the proxy.
  v_note := nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 500), '');

  insert into public.abuse_reports (share_id, reason, note, reporter_ip_hash)
  values (v_share.id, p_reason, v_note, p_ip_hash)
  returning id into v_report_id;

  -- ----------------------------------------------------------
  -- The email, throttled per share.
  --
  -- Same shape as notify_disabled_attempt (schema/028): an advisory lock so
  -- two simultaneous reports cannot both pass the check and double-send, a
  -- six-hour window, and a `skipped` row plus a stamp when Resend is not
  -- configured — so a misconfigured instance logs the miss once rather than
  -- on every report.
  --
  -- The window is measured from the last report we actually emailed about,
  -- not from the last report. A page being reported every ten minutes is
  -- precisely the one we want to hear about again in six hours.
  -- ----------------------------------------------------------
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('abuse_notify:' || v_share.id::text));

  if exists (
    select 1 from public.abuse_reports
    where share_id = v_share.id
      and notified_at > pg_catalog.now() - v_cooldown
  ) then
    return pg_catalog.jsonb_build_object('ok', true, 'id', v_report_id);
  end if;

  select * into v_doc from public.documents where id = v_share.document_id;

  -- The address the reporter actually opened, built the way routing decides
  -- it: the share's stored custom domain, else its stored handle, else the
  -- apex. Never the owner's current setting.
  v_host := coalesce(
    (select d.hostname from public.custom_domains d where d.id = v_share.custom_domain_id),
    case when v_share.host_handle is not null
         then v_share.host_handle || '.htmlradar.page'
         else 'htmlradar.page' end
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
    insert into public.notifications_log (session_id, email_to, status, error_message)
    values (null, v_to, 'skipped', 'resend secrets not in Vault');
    update public.abuse_reports set notified_at = pg_catalog.now() where id = v_report_id;
    return pg_catalog.jsonb_build_object('ok', true, 'id', v_report_id);
  end if;

  -- Plain text, not HTML. The note is a stranger's free text — the one string
  -- in this codebase's email path that is neither owner-authored nor ours —
  -- and a text/plain body cannot carry markup into the reader's client, so
  -- there is nothing to escape and nothing to get wrong later. The recipient
  -- is an operator inbox reading five facts, which wanted no layout anyway.
  v_subject := 'Abuse report (' || p_reason || ') on /r/' || p_slug;
  v_body := pg_catalog.format(
    E'Reason: %s\n'
    'Link: https://%s/r/%s\n'
    'Document: %s\n'
    'Share id: %s\n'
    'Owner id: %s\n'
    '\n'
    'Note from the reporter:\n%s\n'
    '\n'
    'Report id %s\n'
    'Runbook: docs/workstreams/security/ABUSE-RUNBOOK.md\n'
    'At most one of these per share every six hours, however many reports arrive.\n',
    p_reason,
    v_host,
    p_slug,
    coalesce(v_doc.title, '(unknown)'),
    v_share.id::text,
    v_share.owner_id::text,
    coalesce(v_note, '(none)'),
    v_report_id::text
  );

  select net.http_post(
    url := 'https://api.resend.com/emails',
    headers := pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || v_resend_key,
      'Content-Type', 'application/json'
    ),
    body := pg_catalog.jsonb_build_object(
      'from', v_from,
      'to', array[v_to],
      'subject', v_subject,
      'text', v_body
    )
  ) into v_request_id;

  insert into public.notifications_log (session_id, email_to, request_id, status)
  values (null, v_to, v_request_id, 'queued');

  update public.abuse_reports set notified_at = pg_catalog.now() where id = v_report_id;

  return pg_catalog.jsonb_build_object('ok', true, 'id', v_report_id);
end;
$$;

revoke all on function public.report_abuse(text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_abuse(text, text, text, text) to service_role;

-- Make the new and re-signed RPCs callable immediately (PostgREST schema
-- cache reload). Without this the app calls the old create_share signature
-- until the cache turns over on its own. Queued here, delivered at commit.
notify pgrst, 'reload schema';

commit;
