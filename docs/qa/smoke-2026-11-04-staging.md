# Staging phone smoke — 4 November 2026

Part of WHR-28. Run after Earl provisions using [the staging runbook](../ops/staging.md).
All fixtures are fictional. This infrastructure work has no new hi-fi board.
The existing gallery is the WO-app-1 component reference; no screen parity is claimed here.

1. Open the app HTTPS URL on an Android phone. Expect a valid TLS connection and a visible “Staging · fictional data” banner.
2. Open `/api/health`. Expect HTTP 200 and JSON with `ok: true`, a version and `db: "ok"`. Record URL and deployment commit, never credentials.
3. Open `/dev/gallery`. Expect the existing component gallery and staging banner. Check a narrow phone width without horizontal scrolling caused by the banner.
4. On a desktop, inspect response headers for `/`, `/dev/gallery`, `/api/health`, a missing route and a static asset. Expect `X-Robots-Tag: noindex` on each app response.
5. Match the App Platform deployment source commit to the current GitHub `staging` head. On the next approved merge, expect a new automatic deployment, successful migration/seed jobs, and healthy HTTPS routes again. Do not make an unreviewed change just to force a deploy.
6. In a non-staging production-mode local build, expect `/dev/gallery` to return 404 and no staging banner. No production cloud app is needed.

Pending: Earl provisioning, provider spec validation, HTTPS checks and next-merge automatic deployment proof. Local tests do not prove cloud operation.
