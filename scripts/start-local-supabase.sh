#!/bin/bash
# scripts/start-local-supabase.sh — runs as a SessionStart hook, cwd is the repo
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 1
supabase start
# supabase start prints local API URL + anon/service keys — capture them
eval "$(supabase status -o env)" 2>/dev/null

# Persist for later bash commands in this session
{
  echo "SUPABASE_URL=$(supabase status -o json | jq -r .API_URL)"
  echo "SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .ANON_KEY)"
} >> "$CLAUDE_ENV_FILE"