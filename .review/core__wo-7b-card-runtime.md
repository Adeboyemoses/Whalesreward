---
branch: core/wo-7b-card-runtime
linear: WHR-97
tier: high
plan:
  goal: establish and fix the cause of platform failures during card generation and export preparation
  files: src/server/modules/cards/**, src/server/adapters/card-artifacts*, tests/**, scripts/**, docs/qa/**
  approach: reproduce production runtime under small memory and two database connections; measure render memory, lock waits and storage latency; fix only the evidenced cause
  tests: failing regression for established cause plus production reproduction and required repository gates
  risks: process exhaustion, lock contention, slow storage, lease fencing and immutable reserved codes; cloud changes belong to Earl
---
Investigation pending; no reviewer verdicts yet. No STATUS, coverage or lane edits (WHR-63).
