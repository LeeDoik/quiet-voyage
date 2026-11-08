#!/bin/sh
# Prepares a fresh worktree of this repo (Orca runs it from orca.yaml when it creates a workspace;
# it is safe to run by hand too): installs wrangler, and links the gitignored local files from the
# main checkout, so the dev server finds the moderation key (.dev.vars) and the dev-screen key
# (.dev-key) without copying secrets around. A link also follows a rotated key.
set -e
cd "$(git rev-parse --show-toplevel)"
main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

if [ "$main" != "$(pwd)" ]; then
  for f in .dev.vars .dev-key; do
    if [ ! -e "$f" ] && [ -f "$main/$f" ]; then ln -s "$main/$f" "$f" && echo "linked $f from $main"; fi
  done
fi

npm install --no-audit --no-fund
echo "ready: npm test, npm run dev (another worktree's server may hold :8787 — then npm run dev -- --port 8790)"
