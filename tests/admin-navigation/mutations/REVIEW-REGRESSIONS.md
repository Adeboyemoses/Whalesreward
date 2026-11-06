# WHR-75 review regressions

Local real-PostgreSQL/Chromium evidence only. No staging requests, GUI, external inbox, retained traces, tokens or response bodies. Fictional fixtures use contract-valid UUIDv7. No server permission changes.

The non-mail tests remain in ordinary CI: `tests/e2e/admin-navigation-mutations.spec.ts` (five cases). Only genuine enqueue/verification continuations use `tests/admin-navigation/mutations/playwright.config.ts` with the local Mailpit provider (five cases). No skips or provider/CI configuration changes.

## Before fixes

Frozen runtime `d184a3c` (same runtime as `4e87ed7`; d184 only changes agent guidance): all five non-mail cases fail. Real successful user and custom-role PATCH responses leave “Not saved yet”; failed history/picker secondary reads replace the editor with a fabricated queued-delivery view; held PATCH completion sends the browser back to the departed record. The initial combined run reported eight failures, but only the first five are valid regression evidence: the default no-op email provider correctly returned 503 for the mail prerequisites. That refusal is not an application defect.

With the genuine local Mailpit provider and expected enqueue status 202, the three initial mail cases on `d184a3c` reported **2 failed, 1 passed (16.9 s)**. Held verification-follow-up GET rewrites the departed route; normal queued acknowledgement is lost when the suffix changes. Held initial send to a different route passed and remains a guard test. One preparatory fixture attempt used UUIDv4 and was rejected by the UUIDv7 contract; that run is not application regression evidence. A preparatory mail assertion expected HTTP 200; corrected to contract HTTP 202 before the reported mail run.

## First fix

Runtime `44a101f`, final split tests: ordinary CI subset **14 passed, 0 failed, 0 skipped (13.0 s)**, comprising the five non-mail regressions plus previous eight navigation cases and one default admin-access case. Local typecheck/lint passed. The first three mail regressions also pass.

Extending verification departure to the same record exposed a remaining view-lifetime bug. After a successful queue acknowledgement, hold either Resend POST or its follow-up GET; click Back to user; release the response. Both reopen `/verification-sent`. Mail suite: **3 passed, 2 failed, 0 skipped (18.3 s)**. Sent to the frontend builder; no production code edited by the test engineer.

A clean rerun of the final five-case default file directly on frozen `d184a3c` confirms **5 failed, 0 passed, 0 skipped**. It excludes all mail prerequisites and preparatory fixture/assertion mistakes.
