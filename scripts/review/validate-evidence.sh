#!/usr/bin/env bash
# Validates the review-evidence file for a PR branch. Exit 0 = pass, 1 = fail, 2 = usage/setup error.
#
#   bash scripts/review/validate-evidence.sh --base origin/staging --head HEAD --branch core/WHR-21-x
#
# Used locally by the EM before pushing and by .github/workflows/review-evidence.yml.
# Format: .review/README.md. Works on macOS bash 3.2.
set -u

base=""; head="HEAD"; branch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2;;
    --head) head="$2"; shift 2;;
    --branch) branch="$2"; shift 2;;
    *) echo "validate-evidence: unknown argument $1" >&2; exit 2;;
  esac
done
[ -n "$base" ] && [ -n "$branch" ] || { echo "usage: validate-evidence.sh --base <ref> --head <ref> --branch <name>" >&2; exit 2; }

here="$(cd "$(dirname "$0")" && pwd)"
fail=0
err() { echo "validate-evidence: FAIL: $*" >&2; fail=1; }
rank() { case "$1" in docs) echo 0;; low) echo 1;; medium) echo 2;; high) echo 3;; *) echo -1;; esac; }

# Count old and new paths, including removals and renames out of shared records.
check_records() {
  if [ "$(rank "$1")" -ge 1 ]; then
    records="$(git -c core.quotePath=false diff --no-renames --name-only "$base...$head" -- \
      STATUS.md docs/engineering/coverage-map.md ':(glob)docs/agentic/lanes/*.md')"
    [ -z "$records" ] || err "feature PR must not change shared records: $(echo $records); the EM updates them in a separate docs-only READY or close records PR after the feature PR merges"
  fi
}

# 1. What does the diff require?
routing="$(bash "$here/required-reviewers.sh" "$base...$head")" || { echo "validate-evidence: routing failed" >&2; exit 2; }
need_tier="$(printf '%s\n' "$routing" | sed -n 's/^tier=//p')"
need_reviewers="$(printf '%s\n' "$routing" | sed -n 's/^reviewers=//p')"
# 2. The evidence file at head.
safe="$(printf '%s' "$branch" | sed 's#/#__#g')"
path=".review/$safe.md"
if ! body="$(git show "$head:$path" 2>/dev/null)"; then
  if [ "$need_tier" = "docs" ]; then
    echo "validate-evidence: docs-only change, no evidence needed"; exit 0
  fi
  echo "validate-evidence: FAIL: $path is missing at $head (tier $need_tier needs evidence)" >&2
  printf '%s\n' "$routing" | sed -n 's/^# /  /p' >&2
  exit 1
fi

# Docs-only routing may still carry evidence that explicitly raises the tier.
if [ "$need_tier" = "docs" ]; then
  declared_tier="$(printf '%s\n' "$body" | awk 'NR==1 && $0!="---"{exit} NR==1{next} $0=="---"{exit} /^tier:/ {sub(/^tier:[ ]*/,""); sub(/[ ]+#.*$/,""); print; exit}')"
  check_records "$declared_tier"
  [ "$fail" -eq 0 ] || exit 1
  echo "validate-evidence: docs-only change, no evidence needed"; exit 0
fi

front="$(printf '%s\n' "$body" | awk 'NR==1 && $0!="---"{exit} NR==1{next} $0=="---"{exit} {print}')"
[ -n "$front" ] || { echo "validate-evidence: FAIL: $path has no front matter" >&2; exit 1; }
prose_lines="$(printf '%s\n' "$body" | awk 'c>=2{n++} $0=="---"{c++} END{print n+0}')"
[ "$prose_lines" -le 40 ] || err "prose after the front matter is $prose_lines lines (max 40)"

