# WHR-27 settings fidelity

Independent checker: test-engineer. Compared B07, T01, T03, T02 and T04 source PNGs and HTML with the attached built captures. The local production build uses real PostgreSQL, real admin sessions and the merged settings HTTP routes; no successful settings response is faked. Fixtures are fictional. No staging data or deployed configuration was changed.

Desktop captures use 1440 px and deviceScaleFactor 2. Phone checks use actual 390 px and 360 px viewports, initially 844 px high, and the same scale factor. The final capture database is fresh so the overview shows the designed empty history. The retention proposal is a deliberately different fictional 37 days, entered only by the checker; the application does not seed a board value.

| Board | Match | Differences | Severity |
| --- | --- | --- | --- |
| B07 | Campaign/retention sheets, station details, history and unset-state warning | Launch/start and station timezone are added from the contract. Nulls say Not set; stored copy says Not configured when policy is unconfigured. Timing action says View rather than Edit and explains the WHR-55 lock. Retention is intent only. Server product order and configured precision replace board samples. | Note: contract and approved scope |
| T01 | Campaign dates beside the separate purchase/upload deadline explanation | All timing controls are replaced by the required locked notice and read-only server values until WHR-55. No sample cutoff, grace, launch or start is invented. | Note: required locked state |
| T03 | The direct timing confirmation route remains safe and read-only | It deliberately shows the same locked campaign panel; no timing review or confirm action is offered before policy approval. | Note: required locked state |
| T02 | Retention editor, required reason, disabled deletion statement, review/cancel and evidence explanation | The entered fixture uses 37 days, and null is an empty input. Copy explicitly says photos are never deleted automatically. The removal policy remains separate. | Note: approved semantics |
| T04 | Before/after comparison, reason, actor, explicit confirm/keep editing/cancel and history explanation | Current session provides actor name, not a display admin code; saved history includes the authoritative actor code. No board timestamp/reason/duration is copied into the application. | Note: contract projection |

The existing portal sidebar shows implemented destinations and uses its current navigation order/icons, rather than the board's future full navigation. On narrow viewports the existing shell puts navigation above the page. Those inherited shell differences are outside this work order. The settings content itself collapses to one column; comparison/history tables retain their type size and scroll within their own container. This is a hierarchy, copy and state comparison, not a pixel-equality claim.

All final desktop and phone captures were inspected. Main-page controls measure at least 48 px high on both phone widths. The document width equals the viewport at 1440, 390 and 360 px. The wordmark has one rendered line at every width. A keyboard Tab from Confirm changes to Keep editing produces a visible 2 px solid token-colour outline, saved in T04-focus-1440. No loyalty-card footer exists on these routes.

## Findings and fixes

- The initial exact heading selector omitted the visible Not saved yet badge, which belongs to the accessible heading. The test now matches the heading prefix while retaining explicit comparison/action checks.
- An early source sync arrived after the build had compiled CSS. Its old artifact lacked the settings wrapping rules. A clean build of the actual candidate resolved that artifact-only overflow; no assertion or product constraint was waived.
- Fresh fidelity then found 40 px phone action targets because a more-specific desktop minimum overrode the mobile rule. The frontend builder added the equally-specific 48 px mobile rule.
- Visual comparison found redundant large table headings, a neutral review badge, and retention controls that lost the board's compact input/unit and deletion-card hierarchy. These were returned to the frontend builder as one batch before final review. The final captures verify the corrected heading hierarchy, blue review badge, compact days input/suffix, disabled-policy card and inline overview links.
- The pagination fixture initially exceeded the unchanged read/write rate profiles while generating history. It now reuses returned versions and uses two independently authorized fictional writers, 13 changes each. Production limits remain unchanged.

## Reproduction

Use a fresh local fixture database with migrations applied. Run `pnpm exec playwright test tests/e2e/settings-real.spec.ts --workers=1 --retries=0`, and `pnpm exec playwright test --config tests/design-parity/settings/playwright.config.ts --workers=1 --retries=0` for captures. Fixture setup takes a test-only session advisory lock to serialize this single-station settings flow across browser projects. It never resets or rewrites immutable settings history.

On this host a matching Playwright v1.64.1 Linux container ran the actual production build. Temporary runtime-only configs reused that just-built artifact for focused browser/capture runs; the tracked configs build normally. Trace, video and automatic failure screenshots are disabled for credential-bearing sessions. Only explicit sanitized settings screenshots are committed.

Visual production candidate: `214f432`. The later `74dbcf2` transport fix retains frozen confirmation identity after a 429; it does not change the captured markup or styling. The test commit contains this report and all 12 PNGs / 12 metric files. No unresolved blocking or visible-fix finding remains; the contract and inherited-shell notes above are explicit comparison limits.

```text
Final focused real-stack browser suite: 22 passed (14.3s), 0 failed, 0 skipped.
Cross-file settings + station + review suite: 68 passed (59.8s), 0 failed, 0 skipped.
Independent fidelity: 1 passed (20.6s including clean production rebuild), 0 failed, 0 skipped.
Desktop + attendant projects; two workers for final browser suites; zero retries.
Focused client boundary tests: 8 passed.
Targeted ESLint: exit 0.
pnpm typecheck: exit 0.
```

The final full-repository gates are run independently by the EM after this commit; those counts belong in the PR evidence and smoke runbook.

## Review follow-up regressions

The committed-response-loss case first forces a real catalog precision change after review and proves the resulting 409 is review_stale with no settings effect or receipt. It permits only the strict, bounded explicit recovery described below before saving. It discards a response only after an actual 201, returns one 429 on the next attempt, and then permits the same frozen request to reach the real replay endpoint. Rejected pre-commit operations are recorded separately from the three identical committed/retry requests and remain without versions or receipts. The former first-attempt-201 assumption failed deterministically with review_stale; the revised case passes in both projects and alongside the competing station/review flows. The old client failed because Retry confirmation disappeared. The fixed client retains that control, keeps Keep editing and Cancel disabled, returns the original receipt, and leaves exactly one settings version, history entry and mutation receipt. The test waits for the busy state to end and checks the generic uncertainty message. Browser RED evidence was one failing case on the old client; both projects pass with the fix.

Parallel station/review tests can legitimately change the canonical settings comparison through product quantity precision or campaign reporting generation. Ordinary success helpers accept a 409 only when its exact code is review_stale, settings version/pointer and retention are unchanged, all station identity/timezone and campaign identity/timing fields remain unchanged, and a permitted metadata field actually differs. They also prove that the rejected operation wrote no settings version or receipt. They then explicitly use Reload settings, Review changes and Confirm changes with a new reviewed digest/operation. They allow at most three confirmation attempts and fail if no attempt succeeds. Expected-refusal cases never use this recovery. The history setup applies the same checks before preparing a fresh side-effect-free proposal. No production lock, rate limit, worker count or timeout was changed.

A deterministic real price activation changes only kerosene quantity precision between retention review and confirmation. It asserts the first confirmation returns review_stale, the fresh explicit review uses a new digest/operation, and only the later confirmation advances the settings version. The competing-retention fixture also requires its competing value to differ from both the proposed and current values, and asserts a change was saved.

The cross-file stress database was freshly migrated and populated by one existing M3 real-flow preflight (1 passed, 3.8s) before the 68-case run. A settings-only reused database exposed an inherited M3 helper assumption: it creates historical campaign fixtures only while no settings version exists. That separate issue is tracked as WHR-140; the M3 fixture was left unchanged. The EM's final standard full-suite gate uses its own fresh database and ordinary complete-suite order.
