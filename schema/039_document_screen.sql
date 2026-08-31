-- 039_document_screen.sql
-- ------------------------------------------------------------
-- Every uploaded document carries the phishing screen's verdict, and a high
-- one reaches a human.
--
-- Layer 2 of the anti-phishing plan behind the content-domain switch
-- (docs/control/APPROACH-CARD-content-domain-2026-08-30.md). Layer 4, the
-- recipient's report form, is schema/037 and it only works after somebody has
-- already been sent the page. This layer looks at the page as it arrives.
--
-- The screen itself is TypeScript, not SQL — packages/app/src/lib/screen-html.ts,
-- a pure function every upload path runs before the row is written. It never
-- blocks an upload. A wrong "no" costs a paying customer their document; a
-- wrong "yes" costs an operator one glance. So the score is written down, and
-- at or above 50 an abuse_reports row is written too, and the upload completes
-- either way.
--
-- WHAT THIS FILE ADDS
--
--   1. `documents.screen_score` / `documents.screen_signals` — the verdict and
--      the named signals that produced it, plus an index for "show me the
--      highest-scoring uploads".
--   2. `abuse_reports.document_id`, and `share_id` made nullable — an
--      automated flag is about a document, and at upload time no link to it
--      exists yet. See the section below; this is the one part of this
--      migration that changes an existing table's shape.
--   3. `notify_screen_flag` — the email. Without it this is a table nobody
--      reads: `report_abuse` (037) holds the only abuse email in the system
--      and it is keyed on a share, so an automated flag inserted directly
--      would reach the database and stop there.
--
-- NOT HERE: any RLS change. `documents` keeps its owner-scoped policy and
-- `abuse_reports` keeps having no policies at all, so the new column is as
-- unreadable to a customer as every other column on that table.
--
-- KNOWN AND ACCEPTED: row-level security scopes rows, not columns (the lesson
-- of 032 and 033), so a customer can UPDATE their own document's screen_score
-- to zero through PostgREST with the anon key. The score is advisory. The row
-- an operator acts on is in abuse_reports, which no customer-facing role can
-- read, write or delete, and which nothing in the app ever updates.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (add-column-if-not-exists + drop-if-exists + create-or-replace).
--
-- ORDERING: run this AFTER 037 (abuse_reports) and 035 (check_rate_limit on
-- top of rate_limit_retry_after). Run it BEFORE deploying the app code that
-- writes screen_score, which would otherwise fail every upload on an unknown
-- column.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The verdict, on the document
--
-- Nullable, and null means "not screened" rather than "screened, clean". Every
-- document that existed before this migration is null, and so is every
-- URL-source document forever: there is no HTML in hand at upload time for one
-- of those, and fetching the address to get some would put a network call on
-- the upload path and a request-forgery surface next to it.
--
-- `screen_signals` is the names, not a second copy of the score. An operator
-- reading a flagged row needs to know it was a password box next to the word
-- Microsoft rather than a long minified script, and the weights live in one
-- place — the TypeScript — so that reading them back out of a number here is
-- never necessary.
-- ------------------------------------------------------------
alter table public.documents
  add column if not exists screen_score integer;

alter table public.documents
  add column if not exists screen_signals text[];

comment on column public.documents.screen_score is
  'Upload-time phishing screen total (packages/app/src/lib/screen-html.ts). Null means not screened: every document predating schema/039, and every URL-source document. Advisory only — RLS scopes rows, not columns, so the owner can rewrite this. The abuse_reports row is the record.';
comment on column public.documents.screen_signals is
  'The named signals behind screen_score, e.g. {password-input,brand-login-wording}.';

-- Partial: the interesting query is always "the highest-scoring uploads", and
-- the unscreened rows are the majority and are never the answer to it.
create index if not exists idx_documents_screen_score
  on public.documents (screen_score desc)
  where screen_score is not null;

-- ------------------------------------------------------------
-- 2. An abuse report about a document rather than a link
--
-- 037 built this table around the only reporter it had: a recipient, who has a
-- slug in their address bar and therefore a share. The screen has neither. A
-- document is created before any link to it exists — that is true on all three
-- upload paths — so an automated flag has a document and nothing else.
--
-- So `document_id` is added and `share_id` is relaxed, with a constraint that
-- one of them must be there. A row naming neither would be a report about
-- nothing, which is the only shape this table must never hold.
--
-- Both cascade on delete, which is deliberate on the new column too: if the
-- document is gone there is nothing left for an operator to look at, and a
-- flag pointing at a deleted document is a queue item nobody can action.
-- ------------------------------------------------------------
alter table public.abuse_reports
  add column if not exists document_id uuid references public.documents(id) on delete cascade;