# Top-level scalar: key: value (comments stripped).
val() { printf '%s\n' "$front" | awk -v k="$1" '
  $0 ~ "^"k":" { sub("^"k":[ ]*",""); sub("[ ]+#.*$",""); print; exit }'; }
# Indented block under a top-level key: prints "name<TAB>value" lines.
block() { printf '%s\n' "$front" | awk -v k="$1" '
  $0 ~ "^"k":[ ]*(#.*)?$" {inb=1; next}
  inb && /^[^ #]/ {inb=0}
  inb && /^  [A-Za-z0-9_-]+:/ { line=$0; sub(/^  /,"",line); n=line; sub(/:.*/,"",n); v=line; sub(/^[^:]*:[ ]*/,"",v); sub(/[ ]+#.*$/,"",v); print n "\t" v }'; }
# Raw plan block text, for the unchanged-since-review check.
planraw() { printf '%s\n' "$1" | awk '
  NR==1{next} $0=="---"{exit}
  /^plan:/ {inb=1; print; next}
  inb && /^[^ ]/ {exit}
  inb {print}'; }

# Duplicate top-level keys.
dups="$(printf '%s\n' "$front" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_-]*\):.*/\1/p' | sort | uniq -d)"
[ -z "$dups" ] || err "duplicate keys: $(echo $dups)"

for k in branch tier reviewed_head rounds builder dispatches; do
  [ -n "$(val "$k")" ] || err "missing required key: $k"
done
printf '%s\n' "$front" | grep -q '^reviewers:' || err "missing required key: reviewers"
printf '%s\n' "$front" | grep -q '^blocking:' || err "missing required key: blocking"

ev_branch="$(val branch)"
[ "$ev_branch" = "$branch" ] || err "branch is '$ev_branch', PR head is '$branch'"

ev_tier="$(val tier)"
if [ "$(rank "$ev_tier")" -lt 1 ]; then err "tier '$ev_tier' is not low, medium or high"
elif [ "$(rank "$ev_tier")" -lt "$(rank "$need_tier")" ]; then err "tier $ev_tier is below the computed minimum $need_tier"; fi
check_records "$ev_tier"
# The evidence may raise the tier: required reviewers follow the higher tier.
if [ "$ev_tier" = "high" ]; then need_reviewers="code-reviewer security-reviewer integrity-reviewer"; fi

rounds="$(val rounds)"; cap=2; [ "$ev_tier" = "high" ] && cap=3
case "$rounds" in ''|*[!0-9]*) err "rounds must be an integer";; *)
  if [ "$rounds" -gt "$cap" ]; then
    esc="$(val escalation)"
    case "$esc" in ''|none|n/a|-|no|false|null|'~') err "rounds $rounds exceed the $ev_tier cap $cap and there is no escalation";;
      *) printf '%s' "$esc" | grep -Eq '[0-9]{4}-[0-9]{2}-[0-9]{2}' || err "escalation must record Earl's decision with a YYYY-MM-DD date";; esac
  fi;; esac

case "$(val dispatches)" in ''|*[!0-9]*) err "dispatches must be a non-negative integer";; esac

builder="$(val builder)"
revs="$(block reviewers)"
for r in $need_reviewers; do
  v="$(printf '%s\n' "$revs" | awk -F'\t' -v r="$r" '$1==r{print $2; exit}')"
  if [ -z "$v" ]; then err "required reviewer $r is not listed"
  else case "$v" in PASS|"PASS ("*")") ;; *) err "reviewer $r is '$v', not PASS";; esac; fi
done
if printf '%s\n' "$revs" | awk -F'\t' '{print $1}' | grep -qx -- "$builder"; then
  err "builder $builder is also listed as a reviewer (maker must not be checker)"
fi

# Blocking counts: flow map {A: 0, B: 0} or a block map.
blk="$(val blocking)"
if [ -n "$blk" ]; then blk_lines="$(printf '%s\n' "$blk" | tr -d '{}' | tr ',' '\n' | awk -F: '{k=$1; v=$2; gsub(/^ +| +$/,"",k); gsub(/^ +| +$/,"",v); if (k!="") print k "\t" v}')"
else blk_lines="$(block blocking)"; fi
for k in P0-OPEN SEC-HIGH-OPEN; do
  printf '%s\n' "$blk_lines" | awk -F'\t' '{print $1}' | grep -qx -- "$k" || err "blocking is missing $k"
done
[ "$ev_tier" = "high" ] && { printf '%s\n' "$blk_lines" | awk -F'\t' '{print $1}' | grep -qx INTEGRITY-P1-OPEN || err "high tier: blocking is missing INTEGRITY-P1-OPEN"; }
printf '%s\n' "$blk_lines" | while IFS="$(printf '\t')" read -r k v; do
  [ -z "$k" ] && continue
  [ "$v" = "0" ] || echo "$k=$v"
done | grep -q . && err "blocking counts must all be 0: $(echo "$blk_lines" | tr '\t\n' '= ')"

# High tier: a complete plan, unchanged since review.
rh="$(val reviewed_head)"
case "$rh" in *[!0-9a-fA-F]*|'') err "reviewed_head must be a commit SHA";; esac
if [ "$ev_tier" = "high" ]; then
  pl="$(block plan)"
  for k in goal files approach tests risks; do
    v="$(printf '%s\n' "$pl" | awk -F'\t' -v k="$k" '$1==k{print $2; exit}')"
    [ -n "$v" ] || err "high tier: plan.$k is missing or empty"
  done
  [ "$(printf '%s\n' "$pl" | grep -c .)" -le 15 ] || err "plan is longer than 15 entries"
fi

# reviewed_head: an ancestor of head; only the PR's own paths need re-review.
if [ -n "$rh" ] && git cat-file -e "$rh^{commit}" 2>/dev/null; then
  if ! git merge-base --is-ancestor "$rh" "$head" 2>/dev/null; then
    err "reviewed_head $rh is not an ancestor of $head"
  else
    after="$(comm -12 \
      <(git diff --name-only "$rh" "$head" | sort) \
      <(git diff --name-only "$base...$head" | sort) \
      | grep -v '^\.review/[^/]*\.md$' || true)"
    [ -z "$after" ] || err "files changed after review (re-review needed): $(echo $after)"
    if [ "$ev_tier" = "high" ]; then
      then_body="$(git show "$rh:$path" 2>/dev/null || true)"
      [ -n "$then_body" ] || err "high tier: the plan must be committed before review (no $path at reviewed_head)"
      [ -n "$then_body" ] && [ "$(planraw "$then_body")" != "$(planraw "$body")" ] && err "high tier: plan changed after review"
    fi
  fi
elif [ -n "$rh" ]; then
  err "reviewed_head $rh is not a commit in this repository"
fi

if [ "$fail" -ne 0 ]; then
  echo "validate-evidence: computed tier $need_tier, required: $need_reviewers" >&2
  exit 1
fi
echo "validate-evidence: PASS ($path, tier $ev_tier, reviewers: $need_reviewers)"
