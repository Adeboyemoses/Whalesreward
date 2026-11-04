# WO-app-3 upload and receipt fidelity

Status: not verified. Independent test-engineer check for A04, A08, A23, A14 and A16 at 390 px and 360 px.

The script is `tests/design-parity/uploads/capture.spec.ts`, using the contract-shaped HTTP fake through the real typed adapter and browser IndexedDB. It checks horizontal overflow and 48 px tap targets before saving each built screenshot. This is client verification only; actual storage validation, credit transactions and Android acceptance remain with WO-core-4 and Earl's phone smoke.

## Execution limit

On 5 November 2026, the local production build succeeded, but Playwright could not start Chromium in the sandbox. It failed before test code with `bootstrap_check_in ... Permission denied (1100)` at `mach_port_rendezvous_mac.cc`, then SIGTRAP. One attempted test failed at browser launch; zero browser scenarios executed. No screenshot comparison or parity pass is claimed.

| Board | Match | Differences | Severity |
|---|---|---|---|
| A04 Sale synced | Unverified | Browser launch prevented built screenshot | blocking verification |
| A08 Pending uploads | Unverified | Browser launch prevented built screenshot | blocking verification |
| A23 Empty uploads | Unverified | Browser launch prevented built screenshot | blocking verification |
| A14 Price review | Unverified | Browser launch prevented built screenshot | blocking verification |
| A16 Gas synced | Unverified | Browser launch prevented built screenshot | blocking verification |

## Expected contract-driven differences to inspect

- A23 must distinguish durable uploads from credit and avoid a link to unbuilt History. Cancelled sales without validated photos must not claim every photo reached the server.
- A14 reflects unresolved historical price checks rather than comparing with the latest sync-time price. Mixed holds remain visible and uncredited.
- A04/A16 do not invent a photo-received timestamp from the details-received timestamp.
- M1 navigation is Sale, Uploads and Account; History and Register are later scope.
- WHR-45 already tracks fixed trailing-zero quantity formatting; no shared formatter change is part of this work order.

Replace the unverified table with actual screenshot findings after a permitted browser run. Do not treat this report as sign-off.
