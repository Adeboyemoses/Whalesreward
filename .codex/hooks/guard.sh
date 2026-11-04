#!/usr/bin/env bash
# Codex PreToolUse guard for Whales Rewards. Reads the hook event JSON on stdin.
# Exit 0 = allow; exit 2 = block (reason on stderr, shown to the agent).
# It pattern-matches the whole event text, so it does not depend on exact JSON field names.
# It is defence in depth: the sandbox, branch protection and review are the real controls.
# Escape hatches are typed into the command itself, after Earl's go in the session:
#   WHR_MAIN_GO=<today> gh pr merge <n> --merge --match-head-commit <sha>   (staging -> main)
#   WHR_CLOUD_GO=<today> doctl apps create ...                             (any cloud mutation)
# Self-test: bash .codex/hooks/test-guard.sh
set -u
event="$(cat)"
today="$(TZ=Africa/Lagos date +%Y-%m-%d)"

block() { echo "whales-rewards guard: BLOCKED: $*" >&2; exit 2; }
has()   { printf '%s' "$event" | grep -Eq -- "$1"; }
# A command word at a command position: start, after ; & | ( or an opening quote, or after "-c ".
B='(^|[;&|("]|\\"|-c[[:space:]])[[:space:]]*([A-Z_][A-Z0-9_]*=[^[:space:]]*[[:space:]]+)*'
W='[[:space:]]'            # word separator
E='([[:space:];&|"]|\\"|$)' # end of an argument

# 1. Secrets (T3): never read, copy or print .env files, keys or credential stores.
envs="$(printf '%s' "$event" | grep -oE '(^|[^A-Za-z0-9_.-])\.env(\.[A-Za-z0-9_-]+)?' | sed 's/^[^.]*//' | grep -vx '\.env\.example' || true)"
if [ -n "$envs" ] && has "${B}(cat|less|more|head|tail|grep|rg|sed|awk|cp|mv|scp|base64|xxd|od|strings|open|source|diff|bat|nl|cut|sort|tee)${W}"; then
  block "reading or copying .env files is T3. Report the path only and use .env.example for variable names."
fi
if has '(~|\$HOME|/Users/[^/ ]+)/\.(ssh|aws|config/doctl|codex/auth)' || has 'Library/Application Support/doctl'; then
  block "credential stores (~/.ssh, ~/.aws, doctl, Codex auth) are off-limits (T3)."
fi

# 2. product-docs/ is read-only. Reading, searching and copying FROM it is fine.
if has "${B}(rm|mv|rmdir|unlink|touch|truncate|chmod|chown|ln)${W}[^;&|]*product-docs"; then
  block "product-docs/ is the client's source folder and is read-only. Raise a needs:human issue instead."
fi
if has "${B}(tee|sed${W}+-i|perl${W}+-pi)[^;&|]*product-docs/" || has '>>?[[:space:]]*(\\?")?product-docs/'; then
  block "writing into product-docs/ is not allowed; it is read-only."
fi
# cp/rsync whose LAST argument is inside product-docs (unquoted, or quoted with spaces).
if has "${B}(cp|rsync|install)${W}[^;&|]*${W}(product-docs/[^[:space:];&|\"]*|(\\\\?\")product-docs/[^\"]*(\\\\?\"))[[:space:]]*([;&|]|\"[[:space:]]*[,}]|$)"; then
  block "copying into product-docs/ is not allowed; copy from it into the repo instead."
fi

# 3. Git hygiene.
# Qualified Git uses the same checks as plain Git. Conservatively accept the
# complete leading global-option span rather than evaluating shell words. This
# can block ambiguous quoted data containing protected subcommand text.
G="git${W}+(-.*${W}+)?"
# The config read-only exception is narrower: only known, unquoted global
# options may precede config, so text inside a quoted -C path cannot excuse a
# real config mutation. Unknown/ambiguous qualified config fails closed.
V='[A-Za-z0-9_./:=@,+%-]+'
GO="(-[Cc]${W}+${V}|-[Cc]${V}|--(git-dir|work-tree|namespace|config-env|super-prefix)=${V}|--(git-dir|work-tree|namespace|config-env|super-prefix)${W}+${V}|--(no-pager|paginate|bare|no-replace-objects|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks|no-lazy-fetch|no-advice)|-p)"
if has "${B}${G}add(${W}[^;&|]*)?${W}(-A|--all|\.|\*|:/|-u)${E}"; then
  block "stage explicit paths; never git add -A / --all / . / * / -u (worktree symlinks and node_modules leak)."
