#!/usr/bin/env bash
# 047_radar_drafts_concurrency_test.sh
# ---------------------------------------------------------------------------
# The half of 047 that a single psql script cannot test: what happens when
# several requests arrive at once.
#
# Sol's review made this necessary rather than nice. The daily cap used to be a
# count followed later by a claim, so two taps could both see four posts and
# both proceed; the per-thread guard used to be a status column that the
# failure path released. Both now live inside reserve_radar_post() under one
# advisory lock, and the only honest way to show that is to run it concurrently
# against a real PostgreSQL — an in-memory stub in Vitest cannot reproduce
# transaction behaviour, and a psql file inside one transaction has only one
# session to play with.
#
# Four assertions, each with genuinely simultaneous callers:
#   1. Ten different threads race for a cap of five. Exactly five win.
#   2. Ten callers race for the SAME thread with different draft ids. Exactly
#      one wins; the rest are told the thread is taken.
#   3. The draft that owns a reservation may retry it (that is what lets a
#      reconciliation finish), while every other draft still cannot.
#   4. The reservation ledger is append-only: UPDATE and DELETE both raise,
#      including for the role the worker runs as.
#
# Self-contained. Starts its own throwaway PostgreSQL 15 in Docker, applies
# schema/047, runs, and removes the container. Needs only Docker:
#
#   schema/tests/047_radar_drafts_concurrency_test.sh
#
# Exits non-zero on the first failed assertion.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="${HERE}/../047_radar_drafts.sql"
CONTAINER="hr-047-concurrency-$$"
PSQL="docker exec -i ${CONTAINER} psql -U postgres -v ON_ERROR_STOP=1 -tAq"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL $*" >&2; exit 1; }
pass() { echo "PASS $*"; }

echo "Starting a throwaway PostgreSQL 15 ..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres postgres:15 >/dev/null
for _ in $(seq 1 40); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

# The roles Supabase provides, and the default privileges that make the service
# role the writer — the same setup 047_radar_drafts_test.sql documents.
$PSQL -c "create role anon;
          create role authenticated;
          create role service_role bypassrls;
          alter default privileges in schema public grant all on tables to service_role;
          alter default privileges in schema public grant execute on functions to service_role;" >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q < "$MIGRATION" >/dev/null
echo "Migration applied."

# Every caller is its own psql process, launched together and left to collide.
# `sleep` inside the transaction widens the window the lock has to close:
# without the lock, all ten would read the same count before any of them wrote.
race_distinct_threads() {
  local n=$1 out
  out=$(mktemp)
  for i in $(seq 1 "$n"); do
    (
      $PSQL -c "begin;
                select pg_sleep(0.05);
                select reserve_radar_post(gen_random_uuid(), 't3_race${i}');
                commit;" 2>/dev/null | tail -1 >> "$out"
    ) &
  done
  wait
  cat "$out"; rm -f "$out"
}

race_same_thread() {
  local n=$1 out
  out=$(mktemp)
  for i in $(seq 1 "$n"); do
    (
      $PSQL -c "begin;
                select pg_sleep(0.05);
                select reserve_radar_post(gen_random_uuid(), 't3_contested', 100);
                commit;" 2>/dev/null | tail -1 >> "$out"
    ) &
  done
  wait
  cat "$out"; rm -f "$out"
}

# --- 1. The cap holds when ten different threads arrive at once -------------
RESULT=$(race_distinct_threads 10)
OK=$(printf '%s\n' "$RESULT" | grep -c '^ok$' || true)
CAP=$(printf '%s\n' "$RESULT" | grep -c '^cap_reached$' || true)
ROWS=$($PSQL -c "select count(*) from radar_post_reservations;")
[ "$OK" = "5" ] || fail "1 expected exactly 5 winners under a cap of 5, got ${OK} (cap_reached: ${CAP})"
[ "$ROWS" = "5" ] || fail "1 expected 5 reservation rows, found ${ROWS}"
pass "1 ten simultaneous threads, cap of five: exactly five reservations"

# --- 2. One thread, ten callers, one winner ---------------------------------
# The cap is lifted for this one (the function takes it as an argument) so the
# five rows test 1 left behind cannot be mistaken for the reason nine callers
# were refused. Nothing is deleted: the ledger is append-only by design.
RESULT=$(race_same_thread 10)
OK=$(printf '%s\n' "$RESULT" | grep -c '^ok$' || true)
TAKEN=$(printf '%s\n' "$RESULT" | grep -c '^thread_taken$' || true)
[ "$OK" = "1" ] || fail "2 expected exactly 1 winner for one contested thread, got ${OK}"
[ "$TAKEN" = "9" ] || fail "2 expected 9 refusals, got ${TAKEN}"
pass "2 ten simultaneous callers, one thread: exactly one reservation"

# --- 3. The owner may retry; nobody else may --------------------------------
OWNER=$($PSQL -c "select draft_id from radar_post_reservations where thing_id = 't3_contested';")
SELF=$($PSQL -c "select reserve_radar_post('${OWNER}'::uuid, 't3_contested', 100);")
OTHER=$($PSQL -c "select reserve_radar_post(gen_random_uuid(), 't3_contested', 100);")
[ "$SELF" = "ok" ] || fail "3 the owning draft must be allowed to retry, got ${SELF}"
[ "$OTHER" = "thread_taken" ] || fail "3 another draft must not be allowed in, got ${OTHER}"
pass "3 the reservation's owner may retry after reconciliation; no other draft may"

# --- 4. Append-only means append-only ---------------------------------------
UPD=$(docker exec -i "$CONTAINER" psql -U postgres -tAq \
  -c "update radar_post_reservations set draft_id = gen_random_uuid();" 2>&1 || true)
DEL=$(docker exec -i "$CONTAINER" psql -U postgres -tAq \
  -c "delete from radar_post_reservations;" 2>&1 || true)
printf '%s' "$UPD" | grep -q 'append-only' || fail "4 UPDATE should have been refused, got: ${UPD}"
printf '%s' "$DEL" | grep -q 'append-only' || fail "4 DELETE should have been refused, got: ${DEL}"
pass "4 the reservation ledger refuses UPDATE and DELETE, even to the superuser"

echo "All concurrency assertions passed."
