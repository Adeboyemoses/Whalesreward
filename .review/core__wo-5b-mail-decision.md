---
branch: core/wo-5b-mail-decision
linear: WHR-68
tier: medium
reviewed_head: 9851c07c45bdcbe8c818190544c4185d1b039f5c
rounds: 1
builder: em
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0}
dispatches: 2
invariants: [I-12, I-52]
p1: []
tickets: []
---

T-16 records the implementation choice delegated by Earl's explicit WHR-68 go.
Use existing web-service resources, bounded polling and durable message leases.
No additional paid component, cloud action or production provider activation.
Code and security reviewers found no issues; the healthy-queue latency qualification
and actual-runtime shutdown verification requirement are explicit.
