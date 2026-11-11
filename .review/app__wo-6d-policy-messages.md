---
branch: app/wo-6d-policy-messages
linear: WHR-101
tier: medium
reviewed_head: 9cd1c8add14a4265f8f69e6b28a13f3a28d3e24b
rounds: 2
builder: frontend-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 11
invariants: [I-07, I-09, I-20, I-49, I-50]
p1: ["fixed shared terminal failure state across preview/download and duplicate artifact controls", "fixed existing-user role picker preserving approved delegation policy wording"]
tickets: []
---

WHR-101's exact approved messages replace missing auth/delegation mappings and
outdated failed-export wording. Failed metadata and file responses offer a new
export; uncertain operations retain frozen-operation retry semantics.

The first review identified independent preview/download state and a swallowed
existing-user delegation error. The second review was completed after validating
artifact-wide propagation, including duplicate preparation/history controls and
concurrent responses. All three reviewers PASS the final reviewed head above.

Dispatch flag: 11 exceeds the medium-tier flag of 4 (three builder calls and eight
reviewer calls while completing the two review rounds). No scope expansion.
STATUS, coverage and lane files are untouched as Earl requested.

Unit regressions observed three expected failures before implementation, then
passed. Final EM verification: typecheck, lint, all 579 unit tests and build pass.
Browser verification uses an isolated local Playwright Docker runner because the
macOS sandbox denies Chromium's MachPort rendezvous at startup. No cloud changes,
server/contract changes, migrations, real client data or persisted admin data.
