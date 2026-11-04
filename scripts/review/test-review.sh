#!/usr/bin/env bash
# Self-test for the review gate: routing and evidence validation against a throwaway git repo.
#   bash scripts/review/test-review.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pass=0; failn=0
ok()   { pass=$((pass + 1)); }
bad()  { failn=$((failn + 1)); echo "FAIL: $*"; }
expect_tier() { # files... -> tier
  want="$1"; shift
  got="$(bash "$here/required-reviewers.sh" --files "$@" | sed -n 's/^tier=//p')"
  [ "$got" = "$want" ] && ok || bad "tier for $* = $got, want $want"
}
expect_reviewers() {
  want="$1"; shift
  got="$(bash "$here/required-reviewers.sh" --files "$@" | sed -n 's/^reviewers=//p')"
  [ "$got" = "$want" ] && ok || bad "reviewers for $* = '$got', want '$want'"
}

# --- Routing by path ---
expect_tier docs docs/engineering/roadmap.md README.md
expect_tier docs docs/agentic/lanes/core.md
expect_tier high docs/agentic/work-orders.md
expect_tier high docs/engineering/invariants.md
expect_tier medium docs/engineering/decisions/INDEX.md
expect_tier high .do/app.production.yaml
expect_tier high src/server/adapters/storage/spaces.ts
expect_tier high AGENTS.md
expect_tier high .codex/agents/code-reviewer.toml
expect_tier high .agents/skills/log-decision/SKILL.md
expect_tier high src/server/modules/purchases/accept.ts
expect_tier high src/client/offline/outbox.ts
expect_tier high src/shared/money.ts
expect_tier medium src/server/modules/leaderboards/query.ts
expect_tier medium "src/app/(admin)/admin/sales/page.tsx"
expect_tier low src/ui/StatusPill.tsx
expect_tier low tests/e2e/sale.spec.ts
expect_tier medium some/unknown/file.ts
expect_tier high src/ui/Button.tsx src/server/modules/auth/session.ts
expect_reviewers "code-reviewer" src/ui/Button.tsx
expect_reviewers "code-reviewer integrity-reviewer" src/server/modules/leaderboards/query.ts
expect_reviewers "code-reviewer security-reviewer" src/server/modules/customers/service.ts
expect_reviewers "code-reviewer security-reviewer integrity-reviewer" src/server/modules/sync/finalize.ts
expect_reviewers "code-reviewer security-reviewer" some/unknown/file.ts

# --- A throwaway repo for diff signals and evidence ---
cd "$tmp" || exit 2
git init -q -b staging . && git config user.email t@example.com && git config user.name test
mkdir -p scripts/review && cp "$here"/required-reviewers.sh "$here"/validate-evidence.sh "$here"/routing.conf scripts/review/
echo base > README.md && git add README.md scripts && git commit -qm base
git branch base-ref

# Signal: destructive SQL in an additive-looking migration path raises to high.
git checkout -q -b core/WHR-9-mig
mkdir -p prisma/migrations/001 && echo 'alter table purchase drop column legacy;' > prisma/migrations/001/migration.sql
git add prisma && git commit -qm mig
got="$(bash scripts/review/required-reviewers.sh base-ref...HEAD | sed -n 's/^tier=//p')"
[ "$got" = high ] && ok || bad "destructive migration tier = $got"
git checkout -q staging

# Signal: float maths near money raises a low file to medium + integrity.
git checkout -q -b app/WHR-10-ui
mkdir -p src/ui && echo 'export const t = (amount) => parseFloat(amount)' > src/ui/Total.tsx
git add src && git commit -qm ui
out="$(bash scripts/review/required-reviewers.sh base-ref...HEAD)"
printf '%s\n' "$out" | grep -qx 'tier=medium' && printf '%s\n' "$out" | grep -q 'reviewers=.*integrity-reviewer' && ok || bad "float signal: $out"

# Evidence: missing file fails.
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "missing evidence should fail"

