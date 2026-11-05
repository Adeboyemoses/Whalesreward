---
branch: spec/wo-3b-capture
linear: WHR-61
tier: high
plan:
  goal: specify P-20 capped capture interval and evidence-backed M3 capture review
  files: M1 and M3 contracts, M4 capture-policy cross-references, data model, invariants, decisions index, coverage map, spec lane and STATUS
  approach: amend existing rules in place, preserve immutable context and receipt, resolve only sale-local capture blocks through guarded audited decisions
  tests: EM typecheck, lint, unit tests and build; document consistency and paragraph bounds; three independent spec reviews
  risks: late receipt must not extend capture authority; review must not bypass evidence, other holds, live permissions or upload deadlines
---

Approved WO-spec-3b is specification only. WO-core-4a implements the interval;
WO-core-9 implements capture review. Q-528 stays pending.
