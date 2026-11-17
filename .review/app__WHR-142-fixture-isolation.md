---
branch: app/WHR-142-fixture-isolation
linear: WHR-142
tier: low
reviewed_head: c6c0309c80057e9aba4edca1d3147e51c9680153
rounds: 1
builder: test-engineer
reviewers:
  code-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 3
invariants: [I-41, I-45, I-45a, I-51]
p1: []
tickets: []
---

WHR-142 and WHR-140: isolate Settings in a migrated worker schema and real Next server;
derive request origins from that server. Make the fictional M3 campaign prerequisite
explicit and append historical timing independently of retention-only settings history.
Prior rows, retention intent, station lineage and campaign pointers are preserved.

Both independent reviewers passed the five-file test-only diff without findings.
The head and clean worktree were verified after each review. Production code,
metadata checks, server guards, retry/timeout bounds and CI configuration are unchanged.

EM verification: typecheck, lint (two pre-existing image warnings), 981 unit tests,
production build and formatting passed. Real API ordering regression reproduced the
missing timing row before the fix, then passed both projects in parallel with zero retries.
The EM repeated that regression: 2 passed. Local full browser execution was attempted
but Chromium bootstrap was denied by the macOS sandbox before test execution.
Merge requires three consecutive full browser passes in unchanged normal parallel CI,
with no retries in Settings, M3 review or the new ordering-regression files.
