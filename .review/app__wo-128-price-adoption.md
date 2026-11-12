---
branch: app/wo-128-price-adoption
linear: WHR-128
tier: high
reviewed_head: 1fce45935209ec43fe6e280c4e0674da6798700a
rounds: 0
builder: offline-engineer
reviewers: {}
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 0
plan:
  goal: Adopt current acknowledged-pump prices through existing reads while preserving composed drafts and every saved original.
  files: src/client/api*, src/client/types*, src/client/offline/**, src/app/(attendant)/**, src/ui/**, src/styles/app.css, tests/**, docs/briefs/**, docs/qa/**
  approach: Strict four-shape lookup decoding and capability header; one context-guarded transactional monotonic price adoption path for session and lookup; compose from the latest persisted price only on meaningful input; keep-and-warn UI with no refresh-only requests.
  tests: P-27 PR-T1-01 through PR-T1-12 app obligations; stale generations and two-tab ordering; populated legacy storage immutability; real phone flows and 390/360 fidelity; full unit and browser gates.
  risks: A stale response could cross accounts or roll back price; early form freezing could miss lookup refresh; late refresh could reprice a draft or saved sale; update handover and capture-window anchors must remain intact.
invariants: [I-02, I-03, I-05, I-06, I-22, I-23, I-26, I-28, I-28a, I-28b, I-29, I-31, I-32, I-39, I-45b, I-49, I-50]
p1: []
tickets: []
---

Approved WHR-128; core dependency merged as 1fce459 via PR #125 before work began.
High-tier plan committed before builder dispatch. No STATUS, coverage-map or lane edits.
Implementation and independent verification are pending; no review verdict is claimed.
