#!/usr/bin/env bash
# Self-test for .codex/hooks/guard.sh.   bash .codex/hooks/test-guard.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
today="$(TZ=Africa/Lagos date +%Y-%m-%d)"
pass=0; failn=0
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
run() { printf '{"tool_name":"Bash","tool_input":{"command":%s},"cwd":"/x"}' "$(json "$1")" | bash "$here/guard.sh" 2>/dev/null; echo $?; }
allow() { [ "$(run "$1")" = 0 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should ALLOW: $1"; }; }
deny()  { [ "$(run "$1")" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK: $1"; }; }

# Secrets
deny  'cat .env'
deny  'grep DATABASE .env.local'
deny  'cp .env.production /tmp/x'
deny  'cat .env.example .env.production'
deny  'diff .env.example .env'
allow 'cat .env.example'
allow 'rg STORAGE_ .env.example'
allow 'pnpm vitest --config vitest.config.ts'
allow 'pnpm test'
allow 'cat package.json'
deny  'cat ~/.ssh/id_ed25519'

# product-docs
deny  'rm -rf product-docs'
deny  'sed -i "" s/a/b/ "product-docs/03 Features and Requirements/Features and Requirements.md"'
deny  'echo x > product-docs/notes.md'
deny  'cp src/a.css product-docs/'
deny  'cp src/a.css "product-docs/04 UI Design/x.css"'
allow 'rg -L --no-ignore "midnight" product-docs/'
allow 'rg -L --no-ignore "permission" product-docs/'
allow 'rg -L --no-ignore "Confirmed format" product-docs/'
allow 'cat "product-docs/Technical Requirements/Technical Requirements.md"'
allow 'cp "product-docs/04 UI Design/Design System/tokens.css" src/styles/design-system/'
allow 'cp -R "product-docs/04 UI Design/Design System/fonts" src/styles/design-system/'
allow 'ls product-docs/'

# Git
deny  'git add -A'
deny  'git add .'
deny  'git add -- .'
deny  'git add src/ .'
deny  'git add *'
deny  'git commit -am "x"'
allow 'git add src/server/modules/purchases/accept.ts'
allow 'git commit -m "feat(sync): add finalize (WHR-12)"'
allow 'git commit -m "docs: explain git config policy"'
allow 'git commit --amend --no-edit'
allow 'git commit -m "add a test"'
deny  'git push --force origin core/WHR-1-x'
deny  'git push origin +core/WHR-1-x'
allow 'git push --force-with-lease origin core/WHR-1-x'
deny  'git push origin main'
allow "WHR_MAIN_GO=$today git push origin main"
deny  'WHR_MAIN_GO=2020-01-01 git push origin main'
allow 'git push -u origin core/WHR-21-accept'
deny  'git config user.email someone@example.com'
allow 'git config --get user.name'
deny  'git commit -m "x" -m "Co-Authored-By: bot"'
allow 'git worktree add .worktrees/accept -b core/WHR-21-accept origin/staging'
allow 'pnpm dev'
allow 'git checkout -- src/a.ts'

# Merges
deny  'gh pr merge 12 --auto --squash'
deny  'gh pr merge 12 --squash'
allow 'gh pr merge 12 --squash --match-head-commit 1a2b3c4'
deny  'gh pr merge 30 --merge --match-head-commit 1a2b3c4'
deny  'gh pr merge 30 --admin --squash --match-head-commit 1a2b3c4'
allow "WHR_MAIN_GO=$today gh pr merge 30 --merge --match-head-commit 1a2b3c4"

# Cloud
deny  'doctl apps create --spec .do/app.yaml'
allow "WHR_CLOUD_GO=$today doctl apps create --spec .do/app.yaml"
allow 'doctl apps list'
deny  'aws s3 rm s3://whr-evidence/x --endpoint-url https://fra1.digitaloceanspaces.com'

# Main-checkout protection needs a real repository as the hook's working directory.
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
( cd "$tmp" && git init -q -b staging main && cd main && git -c user.email=t@example.com -c user.name=test commit -q --allow-empty -m init \
  && git worktree add -q ../wt -b feature >/dev/null 2>&1 )
inrepo() { ( cd "$1" && printf '{"tool_input":{"command":%s}}' "$(json "$2")" | bash "$here/guard.sh" 2>/dev/null; echo $? ); }
[ "$(inrepo "$tmp/main" 'git switch -c other')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK switch in main checkout"; }
[ "$(inrepo "$tmp/main" 'git checkout other')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK checkout in main checkout"; }
[ "$(inrepo "$tmp/main" 'git stash')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK stash in main checkout"; }
[ "$(inrepo "$tmp/main" 'git reset --hard HEAD~1')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK reset --hard in main checkout"; }
[ "$(inrepo "$tmp/wt" 'git checkout other')" = 0 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should ALLOW checkout in a worktree"; }
[ "$(inrepo "$tmp/main" 'git status')" = 0 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should ALLOW git status in main checkout"; }

echo "guard self-test: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
