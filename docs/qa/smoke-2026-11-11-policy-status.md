# Policy status and actionable errors

WO-core-7d / WHR-100. Run after the reviewed change is deployed; no cloud or policy activation is part of this work.

1. Open `/api/health` without signing in. Expect only `ok`, `version`, `db`, `fullyConfigured`, with no top-level `cardPrint` or policy names. Healthy database remains HTTP 200 when policies are unconfigured.
2. Sign into the admin portal with current `settings` permission. Open `/api/health` again. Expect `policies` with exactly auth, delivery, delegation, phone, meter, phoneVerification, recovery, reconciliation, timing and cardPrint; each value is only configured or unconfigured. No configuration values, diagnostics or secrets appear. Unimplemented M3/M4 evaluators remain unconfigured; fullyConfigured is therefore false today.
3. Revoke settings permission or use an attendant/restricted session. Health must return only the public projection. Both projections use no-store and Vary: Cookie.
4. In local regression fixtures with each existing M2 policy disabled, verify JSON 409 with the original error code and retryable false. Check the existing user message in the applicable desktop/phone flow, no success or state change, and generic public password recovery remains 202.
5. A terminal failed card export returns JSON 409 export_failed. Prepare a new export; fetching or replaying the old export never restarts it or changes card inventory. Transient unavailable errors retain their retry path.

Automated evidence and exact test results are recorded in `.review/core__wo-7d-policy-status.md`.

Existing copy gaps are tracked in [WHR-101](https://linear.app/phaneum/issue/WHR-101/align-existing-policy-and-failed-export-messages-with-actionable): auth/delegation currently use the generic fallback, and export failure copy still offers same-preparation retry. This work preserves that copy; a terminal failed export cannot actually restart. Message tests prove preservation, not that these fallbacks give complete guidance.
