-- 031_notify_email_tell_a_friend.sql
-- ------------------------------------------------------------
-- One quiet word-of-mouth line in the first-read notification email.
--
-- Rationale: this email lands at the sender's moment of peak delight
-- (someone is reading their doc right now) — the one moment worth a
-- gentle "tell a friend". Deliberately NOT a referral program: no codes,
-- no rewards, no pricing promises — at the current user count, referral
-- machinery amplifies a base that doesn't exist yet. The line is passive,
-- matches the email's mono footer style, and its clicks are attributable
-- (utm_campaign=tell_a_friend) via the client's existing UTM capture.
--
-- Mechanics: same targeted-replace pattern as 030 — patches the live
-- notify_on_first_open definition, inserting one table row above the
-- "Referrer ·" footer row (anchored on that row's unique border-top
-- style). Idempotent: guarded on the utm_campaign marker.
--
-- Apply: paste into the Supabase SQL editor, run once (after 025 + 030).
-- ------------------------------------------------------------

do $$
declare
  fn_src text;
begin
  select pg_get_functiondef(oid) into fn_src
  from pg_proc where proname = 'notify_on_first_open';
  if fn_src is null then
    raise exception 'notify_on_first_open not found — run 025 first';
  end if;
  if position('tell_a_friend' in fn_src) = 0 then
    fn_src := replace(
      fn_src,
      $a$<tr><td style="padding:24px 8px 0 8px;border-top:1px solid #E8D5BD;">$a$,
      $b$<tr><td style="padding:18px 8px 0 8px;">
        <p style="margin:0;font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-size:11px;color:#876959;letter-spacing:0.02em;">Know someone who sends decks or proposals? Point them at <a href="https://htmlradar.com/?utm_source=email&utm_medium=notification&utm_campaign=tell_a_friend" style="color:#5A1521;text-decoration:none;">htmlradar.com</a>.</p>
      </td></tr>
      <tr><td style="padding:24px 8px 0 8px;border-top:1px solid #E8D5BD;">$b$
    );
    execute fn_src;
  end if;
end $$;
