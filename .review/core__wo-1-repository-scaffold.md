---
branch: core/wo-1-repository-scaffold
linear: WHR-1
tier: high
reviewed_head: 9ff0117d116d8cee0309c31a0494f674d2bda495
rounds: 3
builder: platform-engineer
reviewers:
  code-reviewer: PASS (round 3)
  security-reviewer: PASS (round 3)
  integrity-reviewer: PASS (round 3)
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 11
plan:
  goal: Empty fully wired Next.js scaffold with local and CI gates green on staging.
  files: Root tooling and lockfile, docker-compose.yml, .github/workflows/ci.yml, prisma/**, src/** placeholders, jobs/** placeholders, tests/**, docs/agentic/bootstrap/**, README.md, STATUS.md, docs/agentic/lanes/core.md.
  approach: Pin supported runtime and tools, scaffold empty architecture, wire real smoke suites and local services, preserve enforcement checks, remove obsolete bootstrap copies.
  tests: Typecheck, lint, unit, build, PostgreSQL integration, Playwright smoke, review self-test, guard self-test, evidence validation and GitHub CI.
  risks: CI enforcement paths and dependency compatibility; no business schema, cloud provisioning or feature implementation.
invariants: []
p1: ["fixed Playwright ignores anchored to the current repository root"]
tickets: []
---

Plan committed before builder dispatch at 130e76a.
Empty Next.js scaffold, pinned tooling, real PostgreSQL baseline smoke and browser shell smoke.
All three reviewers passed round three on the reviewed head; read-only tree and head checks were clean.
Round one identified a Playwright ignore pattern excluding tests inside builder worktrees.
The fix scopes ignores to this repository root; discovery now finds desktop and attendant tests.
EM reran typecheck, lint, unit (1), build, integration (1), and both explicit empty time suites.
EM reran review self-tests (37/0) and guard self-tests (63/0).
EM reran production browser smoke (2 passed) and frozen-lockfile install; Chromium launch required sandbox escalation.
Local MinIO source build passed; EM verified live/ready HTTP 200 and PostgreSQL/Mailpit healthy.
No product invariants, credit rules, authentication, or deletion logic are implemented.
Round three rechecked the merge of upstream app documentation and STATUS.md conflict resolution; code unchanged.
Dispatch flag exceeded because the updated base required a third independent review round.
