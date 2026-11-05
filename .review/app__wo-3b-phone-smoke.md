---
branch: app/wo-3b-phone-smoke
linear: WHR-65
tier: high
reviewed_head: 59362ad5edd7057a1837f073b874f113fbbc257f
rounds: 2
builder: offline-engineer
reviewers:
  code-reviewer: PASS
  security-reviewer: PASS
  integrity-reviewer: PASS
blocking: {P0-OPEN: 0, SEC-HIGH-OPEN: 0, INTEGRITY-P1-OPEN: 0}
dispatches: 14
plan:
  goal: remove measured capture navigation stalls while preserving strict access and exact values
  files: attendant runtime/sale/receipt/uploads, src/client API/offline/sw, tests, docs/qa, docs/briefs
  approach: measure deployed baseline first; isolate local access/rendering from network waits; bounded generic shell fallback; authoritative references and display-only amount formatting
  tests: staging before/after marks; 3G/offline transitions within 2 seconds; delayed session/navigation/upload; expiry/revocation/account races; exact amounts and references
  risks: stale auth responses must never unlock access; original 24-hour anchor and queue ownership persist; no API caching or false credit; no server changes
invariants: [I-02, I-03, I-04, I-06, I-09, I-23, I-26, I-29, I-49, I-50]
p1: ["fixed Save-time lookup wait by retaining the request in the background with late-denial handling"]
tickets: []
---
Measured staging before edits: 3G Save 4145.2 ms, next sale 2021.9 ms; session wait 2029.2 ms. The reported 1–3 minute duration was not reproduced.
Local state now renders after durable access checks; authority requests continue in the background. Generic navigation fallback is 1200 ms, including stalled bodies. Capture navigation uses the shared client shell.
Round 1 found Save still awaited its repeat card lookup. Round 2 retains that exact check in the background; late denial locks its originating context. A held-lookup browser regression failed on both profiles before the fix and passed both afterward.
The original 24-hour anchor, final atomic access/context checks, retained sale/photo and server credit authority remain unchanged. Exact raw money is preserved; references come from authoritative server status.
Frontend-engineer built amount/reference views; test-engineer supplied regressions and independent six-board fidelity at 390/360 px (12 screenshots). Existing WHR-45 differences remain outside scope.
EM final head: typecheck, lint, 159 unit tests, production build, three timezone tests in each timezone PASS. Full browser: 94 passed, four existing conditional skips, zero retries (7.2m). Guard self-tests: 94 passed.
All three reviewers passed round 2 at reviewed_head. Worktree was clean and head unchanged after each review round. Dispatch count exceeds the high-tier flag and is recorded for the READY lane handoff.
After-deployment performance marks and final READY records follow the green staging merge; physical Samsung acceptance remains Earl's rerun. No server, shared contract, lease duration, cloud resource, or production change.
