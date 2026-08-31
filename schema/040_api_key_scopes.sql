-- 040_api_key_scopes.sql
-- ------------------------------------------------------------
-- A key can be read-only.
--
-- Until now every key could do everything the public interface could do,
-- which was acceptable while the interface could only create a link and read
-- activity. MCP 0.2.0 adds revoking a link and replacing a document behind
-- links that have already been emailed, so a key sitting in a settings value
-- on a laptop is a larger object than it was. A watching or reporting
-- assistant — "tell me who read the proposal", "list what I sent this week" —
-- needs none of those powers, and should be able to hold a credential that
-- does not have them (31 August 2026 decision, MCP-INTENTIONALITY).
--
-- WHAT A SCOPE MEANS
--
--   full       everything the interface offers. The default, and what every
--              key created before this migration has always been.
--   read_only  whoami, activity, and the two listing endpoints. Refused with
--              403 on creating a link, revoking one, and replacing a
--              document.
--
-- Those two words are the whole vocabulary. The CHECK below is one guard and
-- the application's read is the other: it grants full access only for the
-- exact string 'full' and treats every other value, including one a later
-- migration might add, as 'read_only'. A scope column that fails open would
-- turn a single typo into an agent holding every power the account has.
--
-- WHERE IT IS ENFORCED
--
-- In the application, at authenticateApiKey (packages/app/src/lib/api-auth.ts),
-- on the routes that declare themselves as writing. Not in the database: the
-- write paths a key reaches are the service role's, and the service role
-- bypasses row-level security by design, so a policy here would enforce
-- nothing. The column is the record of what the customer chose; the API is
-- what honours it.
--
-- ONE THING THIS DELIBERATELY DOES NOT ADD
--
-- No guard making `scope` immutable. The update policy from 034 already
-- refuses any update by a signed-in session whose resulting row is not
-- revoked, so a browser cannot quietly promote a read-only key to a full one.
-- And the owner could create a full key in one click regardless — the scope is
-- a limit on what an agent holding the key may do, not a limit on the person.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent.
--
-- ORDERING: run this AFTER 034 (api_keys).
--
-- APPLIED: 31 August 2026. The two pre-apply fallbacks that let the API and the
-- settings page work without this column are gone with it, so a key row is now
-- read one way only and a key that cannot be written as asked is not written.
-- ------------------------------------------------------------

alter table public.api_keys
  add column if not exists scope text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'api_keys_scope_check'
  ) then
    alter table public.api_keys
      add constraint api_keys_scope_check check (scope in ('full', 'read_only'));
  end if;
end $$;

comment on column public.api_keys.scope is
  'full = every API route; read_only = whoami, activity and the listing routes only. Enforced in the application at authenticateApiKey, because the routes it guards run as the service role.';
