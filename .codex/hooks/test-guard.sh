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
# File-tool events (Claude Code Read/Edit/Write/MultiEdit): the JSON is passed through verbatim.
frun()  { printf '%s' "$1" | bash "$here/guard.sh" 2>/dev/null; echo $?; }
fallow(){ [ "$(frun "$1")" = 0 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should ALLOW (file): $1"; }; }
fdeny() { [ "$(frun "$1")" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK (file): $1"; }; }

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

# WHR-44: Git global options must not bypass the existing hygiene checks.
# These are synthetic hook events; no command below is executed.
deny  'git -C x add -A'
deny  'git -Cx add .'
deny  'git -C "path with spaces" add --all'
deny  "git -C 'path with spaces' add -u"
deny  'git -C x -C y add *'
deny  'git --git-dir=x --work-tree=y add :/'
deny  'git --no-pager -C x commit -am "x"'
deny  'git -C x push --force origin feature'
deny  'git -C x push origin main'
deny  'git -C x -c core.quotePath=false push origin main'
deny  'git --literal-pathspecs -C x config user.email someone@example.com'
deny  'git -C x config --global user.name test'
deny  'git -C x commit -m "x" -m "Co-Authored-By: bot"'
allow 'git -C x add src/server/lib/time.ts'
allow 'git -C "path with spaces" add -- src/server/lib/time.ts'
allow 'git -C x -C y --no-pager diff --stat'
allow 'git --git-dir=x --work-tree=y status'
allow 'git -C x config --get user.name'
deny  'git -C "path with spaces" config --get user.name'
allow 'git -C x push origin feature'
allow 'git -C x push --force-with-lease origin feature'
allow "WHR_MAIN_GO=$today git -C x push origin main"
deny  'WHR_MAIN_GO=2020-01-01 git -C x push origin main'
allow 'git -C x config --list'
allow 'git -C x config --show-origin --get user.name'
allow 'git config --show-scope --list'
deny  'git -C "config --get user.name" config user.email someone@example.com'
deny  'git -C x config user.email someone@example.com && git -C x config --get user.name'
deny  'git -C "path;with separator" add -A'

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

# WHR-232: git config injection and submodule command execution.
deny  "git -c core.sshCommand='touch pwned' fetch origin"
deny  'git -c core.pager=cat log'
deny  'git -c core.fsmonitor=evil status'
deny  'git -c core.hooksPath=/tmp/h status'
deny  'git -c alias.x=!sh x'
deny  'git -c protocol.ext.allow=always fetch'
deny  'git -C x -c core.sshCommand=evil fetch'
deny  'git submodule foreach "rm -rf x"'
# All inline global -c is blocked now (a key's value can be a command); repo commits as the
# configured user and never sets config inline.
deny  'git -c user.email=t@example.com -c user.name=test commit --allow-empty -m init'
deny  'git -c user.name=test commit -m x'
deny  'git -c credential.helper=!evil fetch'
deny  'git -c core.quotePath=false status'
deny  'git -C x -c gpg.program=evil commit -m y'
# "git commit -c <commit>" reuses a message; it is not inline config and must stay allowed.
allow 'git commit -c HEAD'
allow 'git -C x status'

# WHR-232: pnpm arbitrary-execution subcommands.
deny  'pnpm dlx cowsay hi'
deny  'pnpm exec rimraf dist'
allow 'pnpm install --frozen-lockfile'
allow 'pnpm typecheck'
allow 'pnpm run build'

# WHR-232 (security review 2): bypasses the first pass missed.
# .env matching is case-insensitive (macOS filesystems) and covers multi-suffix names.
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.ENV"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.Env.Local"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/.env.local.bak","old_string":"a","new_string":"b"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/Users/x/.SSH/id_ed25519"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/.env.example"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/src/environment.ts"}}'
# Sibling file tools: Grep/Glob targeting a secret path, NotebookEdit writing product-docs.
fdeny  '{"tool_name":"Grep","tool_input":{"pattern":"KEY","path":"/w/.env"}}'
fdeny  '{"tool_name":"Glob","tool_input":{"pattern":"*","path":"/Users/x/.ssh"}}'
fdeny  '{"tool_name":"NotebookEdit","tool_input":{"notebook_path":"/w/product-docs/x.ipynb","new_source":"y"}}'
fallow '{"tool_name":"Grep","tool_input":{"pattern":"TODO","path":"/w/src"}}'
fallow '{"tool_name":"Glob","tool_input":{"pattern":"**/*.ts","path":"/w/src"}}'
# git exec vectors beyond -c, and options between pnpm/git and the subcommand.
deny  'git --config-env=CORE_X push origin feature'
deny  'git -c diff.external=evil diff'
deny  'git rebase --exec "evil" main'
deny  'git rebase -x evil main'
deny  'git -C x rebase -x evil main'
deny  'git bisect run ./evil.sh'
deny  'git difftool --extcmd=evil'
deny  'git difftool -x evil'
deny  'git filter-branch --tree-filter evil HEAD'
allow 'git rebase --continue'
allow 'git rebase --abort'
deny  'pnpm --silent dlx cowsay'
deny  'pnpm --dir x exec rimraf'
deny  'pnpx cowsay'
allow 'pnpm run test:exec'

# WHR-232 (security review 3): fetch/push/log/diff exec and write flags; bundled -x; Grep/Glob globs.
deny  'git fetch --upload-pack=touch\ pwned ./'
deny  'git push --receive-pack=evil origin feature'
deny  'git fetch --exec=evil origin'
deny  'git diff --output=/Users/x/.ssh/authorized_keys HEAD'
deny  'git log --output=/tmp/x --oneline'
deny  'git clone ext::sh -c touch\ pwned'
allow 'git fetch origin'
allow 'git push origin feature'
allow 'git diff --stat origin/staging...HEAD'
allow 'git log --oneline -5'
allow 'git show HEAD:package.json'
# Bundled short exec option, and the capital -X strategy option which must NOT be blocked.
deny  'git rebase -vx evil main'
allow 'git rebase -X ours main'
allow 'git rebase --continue'
# Grep/Glob aimed at a secret through the glob/pattern field, not just path.
fdeny  '{"tool_name":"Grep","tool_input":{"pattern":"KEY","path":"/w","glob":".env*"}}'
fdeny  '{"tool_name":"Glob","tool_input":{"pattern":"**/.env.local","path":"/w"}}'
fallow '{"tool_name":"Grep","tool_input":{"pattern":"TODO","path":"/w/src","glob":"*.ts"}}'
fallow '{"tool_name":"Glob","tool_input":{"pattern":"**/*.ts","path":"/w/src"}}'

# WHR-232 (security review 4): real-JSON parsing, .git writes, git as a file reader.
# Unicode-escaped .env (. = "."): a regex misses it, jq/python3 decode it to the real path.
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.env"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/sub/.env.local","old_string":"a","new_string":"b"}}'
# Writes into git's own metadata can plant a hook or config that a later plain git command runs.
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/.git/hooks/pre-commit","content":"x"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/.git/config","old_string":"a","new_string":"b"}}'
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/.gitmodules","content":"x"}}'
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/.gitattributes","content":"x"}}'
# .github/ and .gitignore are ordinary tracked files, not git metadata; writes stay allowed.
fallow '{"tool_name":"Write","tool_input":{"file_path":"/w/.github/workflows/ci.yml","content":"x"}}'
fallow '{"tool_name":"Edit","tool_input":{"file_path":"/w/.gitignore","old_string":"a","new_string":"b"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/.git/config"}}'
# git as a file reader: show <rev>:.env and diff --no-index print file bytes.
deny  'git show HEAD:.env'
deny  'git diff --no-index .env /dev/null'
deny  'git diff --no-index /etc/passwd x'
deny  'git diff --no-index'
allow 'git diff --stat HEAD~1'

