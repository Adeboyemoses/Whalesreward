#!/usr/bin/env bash
# Codex / Claude Code PreToolUse guard for Whales Rewards. Reads the hook event JSON on stdin.
# Exit 0 = allow; exit 2 = block (reason on stderr, shown to the agent).
# Bash/shell events are matched by command-position patterns against the whole event (which is
# just the command). File-tool events (Read, Edit, Write, MultiEdit) are judged on their
# file_path only, so command text inside file contents never trips a command rule.
# It is defence in depth: the sandbox, branch protection and review are the real controls.
# Escape hatches are typed into the command itself, after Earl's go in the session:
#   WHR_MAIN_GO=<today> gh pr merge <n> --merge --match-head-commit <sha>   (staging -> main)
#   WHR_CLOUD_GO=<today> doctl apps create ...                             (any cloud mutation)
# Self-test: bash .codex/hooks/test-guard.sh
set -uf   # -f: never expand globs; this hook inspects glob patterns, it must not evaluate them.
event="$(cat)"
today="$(TZ=Africa/Lagos date +%Y-%m-%d)"

block() { echo "whales-rewards guard: BLOCKED: $*" >&2; exit 2; }
has()   { printf '%s' "$event" | grep -Eq -- "$1"; }

# File-tool path tests, run per path-ish field value. .env matching is case-insensitive (macOS
# filesystems resolve .ENV to .env) and covers multi-suffix names, except exactly .env.example.
# Matches a path or a glob: .env, .env.<suffix...> and .env* / **/.env globs (a trailing * or any
# non-word char after .env), but not .environment and not exactly .env.example.
is_secret() { printf '%s' "$1" | grep -Eiq '(^|/)\.env($|[^A-Za-z0-9_])' && ! printf '%s' "$1" | grep -Eiq '(^|/)\.env\.example$'; }
is_cred()   { printf '%s' "$1" | grep -Eiq '(^|/)\.(ssh|aws)(/|$)' \
              || printf '%s' "$1" | grep -Eiq '(^|/)\.config/(doctl|gh)(/|$)|(^|/)\.codex/auth(/|$)|(^|/)\.claude/\.credentials|(^|/)\.(git-credentials|netrc|npmrc)$|(^|/)\.docker/config\.json$'; }
# Writes into git's own metadata can plant a hook or config that later runs on a plain git command.
# Case-insensitive: on a case-insensitive filesystem (macOS) .GIT/ resolves to .git/.
is_gitmeta() { printf '%s' "$1" | grep -Eiq '(^|/)\.git(/|$)' || printf '%s' "$1" | grep -Eiq '(^|/)\.git(modules|attributes)$'; }

# Which tool fired. tool_name is set by the harness and is a plain identifier (the model can't forge
# it), so a regex is safe here; the argument VALUES below are model-controlled and are parsed with a
# real JSON parser instead. A bare {"tool_input":{"command":...}} event is treated as a command event.
tool="$(printf '%s' "$event" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[A-Za-z_]+"' | head -1 | sed -E 's/.*"([A-Za-z_]+)"$/\1/')"
case "$tool" in
  Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob)
    # Path VALUES are attacker-controlled, so extract them with jq (preferred) or python3, never a
    # regex: a crafted escaped quote ("file_path":"/w/\".env") defeats regex extraction and slips a
    # secret path through. Without either parser the event can't be checked safely, so it is blocked
    # (docs/agentic/setup.md lists jq/python3 as prerequisites).
    if command -v jq >/dev/null 2>&1; then
      field() { printf '%s' "$event" | jq -r --arg k "$1" '(.tool_input[$k]) // empty' 2>/dev/null; }
    elif command -v python3 >/dev/null 2>&1; then
      field() { printf '%s' "$event" | python3 -I -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
ti=d.get("tool_input") if isinstance(d,dict) else None
v=ti.get(sys.argv[1]) if isinstance(ti,dict) else None
sys.stdout.write(v if isinstance(v,str) else "")' "$1" 2>/dev/null; }
    else
      block "guard needs jq or python3 to check file-tool paths safely; install one (see docs/agentic/setup.md)."
    fi
    # Every path-ish field the tool carries, one per line. Grep's `pattern` is a content regex (not
    # a path) and is left out; Grep's `glob` and Glob's `pattern` are path globs and are included,
    # so a search aimed straight at a secret (Grep glob=.env*, Glob pattern=**/.env) is caught too.
    # Grep/Glob over a directory (path=".") can still reach a non-ignored secret; the Grep tool
    # honours .gitignore (where .env lives) and reviewers run read-only, so that residual is left to
    # the sandbox and review.
    case "$tool" in
      Grep)         fields="$(field path)