code_sha="$(git rev-parse --short HEAD)"
write_ev() { # tier reviewers-block blocking extra
  mkdir -p .review
  cat > .review/app__WHR-10-ui.md <<EOF
---
branch: app/WHR-10-ui
tier: $1
reviewed_head: $code_sha
rounds: 1
builder: frontend-engineer
reviewers:
$2
blocking: $3
dispatches: 3
$4
---
Built the total component.
EOF
  git add .review && git commit -qm "evidence" >/dev/null
}
write_ev medium "  code-reviewer: PASS
  integrity-reviewer: PASS (round 1)" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 0 ] && ok || bad "valid medium evidence should pass: $(bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui 2>&1)"

# Tier below computed fails.
write_ev low "  code-reviewer: PASS" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "tier below computed should fail"

# Missing domain reviewer fails; "PASS, but" fails; builder as reviewer fails; open blocker fails.
write_ev medium "  code-reviewer: PASS" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "missing integrity-reviewer should fail"
write_ev medium "  code-reviewer: PASS, but check later
  integrity-reviewer: PASS" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "'PASS, but' should fail"
write_ev medium "  code-reviewer: PASS
  integrity-reviewer: PASS
  frontend-engineer: PASS" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "builder as reviewer should fail"
write_ev medium "  code-reviewer: PASS
  integrity-reviewer: PASS" "{P0-OPEN: 1, SEC-HIGH-OPEN: 0}" ""
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "open P0 should fail"

# A code change after reviewed_head fails.
write_ev medium "  code-reviewer: PASS
  integrity-reviewer: PASS" "{P0-OPEN: 0, SEC-HIGH-OPEN: 0}" ""
echo '// later' >> src/ui/Total.tsx && git add src && git commit -qm later
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch app/WHR-10-ui >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "code after review should fail"
git checkout -q staging

# High tier: plan committed before review passes; plan missing fails.
git checkout -q -b core/WHR-21-accept
mkdir -p .review src/server/modules/purchases
cat > .review/core__WHR-21-accept.md <<'EOF'
---
branch: core/WHR-21-accept
tier: high
reviewed_head: 0000000
rounds: 0
builder: backend-engineer
reviewers:
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: accept and credit once
  files: src/server/modules/purchases/**
  approach: updateMany claim then revision and audit in one transaction
  tests: lost-response retry, conflict, concurrent finalize
  risks: none beyond the credit path
---
EOF
git add .review && git commit -qm plan
echo 'export const accept = 1' > src/server/modules/purchases/accept.ts && git add src && git commit -qm code
sha="$(git rev-parse --short HEAD)"
sed -e "s/^reviewed_head: .*/reviewed_head: $sha/" -e "s/^rounds: 0/rounds: 2/" -e "s/^dispatches: 0/dispatches: 4/" \
    -e "s/^reviewers:/reviewers:\\
  code-reviewer: PASS\\
  security-reviewer: PASS\\
  integrity-reviewer: PASS/" .review/core__WHR-21-accept.md > ev.tmp && mv ev.tmp .review/core__WHR-21-accept.md
git add .review && git commit -qm evidence
if bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch core/WHR-21-accept >/dev/null 2>&1; then ok
else bad "valid high evidence should pass: $(bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch core/WHR-21-accept 2>&1)"; fi
# Edit the plan after review: fails.
sed 's/^  risks: .*/  risks: changed later/' .review/core__WHR-21-accept.md > ev.tmp && mv ev.tmp .review/core__WHR-21-accept.md
git add .review && git commit -qm replan
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch core/WHR-21-accept >/dev/null 2>&1
[ $? -eq 1 ] && ok || bad "plan edited after review should fail"

# Docs-only needs no evidence.
git checkout -q staging && git checkout -q -b docs/WHR-30-notes
mkdir -p docs && echo note > docs/x.md && git add docs && git commit -qm docs
bash scripts/review/validate-evidence.sh --base base-ref --head HEAD --branch docs/WHR-30-notes >/dev/null 2>&1
[ $? -eq 0 ] && ok || bad "docs-only should pass without evidence"

echo "review gate self-test: $pass passed, $failn failed"
[ "$failn" -eq 0 ]