alter table public.abuse_reports
  alter column share_id drop not null;

alter table public.abuse_reports
  drop constraint if exists chk_abuse_subject;
alter table public.abuse_reports
  add constraint chk_abuse_subject
  check (share_id is not null or document_id is not null);

comment on column public.abuse_reports.document_id is
  'The document an automated upload screen flagged. Null on a recipient report, which names a share instead. Exactly one of share_id / document_id is set in practice.';

create index if not exists idx_abuse_reports_document
  on public.abuse_reports (document_id, created_at desc)
  where document_id is not null;

-- ------------------------------------------------------------
-- 3. The email
--
-- One per automated flag, to the same inbox and the same runbook as a
-- recipient's report. This is a trigger rather than something the application
-- does because every email in this system is sent from Postgres via Vault and
-- pg_net (003, 028, 037) and the application has no mail path of its own.
--
-- Fires only on an automated flag. `report_abuse` sends its own email and must
-- not send a second one, so the WHEN clause is what keeps the two apart.
--
-- Throttled per owner rather than per document: the failure this guards
-- against is one account uploading fifty phishing pages in a minute, and fifty
-- emails about that would bury the second account also doing it. Five an hour
-- is enough to notice a campaign and few enough to read. The counter is the
-- ordinary rate limiter from 002/035, so this needs no state of its own.
--
-- Never raises. An upload must not fail because an operator could not be
-- emailed about it, and the insert has already happened by the time this runs.
-- ------------------------------------------------------------
create or replace function public.notify_screen_flag()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_doc        public.documents%rowtype;
  v_resend_key text;
  v_from       text;
  v_to         text := 'abuse@htmlradar.com';
  v_subject    text;
  v_body       text;
  v_request_id bigint;
begin
  select * into v_doc from public.documents where id = new.document_id;
  if not found then
    return null;
  end if;

  if not public.check_rate_limit(
       'abuse_screen_notify:' || v_doc.owner_id::text, 3600, 5) then
    return null;
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
    insert into public.notifications_log (session_id, email_to, status, error_message)
    values (null, v_to, 'skipped', 'resend secrets not in Vault');
    update public.abuse_reports set notified_at = pg_catalog.now() where id = new.id;
    return null;
  end if;

  -- Plain text, same reasoning as report_abuse: the body carries a document
  -- title the customer wrote, and text/plain cannot carry markup into the
  -- reader's client, so there is nothing to escape and nothing to get wrong.
  v_subject := 'Upload screen flag: ' || pg_catalog.coalesce(v_doc.title, 'untitled document');
  v_body := pg_catalog.format(
    E'An uploaded document scored at or above the phishing screen threshold.\n'
    'Nothing was blocked — the customer has their document and can share it.\n'
    '\n'
    '%s\n'
    'Document: %s\n'
    'Document id: %s\n'
    'Owner id: %s\n'
    'Uploaded: %s\n'
    '\n'
    'The stored HTML is in the htmlradar-docs R2 bucket at %s\n'
    '\n'
    'Report id %s\n'
    'Runbook: docs/workstreams/security/ABUSE-RUNBOOK.md\n'
    'At most five of these per account per hour.\n',
    pg_catalog.coalesce(new.note, '(no signals recorded)'),
    pg_catalog.coalesce(v_doc.title, '(untitled)'),
    v_doc.id::text,
    v_doc.owner_id::text,
    v_doc.created_at::text,
    pg_catalog.coalesce(v_doc.r2_key, '(none)'),
    new.id::text
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

  update public.abuse_reports set notified_at = pg_catalog.now() where id = new.id;
  return null;
exception when others then
  -- The row is already written and that is the part that matters. A failed
  -- send must not roll back the flag it was announcing.
  return null;
end;
$$;

drop trigger if exists trg_notify_screen_flag on public.abuse_reports;
create trigger trg_notify_screen_flag
  after insert on public.abuse_reports
  for each row
  when (new.share_id is null and new.document_id is not null)
  execute function public.notify_screen_flag();

-- The trigger function is called by the trigger, never by a client. Nothing is
-- granted to anon or authenticated, and PUBLIC's default execute grant is
-- removed for the same reason 037 removes it from report_abuse.
revoke all on function public.notify_screen_flag() from public, anon, authenticated;

notify pgrst, 'reload schema';
