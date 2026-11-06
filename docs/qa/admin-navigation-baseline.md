# Admin navigation baseline — WO-app-4a

Before implementation, 6 November 2026. Deployed health endpoint returned `ok: true`, `db: ok`, version `60726369233367fd2b0e5f5c8abe44279e94144c`.

The browser-control host was unavailable, so the EM used native Chrome accessibility controls. Two existing staging admin tabs were present. Returning to the users tab visibly showed **Loading account…**; it subsequently redirected to sign-in because the session had expired. The second existing admin tab was also signed out. No credential, cookie, token or account data was read or exported, and no staging mutation was performed. Earl was asked to sign in privately before protected timing samples.

One tab's existing DevTools configuration showed iPhone 16 emulation (393×852) and built-in 3G throttling. This is an observed pre-existing setting, not an unthrottled timing sample. Do not mix it into an unlabelled before/after comparison.

## Required samples

| Operation | Before | After | Target |
|---|---|---|---|
| Return to admin tab | Pending active session | Pending implementation and deployment | <300 ms to existing content |
| Open a user | Pending active session | Pending implementation and deployment | <1 second |
| Open a role | Pending active session | Pending implementation and deployment | <1 second |
| Move between users and roles | Pending active session | Pending implementation and deployment | No full reload or full-screen access check |

## Source investigation (not timing evidence)

Rook's three findings are confirmed by the current source: plain anchors for admin navigation, route-keyed AdminPortal remounting, and focus clearing the session before fetching it again. Additional waits are plain Sidebar anchors, full-document auth/mutation transitions, and Management.load awaiting picker/detail/history in series before removing its Loading return. A successful focus refresh remounts editors and discards drafts. Actual tab discarding is not established: check document.wasDiscarded and navigation timing on the measured authenticated page before attributing the tab-return behavior to Chrome Memory Saver.

Historical checkpoint only: the staging-before hold below was superseded by Earl’s subsequent local-measurement decision on WHR-75. Feature implementation now waits for local throttled fixture baseline samples. Test-only local failing regressions may be prepared independently. Local reproduction and server health do not substitute for protected staging timings. No success or performance target is claimed yet.

## Superseding measurement decision — 6 November 2026

Earl explicitly declined agent operation of a live staging Owner session. Both baseline and result will instead be measured on the local stack with generated fictional accounts, Playwright and Chrome DevTools Protocol network throttling: approximately 150 ms RTT to model the staging network, plus a clearly configured Fast 3G worst case. Record the exact latency and throughput values alongside repeated samples for tab return, user detail, role detail and section navigation. Earl alone confirms the deployed behavior after merge. The earlier staging observations remain historical and are not the timing baseline. No further live-session Computer Use is authorized or planned.
