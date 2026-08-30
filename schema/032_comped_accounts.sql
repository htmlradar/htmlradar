-- 032_comped_accounts.sql
-- ------------------------------------------------------------
-- profiles.comped — internal / lifetime Pro accounts that billing never touches.
--
-- Why this exists now: entitlement reads profiles.tier and nothing else
-- (app quota.ts, proxy getProfileTier, the 027 share-cap trigger). pro_until
-- was display-only and nothing ever expired a lapsed Pro, so a cancelled
-- subscriber stayed Pro forever. The monitor cron now sweeps tier 'pro' →
-- 'free' once pro_until is in the past.
--
-- That sweep would also demote the internal accounts, which have no Polar
-- subscription and never will — they'd bounce to free on the next 5-minute
-- tick. comped is the exemption: the sweep skips these rows, and the Polar
-- webhook refuses to write to a comped profile at all, so a stray order or
-- revoke event can't flip an internal account either.
--
-- Deliberately NOT touched here:
--   - pro_until stays as-is on the comped rows. The sweep ignores comped, so a
--     lapsed value is harmless, and it preserves the record of when the real
--     subscription actually ended.
--   - pro_since stays as-is (real signup history).
--   - Every other row is left alone. Paying customers keep their normal
--     comped = false default and keep expiring on schedule.
--
-- Apply: paste into the Supabase SQL editor, run once. Idempotent
-- (add-column-if-not-exists + an id-keyed update that re-runs to the same state).
--
-- ORDERING: run this BEFORE deploying the code that reads `comped` (the Polar
-- webhook's profile read and the monitor's expirePro filter). Both reference the
-- column by name; against a database without it PostgREST 400s, which fails the
-- webhook closed (HTTP 500, Polar retries) and makes the sweep alert instead of
-- downgrading anyone. Nothing corrupts either way — but the window is avoidable,
-- so migrate first.
-- ------------------------------------------------------------

alter table profiles
  add column if not exists comped boolean not null default false;

comment on column profiles.comped is
  'Internal / lifetime account: keeps Pro entitlement permanently, is never billed, and is exempt from the pro_until expiry sweep.';

-- SELF-HOSTERS: PUT YOUR OWN ADDRESSES HERE. The comped_addresses list below
-- is a placeholder — replace the reserved example addresses with the sign-in
-- addresses of your internal / lifetime-Pro accounts (one quoted address per
-- row), then run once. Addresses are resolved to profile ids through
-- auth.users at run time; an address with no account is skipped. If you have
-- no comped accounts, leave the list as-is: the examples match nothing.
with comped_addresses(email) as (
  values
    ('founder@example.test'),
    ('teammate@example.test')
)
update profiles p
set comped = true,
    tier   = 'pro'
from auth.users u
join comped_addresses c on lower(u.email) = lower(c.email)
where p.id = u.id;

-- No index on (comped, pro_until): profiles is ~17 rows, so the sweep's
-- "tier = 'pro' and comped = false and pro_until < now()" is a sequential scan
-- either way — the planner would ignore an index this small. Revisit only if
-- profiles ever reaches thousands of rows.

-- ------------------------------------------------------------
-- Column-level lockdown on profiles. This is a live privilege-escalation fix
-- and it is NOT about the comped column — comped just made it impossible to
-- ignore.
--
-- profiles_owner_update (001) scopes writes by ROW:
--     for update to authenticated using (id = auth.uid()) with check (id = auth.uid())
-- ...but not by COLUMN, and `authenticated` holds table-level UPDATE. RLS
-- decides WHICH ROW you may write, never WHICH COLUMNS. So any signed-in user
-- could PATCH their own profile row and set whatever they liked in it.
--
-- Confirmed against production on 2026-08-04, not theorised: signing in as the
-- QA bot with the public anon key and issuing
--     PATCH /rest/v1/profiles?id=eq.<own uid>  {"tier":"pro","pro_until":"2099-01-01"}
-- returned 200 with tier=pro. Every signed-up user has had a self-service Pro
-- button since 001. (The QA row was restored to free immediately.) Adding
-- `comped` to that reachable set would have upgraded the hole from "free Pro
-- until someone notices" to "free Pro that is permanent and sweep-proof".
--
-- Postgres has no "grant update on everything except" form, so: drop the
-- table-level grant and re-grant only the two presentation fields the app
-- actually lets a user edit. Today only `timezone` is written from the client
-- (app/(app)/actions.ts); `display_name` is included because it is the same
-- class of user-owned field and the settings page already reads it — locking it
-- out would plant a confusing failure the day someone wires up the editor.
--
-- Everything to do with money — tier, pro_since, pro_until, comped — becomes
-- service-role-only. That is already the only place it is written from: the
-- Polar webhook uses SUPABASE_SERVICE_ROLE_KEY, which bypasses both RLS and
-- these grants, so nothing legitimate changes. RLS still applies on top, so a
-- user remains confined to their own row for the two columns they do keep.
revoke update on profiles from authenticated;
grant  update (display_name, timezone) on profiles to authenticated;
