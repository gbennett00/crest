#!/bin/bash
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 1
supabase start --exclude edge-runtime,storage-api

STATUS=$(supabase status -o json)

PUBLISHABLE_KEY=$(echo "$STATUS" | jq -r '.PUBLISHABLE_KEY // .ANON_KEY')

{
  echo "NEXT_PUBLIC_SUPABASE_URL=$(echo "$STATUS" | jq -r .API_URL)"
  echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY"
} >> "$CLAUDE_ENV_FILE"