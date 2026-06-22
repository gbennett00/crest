#!/bin/bash
# Bring up local Supabase for a Crest cloud session and write the env vars the
# app needs. Designed to be called manually by the agent (see CLAUDE.md), not as
# a SessionStart hook — first run pulls Docker images and can take minutes.
#
# Idempotent: safe to re-run. If Supabase is already up it just rewrites the
# env file from the current status.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "[setup] Not a remote environment; skipping (Docker is unavailable locally)." >&2
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 1

# Start the Docker daemon if it isn't already running.
if ! docker info >/dev/null 2>&1; then
  echo "[setup] Starting Docker daemon..."
  sudo dockerd > /var/log/dockerd.log 2>&1 &
  disown
  TRIES=0
  until docker info >/dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge 60 ]; then
      echo "[setup] ERROR: Docker did not become ready after 60s" >&2
      exit 1
    fi
    sleep 1
  done
fi

# Start Supabase only if it isn't already running.
if supabase status >/dev/null 2>&1; then
  echo "[setup] Supabase already running."
else
  echo "[setup] Starting Supabase (first run pulls images; can take a few minutes)..."
  if ! supabase start --exclude edge-runtime,storage-api; then
    echo "[setup] ERROR: 'supabase start' failed" >&2
    exit 1
  fi
fi

STATUS=$(supabase status -o json) || {
  echo "[setup] ERROR: could not read 'supabase status'" >&2
  exit 1
}
API_URL=$(echo "$STATUS" | jq -r .API_URL)
PUBLISHABLE_KEY=$(echo "$STATUS" | jq -r '.PUBLISHABLE_KEY // .ANON_KEY')

if [ -z "$API_URL" ] || [ "$API_URL" = "null" ] || [ -z "$PUBLISHABLE_KEY" ] || [ "$PUBLISHABLE_KEY" = "null" ]; then
  echo "[setup] ERROR: missing API_URL or publishable key in supabase status" >&2
  exit 1
fi

# Write .env.local — Next.js loads this automatically, so it doesn't depend on
# any harness env-injection mechanism.
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
EOF
echo "[setup] Wrote .env.local"

# Best-effort: also expose the vars to the agent's shell if the harness provides
# an env file for it.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL"
    echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY"
  } >> "$CLAUDE_ENV_FILE"
  echo "[setup] Appended vars to CLAUDE_ENV_FILE"
fi

echo "[setup] Done. Supabase API: $API_URL"
