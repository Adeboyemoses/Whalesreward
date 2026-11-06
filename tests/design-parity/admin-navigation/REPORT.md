# Admin navigation focused design fidelity — WHR-75

Independent test-engineer check, 6 November 2026, using the design-fidelity-check skill. Runtime source: `a628e2f` (navigation implementation `4e87ed7`, plus accepted core station/offboarding base). Local Linux Chromium, Node 26.12.0, device scale 2, 1440 × 1000 and 390 × 1000 CSS px. Fresh local database `whr_admin_nav_parity_final`, all seven migrations and fictional seed. Two sequential viewport fixtures add one unverified Owner each; captures therefore contain two and three admins respectively, one Owner role. No live staging access occurred.

Opened all four source PNG boards beside their desktop and phone captures. This is a focused regression comparison with the previously accepted [admin-access report](../admin-access/REPORT.md), not a new exact-pixel claim or a repeat of all 24 boards. The approved desktop board has no mobile counterpart; 390 px checks responsive fallback. Screenshots are in [screenshots](screenshots/). Password inputs are asserted empty, automatic failure screenshots/video/traces disabled. All displayed accounts are fictional.

| Board | Match | Differences | Severity |
|---|---|---|---|
| H01-Users | Existing structural hierarchy retained | Access tabs, users table and history stay visible through client navigation. Fixture rows/counts differ. Capture includes the new inline “Refreshing users…” state while existing rows remain visible. Two delivered sidebar sections, compact create link/history and plain status text are inherited from accepted WO-app-4. At 390 px the table scrolls within its container. | note; inherited WHR-69 |
| H04-UnverifiedUser | Existing form/state retained | Unverified record, verification action, role/status/reason controls, access summary and history remain. Owner fixture has 28 grants rather than the board's Read-only account. Existing compact presentation omits the board's warning banner/created detail/status pill. On phone the summary stacks below the form. | inherited WO-app-4 record presentation; WHR-69 |
| H05-Roles | Existing structural hierarchy retained | One provisioned Owner, rather than fabricated Operations/Read-only presets. Existing table columns/status and create link differ from board; known compact history/sidebar remain. Phone table scroll stays inside the card. | note; inherited WHR-69 |
| H08-SensitivePermissions | Existing protected state retained | Protected Owner notice, 28 checked disabled permissions, canonical grouping and six Owner-default badges remain. Canonical API labels and compact editor heading replace older board copy; existing separate explanatory sensitive-action panel is absent. Phone groups stack and labels wrap without document overflow. | intentional contract override / inherited WO-app-4 |

No newly introduced layout, font, colour, control-hierarchy or account-state regression identified in these four states. Existing presentation limitations remain declared; this check does not close or expand WHR-69/70. The screenshots include ordinary dynamic list refresh, not held-request timing evidence. Held-response browser assertions separately establish visible list context and inline detail progress.

## Verification and rerun

Focused capture: **2 passed, 0 failed, 0 skipped (6.6 s)**. No document horizontal overflow at either width, and password values empty before every capture. This focused run does not reassert every control's tap-target height or every access-board state; the broader accepted report documents those checks.

After merging the accepted base and applying migration seven, default admin access plus navigation: **9 passed, 0 failed, 0 skipped (16.2 s)**. Immediately before that base merge on `4e87ed7`: **9 passed (9.1 s)**. Existing dedicated Mailpit auth/recipient suite after the transition fix: **4 passed, 0 failed, 0 skipped (25.7 s)** on `4e87ed7`; it covers ordinary/restricted sign-out and same-tab recipient reset/verification transitions. Independent identity/permission-epoch unit tests: **5 passed**. Full EM gates remain independently owned by the EM.

```sh
git archive HEAD | docker exec -i whr-admin-navigation-tests tar -xf - -C /verify
docker exec -w /verify -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_test whr-admin-navigation-tests pnpm test:e2e tests/e2e/admin-navigation.spec.ts tests/e2e/admin-access.spec.ts --project desktop --workers=1 --retries=0
docker exec -w /verify -e DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_nav_parity_final whr-admin-navigation-tests pnpm exec playwright test -c tests/design-parity/admin-navigation/playwright.config.ts
docker exec -w /verify -e WHR_ADMIN_TEST_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_admin_browser_nav_final -e WHR_ADMIN_TEST_ROOT_DATABASE_URL=postgresql://whr:whr@host.docker.internal:5433/whr_dev -e MAILPIT_URL=http://mailpit:8025 whr-admin-navigation-tests pnpm exec playwright test -c tests/admin-access/admin-access.config.ts
```

For exact parity fixture cardinalities, create a fresh local database, deploy migrations and seed before capture. Reusing the named database adds fictional fixtures. Compose credentials above are public local fixture credentials. Performance evidence is separately frozen to measured source `4e87ed7` in [the comparison](../../admin-navigation/COMPARISON.md); no timing claim is made about this later merged base or deployed staging.
