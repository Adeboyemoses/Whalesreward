# Operational endpoints

Part of WO-core-15 (WHR-28). These endpoints describe deployment readiness; they do not expose product records or establish purchase acceptance.

## GET /api/health

Public, read-only health probe for App Platform. No authentication, request body or query parameters are required. It performs a bounded `SELECT 1` database probe without reading customer or staff data.

| Result | HTTP | JSON |
|---|---|---|
| Database probe succeeds | 200 | `{ "ok": true, "version": "<deployment version>", "db": "ok" }` |
| Missing database configuration, connection/query failure or timeout | 503 | `{ "ok": false, "version": "<deployment version>", "db": "unavailable" }` |

`version` is `APP_VERSION` when supplied by deployment settings, otherwise the package version. The staging web component binds it to its source commit so Earl can compare the response with GitHub. It is a build identifier, never a credential.

Responses use `Cache-Control: no-store`. Staging responses also carry `X-Robots-Tag: noindex`. Errors never include connection strings, database hosts, exception text or stack traces. A successful probe confirms database connectivity; it does not prove that seed jobs, application workflows or storage uploads succeeded. Check deployment job results separately.
