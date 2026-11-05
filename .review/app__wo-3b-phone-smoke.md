---
branch: app/wo-3b-phone-smoke
linear: WHR-65
tier: high
plan:
  goal: remove measured capture navigation stalls while preserving strict access and exact values
  files: attendant runtime/sale/receipt/uploads, src/client API/offline/sw, tests, docs/qa, docs/briefs
  approach: measure deployed baseline first; isolate local access/rendering from network waits; bounded generic shell fallback; authoritative references and display-only amount formatting
  tests: staging before/after marks; 3G/offline transitions within 2 seconds; delayed session/navigation/upload; expiry/revocation/account races; exact amounts and references
  risks: stale auth responses must never unlock access; original 24-hour anchor and queue ownership persist; no API caching or false credit; no server changes
---

Pre-dispatch plan only. Baseline staging measurement is a prerequisite to application edits. Reviewer verdicts and final verification remain pending.
