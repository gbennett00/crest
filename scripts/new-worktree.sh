#!/usr/bin/env bash
#
# Create a git worktree next to the main checkout, copy gitignored env files,
# and install dependencies — the steps Cursor's "Git: Create Worktree" skips.
#
# Usage:
#   scripts/new-worktree.sh <branch> [base-ref]
#
# Worktrees are created at  <main-root>.worktrees/<branch>  to match the
# existing  crest / crest.worktrees/<branch>  layout. Runs correctly whether
# invoked from the main checkout or from inside another worktree.
set -euo pipefail

branch="${1:?usage: new-worktree.sh <branch> [base-ref]}"
base="${2:-main}"

# Resolve the MAIN working tree, not whichever worktree we're standing in.
# --git-common-dir points at the shared .git (relative ".git" from main,
# absolute path to it from a linked worktree); its parent is the main root.
common_git="$(git rev-parse --git-common-dir)"
main_root="$(cd "$(dirname "$common_git")" && pwd)"
dir="${main_root}.worktrees/${branch}"

if [ -e "$dir" ]; then
  echo "✗ $dir already exists" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "→ attaching worktree to existing branch '${branch}'"
  git worktree add "$dir" "$branch"
else
  echo "→ creating branch '${branch}' off '${base}'"
  git worktree add -b "$branch" "$dir" "$base"
fi

# Copy env files (gitignored, so worktree creation never brings them over).
shopt -s nullglob
for f in "$main_root"/.env "$main_root"/.env.*; do
  cp "$f" "$dir/" && echo "  copied $(basename "$f")"
done
shopt -u nullglob

echo "  installing dependencies…"
( cd "$dir" && npm install --no-audit --no-fund )

echo "✓ ready: $dir"
