# Customer change browser tests

Run against isolated local PostgreSQL:

```sh
pnpm exec playwright test --config tests/customer-changes/playwright.config.ts
pnpm exec playwright test --config tests/design-parity/customer-changes/playwright.config.ts
```

The dedicated configuration defaults to `whr_app6_customer_changes` on the repository's local Docker PostgreSQL port. Its setup accepts isolated `whr_app6_*` database names. Acceptance tests live under `tests/e2e/`, so the normal CI browser suite also discovers them.

C02, C04, unconfigured C03, profile/history and challenge reads use the running Next HTTP stack. Configured C03 writes use a **test-only browser-to-service bridge** to the actual `recoveryWrite`, authenticated browser session and PostgreSQL, with the existing `phoneTestAdapter`. This is not a production HTTP happy-path test: the production handler intentionally has no adapter injection or provider toggle. The bridge verifies origin, route/action and input schemas, returns actual service outcomes and never fabricates verification or replacement receipts. Tests cover the pending response followed by a real challenge-status read.

Verification codes are generated dynamically by the server test adapter and remain in process/form memory. Trace, video and automatic screenshots are disabled both in the dedicated config and in the test file. Code entry uses an evaluated native input setter so failed fill diagnostics cannot echo the value. Secret assertions return booleans only. Fidelity captures occur only after verification clears/removes the input. No fixed verification code, destination, provider payload or credential is written to a fixture or artifact.

The local macOS sandbox can deny Chromium's MachPortRendezvous bootstrap. In that case, run the same source and commands in a local Linux Playwright environment. Copy only source, excluding Git metadata, worktrees, product documents, environment files, dependencies, build metadata and test output; install dependencies with the lockfile inside that environment. Do not weaken the sandbox or point tests at a deployed service.
