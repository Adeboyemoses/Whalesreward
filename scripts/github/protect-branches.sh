#!/usr/bin/env bash
# Applies Whales Rewards branch protection and merge settings on GitHub. Earl runs this (T2: repository settings).
#   bash scripts/github/protect-branches.sh            # apply
#   bash scripts/github/protect-branches.sh --show     # print the current protection only
# Needs: gh logged in as the repo owner (gh auth status). Re-runnable: each call replaces the rule.
set -eu
repo="${WHR_REPO:-Adeboyemoses/Whalesreward}"

show() {
  for b in staging main; do
    echo "== $b"
    gh api "repos/$repo/branches/$b/protection" \
      --jq '{checks: [.required_status_checks.checks[].context], strict: .required_status_checks.strict,
             pr_required: (.required_pull_request_reviews != null), approvals: .required_pull_request_reviews.required_approving_review_count,
             admins_enforced: .enforce_admins.enabled, linear: .required_linear_history.enabled,
             force_push: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}' 2>/dev/null || echo "   (no protection)"
  done
}
if [ "${1:-}" = "--show" ]; then show; exit 0; fi

gh auth status >/dev/null 2>&1 || { echo "gh is not logged in: run gh auth login" >&2; exit 1; }

echo "Repository merge settings: squash + merge commits, no rebase merges, no auto-merge, delete merged branches"
gh api -X PATCH "repos/$repo" \
  -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=false \
  -F allow_auto_merge=false -F delete_branch_on_merge=true -f default_branch=staging >/dev/null

echo "Protecting staging: PR required, 5 checks, up to date, linear history (squash only), admins included"
gh api -X PUT "repos/$repo/branches/staging/protection" -H "Accept: application/vnd.github+json" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "gate-self-test"}, {"context": "build"}, {"context": "integration"},
      {"context": "e2e"}, {"context": "review-evidence"}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 0, "dismiss_stale_reviews": false, "require_code_owner_reviews": false},
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "Protecting main: PR required, 4 checks, up to date, merge commits allowed, admins included"
gh api -X PUT "repos/$repo/branches/main/protection" -H "Accept: application/vnd.github+json" --input - >/dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "gate-self-test"}, {"context": "build"}, {"context": "integration"}, {"context": "e2e"}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 0, "dismiss_stale_reviews": false, "require_code_owner_reviews": false},
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

show