$(field glob)
$(field file_path)" ;;
      Glob)         fields="$(field path)
$(field pattern)" ;;
      NotebookEdit) fields="$(field notebook_path)" ;;
      *)            fields="$(field file_path)" ;;
    esac
    is_write=0
    case "$tool" in Edit|Write|MultiEdit|NotebookEdit) is_write=1 ;; esac
    IFS='
'
    for p in $fields; do
      [ -n "$p" ] || continue
      is_secret "$p" && block "reading, searching or writing .env files is T3. Report the path only; use .env.example for variable names."
      is_cred   "$p" && block "credential stores (~/.ssh, ~/.aws, doctl, Codex/Claude auth) are off-limits (T3)."
      if [ "$is_write" = 1 ]; then
        printf '%s' "$p" | grep -Eiq '(^|/)product-docs/' \
          && block "product-docs/ is the client's read-only source folder. Copy from it into the repo, or raise a needs:human issue."
        is_gitmeta "$p" && block "writing into .git/ (or .gitmodules/.gitattributes) can plant a hook or config that runs on a plain git command; not allowed."
      fi
    done
    unset IFS
    exit 0
    ;;
esac

# A command word at a command position: start, after ; & | ( or an opening quote, or after "-c ".
B='(^|[;&|("]|\\"|-c[[:space:]])[[:space:]]*([A-Z_][A-Z0-9_]*=[^[:space:]]*[[:space:]]+)*'
W='[[:space:]]'            # word separator
E='([[:space:];&|"]|\\"|$)' # end of an argument
# Qualified git: "git" plus a conservatively accepted leading global-option span. Defined here so
# every section below can use it (the config read-only exception adds V and GO in section 3).
G="git${W}+(-.*${W}+)?"

# 1. Secrets (T3): never read, copy or print .env files, keys or credential stores.
envs="$(printf '%s' "$event" | grep -oE '(^|[^A-Za-z0-9_.-])\.env(\.[A-Za-z0-9_-]+)?' | sed 's/^[^.]*//' | grep -vx '\.env\.example' || true)"
if [ -n "$envs" ] && has "${B}(cat|less|more|head|tail|grep|rg|sed|awk|cp|mv|scp|base64|xxd|od|strings|open|source|diff|bat|nl|cut|sort|tee)${W}"; then
  block "reading or copying .env files is T3. Report the path only and use .env.example for variable names."
fi
if has '(~|\$HOME|/Users/[^/ ]+)/\.(ssh|aws|config/(doctl|gh)|codex/auth|docker/config\.json|git-credentials|netrc|npmrc)' || has 'Library/Application Support/doctl'; then
  block "credential and token stores (~/.ssh, ~/.aws, doctl, gh, Docker, .git-credentials, .netrc, .npmrc, Codex auth) are off-limits (T3)."
fi
# git can print a file too: `git show <rev>:.env` and `git diff --no-index <secret>` read file bytes.
if [ -n "$envs" ] && has "${B}${G}(diff|show|log)${W}"; then
  block "git diff/show/log of a .env path can print its contents; report the path only."
fi
if has "${B}${G}diff${W}+([^;&|]*${W}+)?--no-index${E}"; then
  block "git diff --no-index reads arbitrary files outside the repo (a secret-exfil primitive); not allowed."
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
# Qualified Git uses the same checks as plain Git. G (defined with B/W/E above) conservatively
# accepts the complete leading global-option span rather than evaluating shell words; this can
# block ambiguous quoted data containing protected subcommand text.
# The config read-only exception is narrower: only known, unquoted global
# options may precede config, so text inside a quoted -C path cannot excuse a
# real config mutation. Unknown/ambiguous qualified config fails closed.
V='[A-Za-z0-9_./:=@,+%-]+'
GO="(-[Cc]${W}+${V}|-[Cc]${V}|--(git-dir|work-tree|namespace|config-env|super-prefix)=${V}|--(git-dir|work-tree|namespace|config-env|super-prefix)${W}+${V}|--(no-pager|paginate|bare|no-replace-objects|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-optional-locks|no-lazy-fetch|no-advice)|-p)"
if has "${B}${G}add(${W}[^;&|]*)?${W}(-A|--all|\.|\*|:/|-u|-f|--force)${E}"; then
  block "stage explicit paths; never git add -A / --all / . / * / -u, and never -f/--force (it stages gitignored files: .env, node_modules, build output)."
fi
# Force-staging aside, never stage a .env path at all; it is the gateway to `git show :.env`.
if [ -n "$envs" ] && has "${B}${G}add${W}"; then
  block "don't git add a .env path; secrets stay out of git. Report the path only."
