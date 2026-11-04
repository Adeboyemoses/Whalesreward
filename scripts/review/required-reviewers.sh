#!/usr/bin/env bash
# Computes the minimum risk tier and the required reviewers for a diff.
#
#   bash scripts/review/required-reviewers.sh                         # origin/staging...HEAD
#   bash scripts/review/required-reviewers.sh origin/staging...my-br  # any git range
#   bash scripts/review/required-reviewers.sh --files a.ts b.ts       # planning: paths only, no diff signals
#
# Prints key=value lines (tier, reviewers, round_cap, files) and "# " reason lines.
# tier=docs means no evidence file is needed. Works on macOS bash 3.2.
# Config: scripts/review/routing.conf (override with RG_CONF for tests).
set -u

here="$(cd "$(dirname "$0")" && pwd)"
conf="${RG_CONF:-$here/routing.conf}"
[ -f "$conf" ] || { echo "required-reviewers: missing $conf" >&2; exit 2; }

range="origin/staging...HEAD"
mode="git"
files=""
if [ "${1:-}" = "--files" ]; then
  mode="files"; shift
  for f in "$@"; do files="$files$f
"; done
elif [ -n "${1:-}" ]; then
  range="$1"
fi

if [ "$mode" = "git" ]; then
  if ! files="$(git diff --name-only "$range" 2>/dev/null)"; then
    echo "required-reviewers: cannot diff $range" >&2; exit 2
  fi
fi

rank() { case "$1" in docs) echo 0;; low) echo 1;; medium) echo 2;; high) echo 3;; *) echo -1;; esac; }
name_of() { case "$1" in 0) echo docs;; 1) echo low;; 2) echo medium;; 3) echo high;; esac; }
add_word() { case " $1 " in *" $2 "*) echo "$1";; *) echo "${1:+$1 }$2";; esac; }

overall=0
domains=""
reasons=""
count=0

while IFS= read -r f; do
  [ -z "$f" ] && continue
  count=$((count + 1))
  ftier=""; fwhy=""
  # First matching tier rule wins.
  while read -r kind a b rest; do
    case "$kind" in ''|'#'*) continue;; esac
    [ "$kind" = "tier" ] || continue
    # shellcheck disable=SC2254
    case "$f" in $b) ftier="$a"; fwhy="$rest"; break;; esac
  done < "$conf"
  [ -z "$ftier" ] && { ftier="medium"; fwhy="no rule matched (default)"; }
  r="$(rank "$ftier")"

  if [ "$r" -ge 1 ]; then
    # Domain reviewers: every matching rule.
    while read -r kind a b rest; do
      [ "$kind" = "domain" ] || continue
      # shellcheck disable=SC2254
      case "$f" in $b) domains="$(add_word "$domains" "$a")";; esac
    done < "$conf"
    # Diff-content signals on added lines.
    if [ "$mode" = "git" ]; then
      added="$(git diff -U0 "$range" -- "$f" 2>/dev/null | grep '^+' | grep -v '^+++' || true)"
      if [ -n "$added" ]; then
        while read -r kind floor rev ere rest; do
          [ "$kind" = "signal" ] || continue
          if printf '%s\n' "$added" | grep -Eiq -- "$ere"; then
            fr="$(rank "$floor")"
            if [ "$fr" -gt "$r" ]; then r="$fr"; ftier="$floor"; fi
            fwhy="$fwhy; signal: $rest"
            [ "$rev" != "-" ] && domains="$(add_word "$domains" "$rev")"
          fi
        done < "$conf"
      fi
    fi
  fi
  [ "$r" -gt "$overall" ] && overall="$r"
  reasons="$reasons# $(printf '%-6s' "$ftier") $f — $fwhy
"
done <<EOF
$files
EOF

tier="$(name_of "$overall")"
case "$tier" in
  docs)   reviewers="";                                               cap=0 ;;
  low)    reviewers="code-reviewer";                                  cap=2 ;;
  medium) reviewers="code-reviewer"
          if [ -z "$domains" ]; then domains="security-reviewer"; fi
          for d in $domains; do reviewers="$(add_word "$reviewers" "$d")"; done
          cap=2 ;;
  high)   reviewers="code-reviewer security-reviewer integrity-reviewer"; cap=3 ;;
esac

echo "tier=$tier"
echo "reviewers=$reviewers"
echo "round_cap=$cap"
echo "files=$count"
printf '%s' "$reasons"
