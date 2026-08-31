-- 037_abuse_reports.sql
-- ------------------------------------------------------------
-- The recipient's way to tell us a document is being used to phish, and
-- our way to hear about it before a blocklist does.
--
-- Layer 4 of the anti-phishing plan behind the content-domain switch
-- (docs/control/APPROACH-CARD-content-domain-2026-08-30.md). The first three
-- layers are structural: customer HTML on its own registrable domain, an
-- opaque-origin sandbox, and `form-action 'none'` on hosted documents. None
-- of them tells us that a particular document is a fake login page. A person
-- who received the link is the only one who reliably knows, so this is the
-- path from that person to us: a form on the gate, a row here, one email.
--
-- WHAT THIS FILE ADDS
--
--   1. `abuse_reports` — one row per report. RLS on with no policies, so no
--      customer-facing role can read or write it at all; the operator reads
--      it with the service role.
--   2. `report_abuse(slug, reason, note, ip_hash)` — the only write path.
--      Validates the reason, rate limits, resolves the slug, inserts, and
--      sends at most one email per share per six hours.
--
-- WHY THE REPORTER'S ADDRESS IS NEVER STORED
--
-- A report is anonymous by design: no sign-in, no email field, no reply. But
-- "5 reports per hour" needs to count something, so the proxy sends an
-- HMAC-SHA256 of the connecting address keyed with SESSION_SECRET, and the
-- database never sees the address itself. The database also holds no copy of
-- that secret, so a reader of this table cannot walk the hash back to an
-- address by trying the four billion of them.
--
-- WHY THE RPC IS SERVICE-ROLE ONLY
--
-- The counted identity is the hash, and the hash is an argument. Granting
-- execute to `anon` would let anyone holding the public anon key — it is in
-- every document the tracker touches — send a fresh random hash with each
-- call and never meet a limit, and the limit is the only thing standing
-- between this table and a stranger's script. The proxy is the trust border
-- for every other recipient-side write (see packages/proxy/src/supabase.ts),
-- and it is the trust border here too: it computes the hash and calls this
-- with the service role, exactly as it calls verify_share_password and
-- notify_disabled_attempt.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (create table if not exists + create or replace).
--
-- ORDERING: run this AFTER 001 (document_shares, rate_limits), 002
-- (check_rate_limit), 003 (notifications_log) and 035 (which rewrites
-- check_rate_limit on top of rate_limit_retry_after).
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The table
--
-- `notified_at` is the throttle, and it is on the report rather than on the
-- share because the report is where the fact belongs: this row is the one
-- that caused an email. A column on document_shares would be a second copy of
-- something this table already knows, and the query "when did we last email
-- about this share?" is a single index lookup either way.
--
-- Deliberately NOT here: any column that could identify the reporter, and any
-- status/triage column. Triage is three shares a year at today's volume; a
-- workflow column would be a workflow nobody runs.
-- ------------------------------------------------------------
create table if not exists public.abuse_reports (
  id                uuid primary key default gen_random_uuid(),
  share_id          uuid not null references public.document_shares(id) on delete cascade,
  reason            text not null
                      check (reason in ('phishing', 'malware', 'personal_data', 'other')),
  note              text check (note is null or char_length(note) <= 500),
  reporter_ip_hash  text,
  notified_at       timestamptz,
  created_at        timestamptz not null default now()
);

comment on column public.abuse_reports.reporter_ip_hash is
  'HMAC-SHA256 of the reporting address, keyed with the proxy SESSION_SECRET. Rate-limit identity only. The address itself is never sent to the database, and the key to reverse this is not in it.';
comment on column public.abuse_reports.notified_at is
  'When this report triggered the abuse email. Null on a report that fell inside another report''s six-hour window.';

create index if not exists idx_abuse_reports_share on public.abuse_reports (share_id, created_at desc);

-- ------------------------------------------------------------
-- 2. RLS — deny all
--
-- No policies at all, which with RLS on means no row is visible or writable
-- to `anon` or `authenticated` through PostgREST. The explicit revoke is the
-- belt to that braces: it also removes the table-level privilege, so a policy
-- added by accident in some later migration still grants nothing on its own.
--
-- A document owner deliberately cannot read reports about their own shares.
-- Reports are anonymous, and a sender who could read them could work out who
-- reported and when — for a phishing sender, that is the whole game.
-- ------------------------------------------------------------
alter table public.abuse_reports enable row level security;

revoke all on public.abuse_reports from anon, authenticated;

-- ------------------------------------------------------------
-- 3. report_abuse — the only write path
--
-- Returns jsonb so the proxy can tell the three outcomes apart and say
-- something true to the reporter:
--   {"ok": true,  "id": "..."}
--   {"ok": false, "error": "bad_reason" | "rate_limited" | "no_share"}
--
-- Never raises. A reporter who is doing us a favour must not meet a stack
-- trace, and the proxy has a page for each of these.
--
-- Empty search_path, objects written out in full: a SECURITY DEFINER function
-- resolves names on its owner's behalf, so a role holding CREATE on any
-- schema the path named could plant a shadow table and have it written as the
-- owner (the reasoning 035 wrote down for the rate limiter). `coalesce` and
-- `nullif` stay bare because they are parser constructs rather than functions
-- and cannot be schema-qualified at all — nothing can shadow them either.
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
    'Link: https://htmlradar.page/r/%s\n'
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

-- ------------------------------------------------------------
-- 4. Grants
--
-- Service role only, for the reason in the header: the rate-limit identity is
-- an argument, so a caller who can choose it can choose to have no limit.
-- Without the revoke, the default PUBLIC execute grant would hand that choice
-- to anyone holding the anon key.
-- ------------------------------------------------------------
revoke all on function public.report_abuse(text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_abuse(text, text, text, text) to service_role;

-- Make the new RPC callable immediately (PostgREST schema cache reload).
notify pgrst, 'reload schema';
