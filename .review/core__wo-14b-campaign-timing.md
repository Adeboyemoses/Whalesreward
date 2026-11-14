---
branch: core/wo-14b-campaign-timing
linear: WHR-150
tier: high
reviewed_head: 8e991c4
rounds: 0
builder: backend-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Implement approved P-28 Owner campaign creation and pre-start timing through existing Settings endpoints.
  files: prisma/**, src/shared/contracts/{settings,audit}*, src/server/modules/{settings,health,audit,sync,reviews}/**, station bootstrap, tests/**
  approach: Immutable registered campaign-timing-v1 with station binding; security then reporting then campaign locks; receipt-first replay; locked fresh clock; atomic settings/history/audit/generation.
  tests: Every named core acceptance item in m4 follow-up notes, non-superuser registry constraints, lineage regressions, full gates and time suite.
  risks: Owner revocation and replay, absent campaign races, start crossed waiting on locks, legacy incomplete history, retention pins, policy mismatch, public health redaction.
invariants: [I-08, I-11, I-22, I-28, I-41, I-45, I-45a, I-46, I-51]
p1: []
tickets: []
---

Normative design and acceptance checklist: docs/engineering/contracts/m4.md,
Owner setup through Follow-up impact notes; operations.md and data-model.md P-28.
Use the existing Settings review/confirm protocol rather than a new provisioning route.
No campaign values, cloud operations, real databases, screens or feature-PR status records.