fi
if has "${B}${G}commit${W}+([^;&|]*${W})?-[A-Za-z]*a[A-Za-z]*${E}"; then
  block "no git commit -a / -am; stage explicit paths first."
fi
if has "${B}${G}push[^;&|]*(--force${E}|--mirror${E}|--prune${E}|${W}-f${E}|${W}\+[A-Za-z0-9_./-])"; then
  block "no force / --mirror / --prune pushes (they overwrite or delete remote refs). Use --force-with-lease on your own branch only."
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

# 6. Git subcommands and options that run or write to an arbitrary target (arbitrary code via a
#    broad git allow). git is case-sensitive for subcommands and for the -c/-C option letter, so
#    these use has(), not a case-insensitive match.
# Inline config: block every GLOBAL -c / --config-env. A config key's value can be a command
# (credential.helper, core.pager, alias.*, gpg.program, diff.<d>.command, ...); enumerating the
# dangerous keys is a losing game, and this repo commits as the configured user and never sets
# config inline. Global -c precedes the subcommand, so "git -c k=v commit" is caught while
# "git commit -c <commit>" (reuse a message) is not. ${B} keeps "git -c" inside a quoted message
# from tripping the rule.
if has "${B}git${W}+(-[^;&|]*${W}+)*(-c${W}|--config-env(=|${W}))"; then
  block "git -c / --config-env sets config inline, which can run a command (credential.helper, core.pager, alias.*, ...); set config in the repo, not inline."
fi
# The inline -c injection has an environment twin: GIT_* variables run a program or inject config,
# via an inline VAR=... prefix or an export/env form. Match the assignment anywhere in the command.
if has "(GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_SSH_COMMAND|GIT_SSH|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_ASKPASS|GIT_EXEC_PATH|GIT_PROXY_COMMAND|GIT_CONFIG_[A-Z0-9_]*)="; then
  block "GIT_* environment variables (GIT_EXTERNAL_DIFF, GIT_SSH_COMMAND, GIT_PAGER, GIT_CONFIG_*, ...) can run a program or inject config; don't set them inline."
fi
if has "${B}${G}submodule${W}+([^;&|]*${W}+)?foreach${E}"; then
  block "git submodule foreach runs an arbitrary command per submodule; not allowed."
fi
# rebase --exec/-x (bundled -vx or attached -xCMD), difftool --extcmd/-x, bisect run and filter-branch
# each run a command. -x is case-sensitive as a flag letter (-X is rebase's strategy option, not exec);
# the exec command can be attached (-xCMD), so no trailing separator is required after x.
if has "${B}${G}rebase${W}+([^;&|]*${W}+)?(--exec|-[A-Za-z]*x)"; then
  block "git rebase --exec/-x runs an arbitrary command between commits; not allowed."
fi
if has "${B}${G}difftool${W}+([^;&|]*${W}+)?(--extcmd|-[A-Za-z]*x)"; then
  block "git difftool --extcmd/-x runs an arbitrary command; not allowed."
fi
if has "${B}${G}(bisect${W}+run${E}|filter-branch${E})"; then
  block "git bisect run and filter-branch run arbitrary commands; not allowed."
fi
# --upload-pack/--receive-pack/--exec run a program for the "remote" end (arbitrary code when the
# remote is a local path); --output writes to an arbitrary file; ext:: remote helpers run a command.
# git accepts unambiguous abbreviations (--upl, --rece, --exe), so match those prefixes. The primary
# control is that fetch/push are not auto-allowed (they prompt); this is defence in depth.
if has "${B}${G}[^;&|]*(--upl[a-z-]*|--rece[a-z-]*|--exe[a-z-]*)(=|${W})"; then
  block "git --upload-pack/--receive-pack/--exec (or an abbreviation) run a program for the remote end; not allowed."
fi
if has "${B}${G}[^;&|]*--output(=|${W})"; then
  block "git --output writes command output to an arbitrary file; redirect to an explicit path in the shell instead."
fi
if has "${B}${G}[^;&|]*ext::"; then
  block "git ext:: remote helpers run an arbitrary command; not allowed."
fi

# 7. pnpm / pnpx arbitrary-execution subcommands (dlx/exec run arbitrary binaries).
#    Match options between pnpm and the subcommand (pnpm --silent dlx ...), and pnpx (alias for pnpm dlx).
if has "${B}pnpm${W}+([^;&|]*${W}+)?(dlx|exec)${E}" || has "${B}pnpx${E}"; then
  block "pnpm dlx/exec and pnpx run arbitrary binaries; use a defined package script (pnpm run ...) instead."
fi

exit 0
