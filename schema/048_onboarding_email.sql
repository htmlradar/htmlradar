-- 048_onboarding_email.sql
-- ------------------------------------------------------------
-- One onboarding e-mail per new account, about fifteen minutes after
-- sign-up: what the product is, the four ways to use it, what the read
-- report shows, and exactly what is recorded.
--
-- WHY IT LIVES HERE (SQL) AND NOT IN THE APP
--
-- Every e-mail this product sends already goes Resend-via-pg_net from the
-- database (003/020/025 notify_on_first_open, 028 notify_disabled_attempt,
-- 006 notify_on_feedback). Same Vault secrets, same notifications_log, same
-- template shell. Putting this one in the Next.js app would need the Resend
-- key in a second place and would give us two e-mail paths to reason about.
--
-- WHY A CRON SWEEP AND NOT A TRIGGER ON profiles
--
-- The founder's instruction is "within 15 minutes of sign-up", not "at
-- sign-up". A trigger fires inside the auth transaction, which is both too
-- early (the person is still in the product) and the wrong place to hang a
-- network call. A sweep every five minutes lands the mail 15-20 minutes
-- after the row appears, and a failed tick simply retries on the next one.
--
-- IDEMPOTENCY
--
-- profiles.onboarding_sent_at is the claim. A single data-modifying CTE
-- stamps the column and returns the rows it stamped, so a row can only ever
-- be claimed once; the send happens after the claim, never before. Two
-- overlapping runs cannot pick the same row (FOR UPDATE SKIP LOCKED), and a
-- row whose pg_net post fails is NOT retried — a duplicate onboarding
-- e-mail is worse than a missing one, and notifications_log records the
-- failure for a human to look at. To be exact about which failure that is:
-- pg_net's post is asynchronous, so an HTTP error arrives long after this
-- function has committed and the claim stands. An exception raised INSIDE
-- this function, before commit, rolls the claim back with everything else,
-- and the row is picked up again on the next run — which is what should
-- happen, because nothing was queued either.
--
-- WHO IS EXCLUDED
--
--   - internal addresses: draconic.ai and htmlradar.com (QA bots, the
--     founder's own accounts, the test recipient used below)
--   - comped accounts (032) — internal / lifetime rows, same reasoning
--   - anything older than 24 hours, so switching the job on does not mail
--     the entire existing user base retroactively
--   - anything younger than 15 minutes, which is the delay itself
--
-- THE JOB IS SHIPPED SWITCHED OFF. The cron.schedule call at the bottom is
-- commented out deliberately: the founder gets the test send in his own
-- inbox first and says "switch on onboarding" before any customer receives
-- one. The single statement that turns it on is in that block.
--
-- Apply AFTER 003 (notifications_log), 032 (profiles.comped) and 044
-- (the 'sent'/'unverified' statuses the reconciler writes). Idempotent:
-- add-column-if-not-exists plus create-or-replace.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The claim column, and a kind on notifications_log.
--
-- notifications_log has never distinguished which trigger wrote a row.
-- It did not need to while every row was a first-open notification; it does
-- now, so the sentinel can count onboarding sends separately from read
-- alerts. Nullable with no default: existing rows stay null and keep
-- meaning exactly what they meant before this migration.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists onboarding_sent_at timestamptz;

comment on column public.profiles.onboarding_sent_at is
  'When the one-time onboarding e-mail was claimed for this account (048). Null means not yet sent; it is stamped before the send, so a failed send is never retried.';

alter table public.notifications_log
  add column if not exists kind text;

comment on column public.notifications_log.kind is
  'Which sender wrote this row: ''onboarding'' (048). Null on every row written before 048, which is the first-open / feedback / disabled-link path.';

-- Partial index on the pending set. profiles is small today, but this is
-- the predicate a job runs every five minutes forever, and the index stays
-- tiny by construction: it only ever holds rows that have not been mailed.
create index if not exists idx_profiles_onboarding_pending
  on public.profiles (created_at)
  where onboarding_sent_at is null;

-- ------------------------------------------------------------
-- 2. send_onboarding_emails()
--
-- SECURITY DEFINER for the same reasons as notify_disabled_attempt: it
-- reads vault.decrypted_secrets, writes notifications_log and app_events,
-- and calls pg_net. Returns the number of e-mails it queued, so a manual
-- run says plainly what it did.
-- ------------------------------------------------------------
create or replace function public.send_onboarding_emails(p_only_email text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_resend_key text;
  v_from       text;
  v_row        record;
  v_request_id bigint;
  v_sent       integer := 0;
  v_subject    text := 'Your HTMLRadar account, and the four ways to use it';
  v_html       text;
  v_text       text;
begin
  -- Resend config from Vault (the same two secrets every other e-mail uses).
  begin
    select decrypted_secret into v_resend_key
    from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
    select decrypted_secret into v_from
    from vault.decrypted_secrets where name = 'resend_from' limit 1;
  exception when others then
    v_resend_key := null;
    v_from := null;
  end;

  -- Claim nothing if we cannot send. Unlike 028 there is no throttle to
  -- stamp here: leaving onboarding_sent_at null is exactly right, because
  -- the next tick after the secrets are fixed should still send this.
  if v_resend_key is null or v_from is null then
    insert into notifications_log (session_id, email_to, status, error_message, kind)
    values (null, 'onboarding-sweep', 'skipped', 'resend secrets not in Vault', 'onboarding');
    return 0;
  end if;

  -- ------------------------------------------------------------
  -- The body. Identical for every recipient — there is no personalisation
  -- and deliberately none: a first name we half-know reads worse than not
  -- using one, and a template with no substitutions cannot mis-substitute.
  --
  -- Table-based, 600px, inline styles, system font stack only. The five
  -- images are static PNGs generated by
  -- packages/app/scripts/generate-onboarding-cards.mjs and served from
  -- htmlradar.com/brand/email/; every one has alt text that carries its
  -- sentence on its own, because Outlook blocks images by default.
  --
  -- TO CHANGE THE COPY: edit it here and re-run this whole file (it is a
  -- create-or-replace). packages/app/scripts/render-onboarding-email.mjs
  -- reads the HTML back out of THIS file to build the previews, so there is
  -- one copy of it and it is this one.
  -- ------------------------------------------------------------
  v_html := $html$
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Your HTMLRadar account, and the four ways to use it</title>
  <style>
    /* The only rules that are not inline. Gmail, Apple Mail and the iOS
       clients honour these; Outlook desktop ignores them and keeps the
       600px desktop layout, which is what it should show anyway. */
    @media only screen and (max-width: 480px) {
      .col { display: block !important; width: 100% !important; max-width: 100% !important; }
      .gut { display: none !important; width: 0 !important; }
      .pad { padding-left: 20px !important; padding-right: 20px !important; }
      .h1  { font-size: 27px !important; }
      .stack-gap { display: block !important; height: 26px !important; line-height: 26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#FBF1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F1108;-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">The four ways in, what the read report shows, and exactly what we record.</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBF1E8;">
  <tr><td align="center" style="padding:40px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:#FBF1E8;">

      <!-- lockup -->
      <tr><td class="pad" style="padding:0 24px 30px 24px;">
        <span style="display:inline-block;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#5A1521;font-weight:600;">HTML<span style="color:#7A1F2E;font-style:italic;font-weight:500;">Radar</span></span>
      </td></tr>

      <!-- opening -->
      <tr><td class="pad" style="padding:0 24px 8px 24px;">
        <p style="margin:0;font-size:15.5px;line-height:1.6;color:#1F1108;">Hello,</p>
      </td></tr>
      <tr><td class="pad" style="padding:0 24px 26px 24px;">
        <p style="margin:0 0 14px 0;font-size:15.5px;line-height:1.65;color:#3A2818;">You made an account, so here is what HTMLRadar does and the four ways to use it.</p>
        <p style="margin:0 0 14px 0;font-size:15.5px;line-height:1.65;color:#3A2818;">The documents that matter are becoming HTML because an HTML page can be interactive, reflows to whatever screen opens it, and can be changed after it has been sent - none of which a PDF you have already sent can do. Sending one is where it breaks: a PDF loses what made it good, and hosting it yourself tells you nothing about who read it.</p>
        <p style="margin:0;font-size:15.5px;line-height:1.65;color:#3A2818;">HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link, and seeing who opened it, which sections they read, and for how long.</p>
      </td></tr>

      <!-- four doors -->
      <tr><td class="pad" style="padding:8px 24px 18px 24px;border-top:1px solid #E8D5BD;">
        <p class="h1" style="margin:22px 0 0 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:#1F1108;letter-spacing:-0.01em;">Four ways in.</p>
        </td></tr>

      <tr><td class="pad" style="padding:0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td class="col" width="264" valign="top" style="width:264px;">
              <img src="https://htmlradar.com/brand/email/door-upload.png" width="264" alt="The New document form, with Upload HTML selected and a drop zone reading: click to browse for an HTML file, single-file HTML up to 30 MB." style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:10px;">
              <p style="margin:12px 0 0 0;font-size:15px;font-weight:600;line-height:1.4;color:#1F1108;">1. Upload it in the dashboard.</p>
              <p style="margin:6px 0 0 0;font-size:14.5px;line-height:1.55;color:#3A2818;">One HTML file, up to 30 MB. PDFs and spreadsheets ride along as downloads.</p>
              <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;"><a href="https://htmlradar.com/new?utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=door_upload" style="color:#5A1521;text-decoration:underline;">Upload a document</a></p>
            </td>
            <td class="gut" width="24" style="width:24px;">&nbsp;</td>
            <td class="col" width="264" valign="top" style="width:264px;">
              <div class="stack-gap" style="display:none;height:0;line-height:0;">&nbsp;</div>
              <img src="https://htmlradar.com/brand/email/door-url.png" width="264" alt="The same form with Use a URL selected and a page URL field containing https://acme.com/q3-brief.html" style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:10px;">
              <p style="margin:12px 0 0 0;font-size:15px;font-weight:600;line-height:1.4;color:#1F1108;">2. Point at a URL you host.</p>
              <p style="margin:6px 0 0 0;font-size:14.5px;line-height:1.55;color:#3A2818;">If the page lives on your domain, share the tracked link instead.</p>
              <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;"><a href="https://htmlradar.com/new?mode=url&amp;utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=door_url" style="color:#5A1521;text-decoration:underline;">Track a URL</a></p>
            </td>
          </tr>
          <tr><td colspan="3" height="28" style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td class="col" width="264" valign="top" style="width:264px;">
              <img src="https://htmlradar.com/brand/email/door-api.png" width="264" alt="A curl call to htmlradar.com/api/v1/shares/ID/activity with a bearer key, returning JSON: opened true, viewers with email jane@acme.com, active_seconds 374, max_scroll 87." style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:10px;">
              <p style="margin:12px 0 0 0;font-size:15px;font-weight:600;line-height:1.4;color:#1F1108;">3. Call the API.</p>
              <p style="margin:6px 0 0 0;font-size:14.5px;line-height:1.55;color:#3A2818;">Key-authenticated endpoints at <span style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#5A1521;">/api/v1</span>: create a document, make a share, read its activity.</p>
              <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;"><a href="https://htmlradar.com/docs/api?utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=door_api" style="color:#5A1521;text-decoration:underline;">The API reference</a></p>
            </td>
            <td class="gut" width="24" style="width:24px;">&nbsp;</td>
            <td class="col" width="264" valign="top" style="width:264px;">
              <div class="stack-gap" style="display:none;height:0;line-height:0;">&nbsp;</div>
              <img src="https://htmlradar.com/brand/email/door-agent.png" width="264" alt="An agent transcript: share the Q3 brief with jane@acme.com, then a share_html result, then did anyone read it, then jane@acme.com, 4m 12s, scrolled 87 per cent." style="display:block;width:100%;max-width:264px;height:auto;border:0;border-radius:10px;">
              <p style="margin:12px 0 0 0;font-size:15px;font-weight:600;line-height:1.4;color:#1F1108;">4. Let your agent do it.</p>
              <p style="margin:6px 0 0 0;font-size:14.5px;line-height:1.55;color:#3A2818;">The npm package htmlradar-mcp gives Claude Code, or any MCP client, seven tools. In Claude, add a custom connector at <span style="font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#5A1521;">https://mcp.htmlradar.com/mcp</span> instead.</p>
              <p style="margin:8px 0 0 0;font-size:14px;line-height:1.5;"><a href="https://htmlradar.com/mcp?utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=door_agent" style="color:#5A1521;text-decoration:underline;">Set it up</a></p>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- the read report -->
      <tr><td class="pad" style="padding:36px 24px 18px 24px;">
        <p class="h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:#1F1108;letter-spacing:-0.01em;">What comes back.</p>
        <p style="margin:12px 0 0 0;font-size:15.5px;line-height:1.65;color:#3A2818;">Sections come from your own markup, so nothing needs tagging, and a three-second floor stops a scroll-past counting as a read. An e-mail lands the first time a recipient opens the link.</p>
      </td></tr>
      <tr><td class="pad" style="padding:0 24px;">
        <img src="https://htmlradar.com/brand/email/read-report.png" width="552" alt="A read report for Q3 Brief, Acme: recipient Jane, 3 opens, 6m 14s active read, 87 per cent scrolled, and time per section - The Ask 2m 41s, Scope and timeline 1m 58s, Team 1m 35s, Pricing 12s, Appendix none." style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:12px;">
      </td></tr>

      <!-- the boundary -->
      <tr><td class="pad" style="padding:36px 24px 0 24px;">
        <p class="h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:#1F1108;letter-spacing:-0.01em;">What we record.</p>
        <p style="margin:12px 0 0 0;font-size:15.5px;line-height:1.65;color:#3A2818;">When a recipient opens a share we record the email they enter at the gate if the share asks, a random fingerprint in their browser, session metrics, and IP-derived country and city - never the IP itself. We don't collect keystrokes, mouse positions, third-party trackers, anything from outside the document, or anything that identifies the recipient beyond the email they provided.</p>
        <p style="margin:10px 0 0 0;font-size:14px;line-height:1.5;"><a href="https://htmlradar.com/privacy?utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=privacy" style="color:#5A1521;text-decoration:underline;">The full policy</a></p>
      </td></tr>

      <!-- plan + close -->
      <tr><td class="pad" style="padding:30px 24px 0 24px;">
        <p style="margin:0;font-size:15.5px;line-height:1.65;color:#3A2818;">Two tracked links are free; the source is AGPL-3.0 if you self-host.</p>
        <p style="margin:16px 0 0 0;font-size:15.5px;line-height:1.65;color:#1F1108;">Reply to this and it reaches me.</p>
        <p style="margin:20px 0 0 0;font-size:15.5px;line-height:1.65;color:#1F1108;">Cheers,<br>Abhinandan</p>
      </td></tr>

      <!-- footer -->
      <tr><td class="pad" style="padding:30px 24px 0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E8D5BD;">
          <tr><td style="padding:18px 0 0 0;">
            <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,Consolas,monospace;font-size:11px;line-height:1.6;color:#876959;letter-spacing:0.02em;">You are getting this once, because you made an HTMLRadar account. <a href="https://htmlradar.com?utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=footer" style="color:#876959;text-decoration:underline;">htmlradar.com</a></p>
          </td></tr>
        </table>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
$html$;

  -- Plain-text alternative. Not a stripped copy of the HTML: the same
  -- sentences, laid out for a terminal, so a text-only client gets a
  -- readable letter rather than a transcript of a layout.
  v_text := $txt$Hello,

You made an account, so here is what HTMLRadar does and the four ways to use it.

The documents that matter are becoming HTML because an HTML page can be interactive, reflows to whatever screen opens it, and can be changed after it has been sent - none of which a PDF you have already sent can do. Sending one is where it breaks: a PDF loses what made it good, and hosting it yourself tells you nothing about who read it.

HTMLRadar is an open-source tool for sharing an HTML deck, brief, or proposal as a tracked link, and seeing who opened it, which sections they read, and for how long.

FOUR WAYS IN

1. Upload it in the dashboard.
   One HTML file, up to 30 MB. PDFs and spreadsheets ride along as downloads.
   https://htmlradar.com/new

2. Point at a URL you host.
   If the page lives on your domain, share the tracked link instead.
   https://htmlradar.com/new?mode=url

3. Call the API.
   Key-authenticated endpoints at /api/v1: create a document, make a share, read its activity.
   https://htmlradar.com/docs/api

4. Let your agent do it.
   The npm package htmlradar-mcp gives Claude Code, or any MCP client, seven tools. In Claude, add a custom connector at https://mcp.htmlradar.com/mcp instead.
   https://htmlradar.com/mcp

WHAT COMES BACK

Sections come from your own markup, so nothing needs tagging, and a three-second floor stops a scroll-past counting as a read. An e-mail lands the first time a recipient opens the link.

WHAT WE RECORD

When a recipient opens a share we record the email they enter at the gate if the share asks, a random fingerprint in their browser, session metrics, and IP-derived country and city - never the IP itself. We don't collect keystrokes, mouse positions, third-party trackers, anything from outside the document, or anything that identifies the recipient beyond the email they provided.

https://htmlradar.com/privacy

Two tracked links are free; the source is AGPL-3.0 if you self-host.

Reply to this and it reaches me.

Cheers,
Abhinandan

--
You are getting this once, because you made an HTMLRadar account.
https://htmlradar.com
$txt$;

  -- ------------------------------------------------------------
  -- Claim, then send. The CTE is the whole of the concurrency story:
  -- SKIP LOCKED keeps two overlapping runs on disjoint rows, and the
  -- UPDATE ... RETURNING means a row leaves the pending set at the moment
  -- it is picked, not after the network call.
  --
  -- p_only_email is the test hatch: pass an address and the sweep considers
  -- that ONE account and no other, ignoring every selection rule - the
  -- domain exclusion, the comped flag, and both ends of the age window.
  -- All four have to go, not just the domain one: the founder's own account
  -- is months old and on an excluded domain, and a test send that could not
  -- reach it would not be testing the path anyone will actually receive.
  -- The narrowing is the address itself, and it still claims the row, so
  -- even a test cannot be sent twice.
  -- ------------------------------------------------------------
  for v_row in
    with candidates as (
      select p.id
        from profiles p
       where p.onboarding_sent_at is null
         and p.email is not null
         and p.email <> ''
         and (
           p_only_email is not null
           or (
                 p.created_at <= now() - interval '15 minutes'
             and p.created_at >  now() - interval '24 hours'
             and coalesce(p.comped, false) = false
             and lower(split_part(p.email, '@', 2)) not in ('draconic.ai', 'htmlradar.com')
           )
         )
         and (p_only_email is null or lower(p.email) = lower(p_only_email))
       order by p.created_at
       limit 50
         for update skip locked
    ),
    claimed as (
      update profiles p
         set onboarding_sent_at = now()
        from candidates c
       where p.id = c.id
      returning p.id, p.email
    )
    select id, email from claimed
  loop
    select net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_resend_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', v_from,
        'to', array[v_row.email],
        'reply_to', 'hello@htmlradar.com',
        'subject', v_subject,
        'html', v_html,
        'text', v_text,
        -- mailto only. There is no unsubscribe endpoint to point at and no
        -- list to leave: this e-mail is sent once per account, ever. The
        -- header exists because the big mailbox providers read it as a
        -- sender-quality signal, and it reaches a human who can act on it.
        'headers', jsonb_build_object(
          'List-Unsubscribe', '<mailto:hello@htmlradar.com?subject=unsubscribe>'
        )
      )
    ) into v_request_id;

    insert into notifications_log (session_id, email_to, request_id, status, kind)
    values (null, v_row.email, v_request_id, 'queued', 'onboarding');

    insert into app_events (distinct_id, event, properties, user_id)
    values (v_row.id::text, 'onboarding.email_queued', '{}'::jsonb, v_row.id);

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$fn$;

comment on function public.send_onboarding_emails(text) is
  'Sends the one-time onboarding e-mail to accounts created between 15 minutes and 24 hours ago that have not had one, excluding comped accounts and the draconic.ai / htmlradar.com domains. Claims each row by stamping profiles.onboarding_sent_at inside the same statement that selects it, so it is idempotent and never re-sends. Logs to notifications_log with kind=''onboarding''. Pass an address to send to exactly that one account, bypassing every selection rule including the age window and the comped flag (the test hatch). Returns the number queued.';

revoke all on function public.send_onboarding_emails(text) from public, anon, authenticated;
grant execute on function public.send_onboarding_emails(text) to service_role;

-- ------------------------------------------------------------
-- 3. The schedule — SHIPPED OFF ON PURPOSE.
--
-- Nothing below runs. The founder receives the test send first
-- (select send_onboarding_emails('hello@htmlradar.com');) and only then
-- does anyone switch this on. To switch it on, run exactly this one
-- statement in the Supabase SQL editor:
--
--   select cron.schedule('send_onboarding_emails', '*/5 * * * *', 'select public.send_onboarding_emails();');
--
-- To switch it off again:
--
--   select cron.unschedule('send_onboarding_emails');
--
-- The guarded do-block below is the form the other scheduled jobs use
-- (044, 045); it is left commented so that re-running this whole file
-- can never quietly enable the job.
-- ------------------------------------------------------------
-- do $sched$
-- begin
--   create extension if not exists pg_cron;
--   if exists (select 1 from pg_extension where extname = 'pg_cron') then
--     if exists (select 1 from cron.job where jobname = 'send_onboarding_emails') then
--       perform cron.unschedule('send_onboarding_emails');
--     end if;
--     perform cron.schedule(
--       'send_onboarding_emails',
--       '*/5 * * * *',
--       'select public.send_onboarding_emails();'
--     );
--   end if;
-- end
-- $sched$;

notify pgrst, 'reload schema';
