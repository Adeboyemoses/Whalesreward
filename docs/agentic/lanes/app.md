# lane:app
WO-app-6 (WHR-13) Registration, customers and loyalty cards: READY since 2026-11-09

## In flight
- Feature [#86](https://github.com/Adeboyemoses/Whalesreward/pull/86) merged green at ffb18b7; this separate records PR completes READY. Code/security/integrity PASS round 3 at b04c9fb. Core independently reviewed the WHR-85 shared aggregate proposal/local fixture scope and owned the merge. Server authority and original capture bounds/queues remain unchanged.
- Online registration, canonical duplicate handling and fresh-card sale handoff; masked customers and scoped purchase reads; reviewed Generated/Printed/Active lifecycle, protected immutable PDF/XLSX preparation/preview/download. No M3 recovery or account-change controls.
- EM typecheck/lint/build and 413 unit tests PASS; Linux default 214 PASS/four existing staging-only skips, two workers/zero retries; actual policy 3 PASS. Independent parity 4 PASS, all 13 boards plus A24, 28 PNGs/28 metrics and two actual PDF/QR probes. Reports: tests/customers-cards/BASELINE.md, tests/design-parity/customers-cards/REPORT.md; evidence .review/app__wo-6-customers.md.

## Next
- STOP at READY. WHR-13, WHR-11 and WHR-77 stay In Review for Earl's later consolidated staging smoke workbook. Scenarios: docs/qa/smoke-2026-11-09-customers-cards.md and smoke-2026-11-09-station.md. No next app work order started.

## Earl's gos
- 2026-11-09: “Earl approved WO-app-6 (WHR-13): registration, customers and loyalty card screens, the last M2 work order.” “Take WO-app-6 to READY and stop; keep WHR-11 and WHR-77 In Review.”

## Risks
- D08 phone/print configuration and physical/native-PDF visual acceptance remain separate. Headless PDF interior is blank; actual protected bytes/filtering/QR equality passed. Declared contract/inherited navigation differences remain; WHR-81 pump-prefix follow-up is untouched.
- WHR-83 inherited route-fake duplicate fulfilment occurred once; final full gate passed unchanged, cause unknown. A new test's cached-version precondition was corrected with a forced authoritative-read barrier, without relaxed assertions/timeouts/retries.
- Formal reviews fixed one uncertainty boundary in two steps: malformed success JSON and unexpected/null decoding errors now retain the original operation; actual committed-response red/green regressions prove one batch/export. Dispatch flag exceeded (>8): builders, independent tests/fidelity, Core boundary review and three formal rounds. Runtime model ID unavailable. No live Owner, cloud/provider or staging-data action.

dispatches=27 prs=2 rounds_max=3 escalations=0 model=unknown
