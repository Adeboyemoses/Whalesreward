# WHR-151 settings fidelity

Independent checker: test-engineer, 16 November 2026. Production UI at a1661ac, real local PostgreSQL and real admin sessions/settings routes. Compared source B07/T01/T03 boards with built PNGs; T02/T04 retention captures rechecked as regressions. No board values are application defaults. The fictional checker entered March 2035, zero grace and 37 retention days; existing test history is retained.

| Board | Match | Differences | Severity |
| --- | --- | --- | --- |
| B07 | Two settings sheets, station details, history and action hierarchy | P-28 adds launch/start, configured pre-start state, Owner action and exact campaign timezone/ISO values. Real history replaces empty-board sample. Retention remains intent only; stored-copy policy stays unconfigured. | Note: approved contract differences |
| T01 | Campaign form beside deadline explanation; labeled inputs, reason and explicit review/cancel | P-28 requires five inputs rather than board cutoff/grace. Exact ISO-offset input preserves seconds and microseconds. Upload deadline waits for server review. Form is taller than board to accommodate these required fields. | Note: approved contract differences |
| T03 | Previous/proposed comparison, actor/reason, confirm/keep editing/cancel | Five inputs and derived deadline include exact ISO plus calendar/offset. Long exact values wrap in the three-column comparison: content equals container width (571 px desktop, 314/284 px phone). Both before and proposed remain visible without horizontal scrolling; phone rows are taller to preserve full precision. | Note: exact-value wrapping |
| T02 | Compact period/unit field, disabled-deletion card, reason and actions | Fictional 37 days rather than board 180. Backend policy facts replace sample stored-copy assumptions. | Note: existing contract differences |
| T04 | Comparison, recorded-by/reason and unchanged deletion warning | Fictional 37 days, real actor; no deletion claim. | Note: existing contract differences |

1440/390/360 px captures and metrics are alongside this report. Phone main controls measured at least 48 px, document width never exceeded viewport, and wordmark stayed on one line. Keyboard Tab from retention confirmation reached Keep editing with the token 2 px solid outline. Timing comparison has no horizontal overflow; history retains its existing scroll wrapper. The existing admin sidebar stacks above content on phones; this inherited shell pattern is unchanged.

No unresolved blocking or visible-fix finding. This is contract-adjusted fidelity, not pixel-identical parity with pre-P-28 boards. Old `T01-locked`/`T03-locked` captures remain historical WHR-27 artifacts; current T01/T03 filenames are the P-28 editor/review.

Verification:
- Focused real-stack desktop timing + retention: **20 passed (32.0s), 0 failed**. Six timing scenarios use real reads/mutations; three explicitly named projections exercise start/snapshot/cross-start UI refusal boundaries. Existing P-28 integration tests separately prove trusted server locks.
- Independent fidelity capture: **1 passed (12.5s), 0 failed**.
- Local macOS Chromium initially refused sandbox Mach-port registration. Matching Playwright v1.64.1 Linux container supplied the browser over a loopback-only remote connection; the application and database remained local.
- Initial browser testing exposed three-digit versus six-digit instant comparison; builder fixed it before the passing runs. Visual review found clipped timing comparison columns; the EM added scoped wrapping and this final capture verifies every column fits. Retry tests wait for the uncertain outcome before retrying and follow Return to confirmation after navigation.

Reproduce with the normal `playwright.config.ts` and `tests/design-parity/settings/playwright.config.ts`; on this sandbox host set `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9323/` and `PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>` for the matching local browser container. Never point these fixtures at staging or production.


## Full-suite isolation follow-up

Campaign timing browsers now opt into `tests/settings/test.ts`: a separately migrated local schema and real compiled Next server per worker (ports 3300 + worker index). Both authority and HTTP writes remain real. The fixture restores environment values, terminates only its own server and drops only its random schema. Teardown checks schema removal and unchanged public campaign IDs. The concurrent-retention helper uses the worker origin explicitly. Ordinary settings and unrelated review tests keep their normal stack.

This fixes test pollution: entering future campaign dates in the shared fictional station changed unrelated capture-review assumptions. After the isolated desktop and attendant timing workers finished, direct SQL verified **public campaign count 0** and **no timing_browser_% schemas**. Focused timing + ordinary retention across both browser projects: **40 passed (1.2m), 0 failed**. No server behavior or protected history was changed to obtain this result.
