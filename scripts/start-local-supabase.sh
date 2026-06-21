#!/bin/bash
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 1

if ! docker info >/dev/null 2>&1; then
  sudo dockerd > /var/log/dockerd.log 2>&1 &
  disown
  TRIES=0
  MAX_TRIES=60
  until docker info >/dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge "$MAX_TRIES" ]; then
      echo "[setup] ERROR: Docker did not become ready after ${MAX_TRIES}s" >&2
      exit 1
    fi
    sleep 1
  done
fi

supabase start --exclude edge-runtime,storage-api

STATUS=$(supabase status -o json)

PUBLISHABLE_KEY=$(echo "$STATUS" | jq -r '.PUBLISHABLE_KEY // .ANON_KEY')

{
  echo "NEXT_PUBLIC_SUPABASE_URL=$(echo "$STATUS" | jq -r .API_URL)"
  echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY"
} >> "$CLAUDE_ENV_FILE"