---
branch: spec/wo-3b-capture
linear: WHR-61
tier: high
reviewed_head: 10714883a10f5e94f408f002f11ef810ef95db64
rounds: 3
builder: spec-em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 9
invariants: [I-03, I-05a, I-07, I-09, I-11, I-22, I-26, I-28, I-31, I-34, I-35, I-39, I-41, I-42, I-45a, I-46]
p1: ["fixed terminal cancellation bookkeeping for original validation blocks"]
tickets: []
plan:
  goal: specify P-20 capped capture interval and evidence-backed M3 capture review
  files: M1 and M3 contracts, M4 capture-policy cross-references, data model, invariants, decisions index, coverage map, spec lane and STATUS
  approach: amend existing rules in place, preserve immutable context and receipt, resolve only sale-local capture blocks through guarded audited decisions
  tests: EM typecheck, lint, unit tests and build; document consistency and paragraph bounds; three independent spec reviews
  risks: late receipt must not extend capture authority; review must not bypass evidence, other holds, live permissions or upload deadlines
---

Approved WO-spec-3b is specification only. WO-core-4a implements the interval;
WO-core-9 implements capture review. Q-528 stays pending.

Round 1: code/security PASS. Integrity found the stale M4 uncapped interval
(INTEGRITY-P1) and cancellation retaining active unresolved blocks (P1).
Round 2: all three reviewers PASS on the same final head after both fixes.
M4 cross-references now use P-20. Cancellation closes blocks with its decision
reference without confirming facts or granting credit. No open findings.
EM verification: typecheck PASS; lint PASS; 19 unit files / 96 tests PASS;
build PASS; git diff --check PASS. Amendment and <=120-word prose checks PASS.
No runtime source/schema or user flow changed; integration/e2e not locally
required for this docs-only slice. CI remains required before staging merge.

Round 3: concurrent accepted core closeout PR #37 advanced staging. Its clean
merge touched STATUS and coverage, so all three reviewers rechecked the final
head and PASS. Product spec unchanged; EM gates rerun PASS (96 unit tests).
The lane file flags nine dispatches; no escalation or over-cap round.