fi
if has "${B}${G}commit${W}+([^;&|]*${W})?-[A-Za-z]*a[A-Za-z]*${E}"; then
  block "no git commit -a / -am; stage explicit paths first."
fi
if has "${B}${G}push[^;&|]*(--force${E}|${W}-f${E}|${W}\+[A-Za-z0-9_./-])"; then
  block "no force pushes. Use --force-with-lease on your own branch only."
fi
if has "${B}${G}push[^;&|]*(${W}|:|refs/heads/)main${E}" && ! has "WHR_MAIN_GO=$today"; then
  block "pushing to main needs Earl's go in this session (WHR_MAIN_GO=$today)."
fi
# Remove individual unambiguous read-only config commands before checking for
# mutations; a second read-only command must not mask a qualified mutation.
config_event="$(printf '%s' "$event" | sed -E "s/${B}git${W}+(${GO}${W}+)*config${W}+((--show-origin|--show-scope|--global|--local|--system|--includes|--no-includes)${W}+)*(--get|--get-all|--list|-l)${E}[^;&|\"()]*//g")"
if printf '%s' "$config_event" | grep -Eq -- "${B}${G}config${W}"; then
  block "never change git config; commit as the configured repo user (ambiguous qualified config commands are blocked)."
fi
if has "${B}${G}commit" && has 'Co-Authored-By:'; then
  block "no Co-Authored-By trailers in commits."
fi
# Branch switching, hard resets and stashes in the MAIN checkout (judged from the hook's working directory).
if has "${B}${G}(switch|stash|reset${W}+--hard|checkout${W}+(-b${W}|-B${W}|[A-Za-z0-9_./-]+${E}))" \
   && ! has "git${W}+checkout${W}+--${W}"; then
  common="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  own="$(git rev-parse --git-dir 2>/dev/null || true)"
  if [ -n "$common" ] && [ "$common" = "$own" ]; then
    block "never switch, stash or hard-reset in the main checkout. Use git worktree add .worktrees/<slug> -b <branch> origin/staging."
  fi
fi

# 4. PR merges. Squash into staging; merge commits only for the staging -> main promotion.
if has "gh${W}+pr${W}+merge[^;&|]*--auto"; then
  block "--auto merge is not allowed; merge with --match-head-commit after the evidence check is green."
fi
if has "gh${W}+pr${W}+merge" && ! has '--match-head-commit'; then
  block "merge with --match-head-commit <sha> so the reviewed head is what lands."
fi
if has "gh${W}+pr${W}+merge[^;&|]*(--admin|--merge|--rebase|${W}-m${E}|${W}-r${E})" && ! has "WHR_MAIN_GO=$today"; then
  block "--merge, --rebase and --admin are for the staging -> main promotion only, and need Earl's go in this session (WHR_MAIN_GO=$today). Use --squash into staging."
fi

# 5. Cloud and production (T2).
if has "${B}(doctl|terraform|pulumi)${W}[^;&|]*${W}(create|delete|destroy|apply|update|deploy|import|rm)${E}" && ! has "WHR_CLOUD_GO=$today"; then
  block "cloud changes are T2: Earl's go in this session, then WHR_CLOUD_GO=$today in the command."
fi
if has 'digitaloceanspaces\.com' && has "${B}(aws|s3cmd|rclone)${W}[^;&|]*${W}(rm|cp|mv|sync|rb|mb|put|del)${E}" && ! has "WHR_CLOUD_GO=$today"; then
  block "writing to Spaces is T2: Earl's go in this session, then WHR_CLOUD_GO=$today in the command."
fi
if has "prisma${W}+(migrate${W}+(reset|deploy)|db${W}+push)" && has 'DATABASE_URL=[^ ]*ondigitalocean'; then
  block "migrating a managed (staging or production) database by hand is T2; deploys run migrations."
fi

exit 0
