#!/bin/bash
# Rehearse pending migrations against a copy of production data, in a
# throwaway local database, before they're applied for real.
#
#   1. Find the newest migration production has applied.
#   2. Dump production's public-schema data (stays on this machine/runner).
#   3. Reset the local database to that same version and load the data.
#   4. Snapshot invariants (supabase/rehearsal/snapshot.sql), apply the
#      pending migrations, snapshot again, and require they match.
#   5. Require every public view named *_check to be empty.
#
# The repo is public, so this prints only pass/fail and counts, never data.
#
# Source database: the linked project by default (CI: SUPABASE_ACCESS_TOKEN +
# SUPABASE_DB_PASSWORD + `supabase link`), or REHEARSAL_DB_URL if set.
# Needs Docker (local Supabase), psql and jq.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${REHEARSAL_DB_URL:-}" ]; then
  SOURCE=(--db-url "$REHEARSAL_DB_URL")
else
  SOURCE=(--linked)
fi
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "REHEARSAL FAILED: $*" >&2; exit 1; }

# 1. Production's migration state vs. this branch's.
supabase migration list "${SOURCE[@]}" --output-format json > "$WORK/migrations.json"
PROD_VERSION="$(jq -r '[.migrations[].remote | select(. != "")] | max // empty' "$WORK/migrations.json")"
[ -n "$PROD_VERSION" ] || fail "could not determine production's migration version"

REMOTE_ONLY="$(jq -r '[.migrations[] | select(.local == "" and .remote != "") | .remote] | join(", ")' "$WORK/migrations.json")"
[ -z "$REMOTE_ONLY" ] || fail "production has migrations this branch doesn't: $REMOTE_ONLY (merge main first)"

PENDING="$(jq -r --arg v "$PROD_VERSION" '[.migrations[] | select(.remote == "" and .local > $v) | .local] | join(" ")' "$WORK/migrations.json")"
if [ -z "$PENDING" ]; then
  echo "Production is at $PROD_VERSION; no pending migrations to rehearse."
  exit 0
fi
echo "Production is at $PROD_VERSION. Pending: $PENDING"

# 2. Copy of production data.
supabase db dump "${SOURCE[@]}" --data-only --use-copy --schema public -f "$WORK/data.sql" >/dev/null
echo "Dumped production data ($(wc -c < "$WORK/data.sql") bytes)."

# 3. Local database at production's version, holding production's data.
supabase db start >/dev/null 2>&1 || true
supabase db reset --local --version "$PROD_VERSION" --no-seed >/dev/null
TABLES="$(psql "$LOCAL_DB_URL" -At -c \
  "SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') FROM pg_tables WHERE schemaname = 'public'")"
{
  # Rows the migrations seed (e.g. a default plan) would otherwise sit
  # alongside production's; replica mode skips triggers and FK checks
  # (auth.users isn't copied) while loading.
  echo "SET session_replication_role = replica;"
  echo "TRUNCATE $TABLES CASCADE;"
  cat "$WORK/data.sql"
} | psql "$LOCAL_DB_URL" -q -v ON_ERROR_STOP=1 >/dev/null
echo "Loaded production data into local database at $PROD_VERSION."

snapshot() { psql "$LOCAL_DB_URL" -At -v ON_ERROR_STOP=1 -f supabase/rehearsal/snapshot.sql | sort; }

# 4. Before/after invariants.
snapshot > "$WORK/before.txt"
supabase migration up --local >/dev/null
snapshot > "$WORK/after.txt"

STATUS=0
for check in $(cut -d'|' -f1 "$WORK/before.txt" "$WORK/after.txt" | sort -u); do
  CHANGED="$(diff <(grep "^$check|" "$WORK/before.txt" || true) \
                  <(grep "^$check|" "$WORK/after.txt" || true) | grep -c '^[<>]' || true)"
  ROWS="$(grep -c "^$check|" "$WORK/before.txt" || true)"
  if [ "$CHANGED" -gt 0 ]; then
    echo "  ✗ $check: $CHANGED row(s) differ (of $ROWS)"
    STATUS=1
  else
    echo "  ✓ $check: $ROWS row(s) unchanged"
  fi
done

# 5. Self-checking views shipped by migrations.
for view in $(psql "$LOCAL_DB_URL" -At -c \
  "SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname LIKE '%\_check'"); do
  N="$(psql "$LOCAL_DB_URL" -At -c "SELECT count(*) FROM public.\"$view\"")"
  if [ "$N" -gt 0 ]; then
    echo "  ✗ $view: $N row(s)"
    STATUS=1
  else
    echo "  ✓ $view: empty"
  fi
done

[ "$STATUS" -eq 0 ] || fail "invariants changed; investigate before deploying"
echo "Rehearsal passed."
