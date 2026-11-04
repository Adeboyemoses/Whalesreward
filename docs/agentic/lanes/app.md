# lane:app
WO-app-2 (WHR-5) Offline capture: READY on reviewed green staging merge, 2026-11-04

## In flight
- `app/wo-2-offline`: typed M1 HTTP adapter/test fake, Dexie v1 atomic account partitions, 24-hour/rollback lock, live camera/QR, static attendant screens and Workbox shell cache.
- EM: typecheck/lint/build, 39 unit tests, 30 Playwright checks and 3 time tests per timezone pass. Independent fidelity: 11 boards at 390/360 px in `docs/qa/offline-capture-fidelity.md`.
- WO-app-1 accepted and closed: PR #24 merged, WHR-2 Done; implementation #12 and wrapping #20.

## Next
- STOP at READY. Earl runs `docs/qa/smoke-2026-11-04-offline-capture.md` only after WO-core-3 merges.
- Real session/sign-in endpoints belong to WO-core-3; uploading and crediting to WO-app-3/WO-core-4. No further scope started.

## Earl's gos
- 2026-11-04: “Earl accepted WO-app-1 (WHR-2); close it.”
- 2026-11-04: “Work order: WO-app-2 (WHR-5), offline capture.” Build against M1 typed adapter and test fake; “Take it to READY with Playwright green, then stop: Earl's phone smoke test waits until WO-core-3 merges.”

## Risks
- Automated contract fixtures do not prove real authentication, Android camera readability, storage eviction or TalkBack behavior; phone acceptance pending.
- WHR-45 quantity display drift remains separate. No upload-first completion in this capture-only order; UI explains pending sales.
- Browser storage is not encrypted or a server backup; no automatic deletion implemented.

dispatches=9 prs=2 rounds_max=1 escalations=0 model=unknown