# WHR-232 (security review 5): case-insensitive .git/product-docs, git option abbreviations,
# attached/bundled rebase -x, destructive push flags.
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/.GIT/hooks/pre-commit","content":"x"}}'
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/PRODUCT-DOCS/notes.md","content":"x"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/.Git/config","old_string":"a","new_string":"b"}}'
deny  'git fetch --upl=touch\ pwned ./'
deny  'git fetch --upload-pac=evil ./'
deny  'git push --rece=evil origin feature'
deny  'git fetch --exe=evil origin'
deny  'git rebase -xevil main'
deny  'git rebase -vxevil main'
deny  'git push --mirror origin'
deny  'git push --prune origin'
allow 'git fetch --recurse-submodules origin'
allow 'git push --recurse-submodules=on-demand origin feature'
allow 'git rebase --continue'

# WHR-232 (security review 6): GIT_* env injection (the environment twin of -c), more token stores.
deny  'GIT_EXTERNAL_DIFF=evil git diff HEAD~1'
deny  'GIT_SSH_COMMAND=evil git fetch origin'
deny  'GIT_PAGER=evil git log'
deny  'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=evil'
deny  'cat ~/.git-credentials'
deny  'cat ~/.config/gh/hosts.yml'
deny  'cat ~/.npmrc'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/Users/x/.git-credentials"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/Users/x/.config/gh/hosts.yml"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/Users/x/.docker/config.json"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.npmrc"}}'
allow 'git log --oneline -5'
allow 'cat package.json'

# WHR-232: file-tool events are judged on their path, never on file contents.
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.env"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/w/.env.local"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/.env.production","old_string":"a","new_string":"b"}}'
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/.env","content":"X=1"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/.env.example"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/package.json"}}'
fallow '{"tool_name":"Edit","tool_input":{"file_path":"/w/src/server/modules/purchases/accept.ts","old_string":"a","new_string":"b"}}'
fdeny  '{"tool_name":"Read","tool_input":{"file_path":"/Users/x/.ssh/id_ed25519"}}'
fdeny  '{"tool_name":"Write","tool_input":{"file_path":"/w/product-docs/notes.md","content":"x"}}'
fdeny  '{"tool_name":"Edit","tool_input":{"file_path":"/w/product-docs/04 UI Design/x.css","old_string":"a","new_string":"b"}}'
fallow '{"tool_name":"Read","tool_input":{"file_path":"/w/product-docs/Technical Requirements/Technical Requirements.md"}}'
# The false-block fix: command text inside an edit's content must NOT trigger a command rule.
fallow '{"tool_name":"Edit","tool_input":{"file_path":"/w/docs/agentic/review.md","old_string":"x","new_string":"never run git add -A, doctl apps create, or gh pr merge --admin"}}'
fallow '{"tool_name":"Write","tool_input":{"file_path":"/w/docs/x.md","content":"examples: cat .env ; git push origin main ; rm -rf product-docs"}}'

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
[ "$(inrepo "$tmp/main" 'git --no-pager -C x switch other')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK qualified switch in main checkout"; }
[ "$(inrepo "$tmp/main" 'git -C "path with spaces" stash')" = 2 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should BLOCK quoted qualified stash in main checkout"; }
[ "$(inrepo "$tmp/main" 'git status')" = 0 ] && pass=$((pass+1)) || { failn=$((failn+1)); echo "should ALLOW git status in main checkout"; }

echo "guard self-test: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
