# WHR-97 runtime investigation

The initial investigation below is historical. See “Hung-storage source fix” for the subsequent reproduced defect and fix.

No staging root cause established yet. Earl's staging logs/Insights are pending. No source fix, instance resize recommendation or READY claim follows from these local results.

Source: staging 4cfcd46 plus investigation plan only. Fictional isolated databases, local Compose PostgreSQL/MinIO; no cloud access or secret-file reads.

## Measurements

- Production `pnpm build` passed on host.
- Existing `tests/customers-cards/s02.spec.ts` production API matrix: six PDF/XLSX × Generated/Printed/Active cases passed, zero retries, 32.0 seconds with a 128 MiB V8 old-space cap.
- Correction: the initial host preload matched only the literal pg module name and did not intercept Next resolved imports. Its six-pass 31.8-second run does NOT prove a two-connection request pool. Existing worker pool already max 2. Sampled pg_stat_activity every 100 ms for six seconds during run: zero lock waiters. This short window does not exclude brief waits.
- Bundled renderer under Docker 512 MiB memory, one CPU and 128 MiB old-space: five-card PDF 292 ms / 105 MB RSS, XLSX 15 ms / 106 MB RSS; 1000-card PDF 11.16 seconds / 317 MB RSS, XLSX 47 ms / 323 MB RSS. No crash. RSS sampled at 5 ms; synchronous sections can hide short peaks. Five-card fixture repeats a valid code to isolate rendering; it is not inventory generation.
- Actual `prepareCardExport` with a controlled storage-write promise held for two seconds: competing security_state FOR UPDATE observed PostgreSQL Lock/transactionid and waited 2019 ms; preparation completed once storage was released. This proves storage holds the global security lock, not that storage caused the historical incident. A preliminary attempt to reuse a ready fixture row was correctly rejected by the immutable-export database guard; the successful probe inserted a new pending fictional export.

A V8 old-space limit is not an RSS/container memory cap. The host production runs are therefore not a complete staging resource match. The renderer Docker run has a real cgroup limit but excludes the web process. The full production container run below supplies the missing resource-constrained evidence.

## Reproduction helpers

Bundle the renderer to an absolute temporary path with `pnpm exec esbuild src/server/modules/cards/renderer.ts --bundle --platform=node --format=cjs --outfile=/tmp/renderer.cjs`, then run `node --max-old-space-size=128 scripts/diagnostics/card-render-memory.cjs /tmp/renderer.cjs`.

Preload `scripts/diagnostics/card-pool-limit.cjs` with Node `--require` to force two connections per pool without changing production source. It prints only the effective maximum, never connection options. Preload `runtime-memory.cjs` for RSS/heap samples. Use these only for local diagnostics, not deployment.

Use the existing s02 config, override webServer command to start the already-built production artifact, and set DATABASE_URL to a fresh localhost `whr_app6_...` fixture database. Keep its existing layout, storage and authentication fixtures. Do not use a staging database.

TRD, Cards and customers: “Generate PDF print sheets and Excel batch registers from reserved codes; export must not change lifecycle state or regenerate identifiers.” No export checks, lifecycle or authorization changed.

## Verified production container run

Locked install and Linux production build from tracked source passed. Build needed 3 GiB memory / 2048 MiB old-space; an earlier TypeScript build worker heap exhaustion at 1 GiB is a build-only result, not a reproduced request failure.

Runtime container `whr97-runtime` was then capped to 1 GiB memory and swap, one CPU, and app old-space 128 MiB. The corrected preload recognizes pg exports even when Next resolves their absolute path. Telemetry explicitly confirmed all three created pools max 2. Matrix: **6 passed, zero retries, 33.0 seconds**. Sampled process RSS peak 219,258,880 bytes; heap peak 72,444,040 bytes; per-pool connection total peak 1, acquisition waiting peak 0. No process restart or platform failure reproduced. Tests run in the same cgroup, so the cap includes runner overhead. This is a local same-source production build, not a downloaded staging image; actual staging limits await Earl.

Re-run in the retained container:

```sh
docker exec -w /app -e DATABASE_URL=postgresql://whr:whr@127.0.0.1:5433/whr_app6_whr97_em whr97-runtime pnpm exec playwright test --config scripts/diagnostics/card-runtime.config.ts --reporter=line
```

The container uses `whr-upload-browser:lean`, a tracked-source archive, `pnpm install --frozen-lockfile`, and `pnpm build`. Loopback TCP proxies on ports 5433/9000 forward to `host.docker.internal` public local Compose services. Set build resources separately; before tests apply `docker update --memory=1g --memory-swap=1g --cpus=1 whr97-runtime`. The runtime command is next start, matching the deployment Dockerfile mode. Confirm `pool-limit` telemetry says max 2; absence of that evidence invalidates the pool-cap claim.

The controlled storage probe is `scripts/diagnostics/card-storage-lock.ts`. Bundle it with esbuild (`--bundle --platform=node --format=esm --packages=external`) to a temporary `.mjs` inside the repository (for dependency resolution), then run with DATABASE_URL pointing to an already-populated isolated localhost `whr_app6_whr97_...` matrix database. It creates one fictional pending export and uses a deliberately gated fake write, so never use that database for subsequent download assertions. It measures lock duration, not real Spaces latency.

Checks: host production build and typecheck passed; scoped diagnostics ESLint passed. Unit/integration suites not run: no product fix selected. Pending: staging incident logs/Insights and correlation; no regression can honestly be named as reproducing the incident yet.

## EM independent verification

The same constrained Linux matrix independently passed **6/6, zero retries, 32.8 seconds** on 10 Nov 2026. Docker inspection confirmed 1,073,741,824-byte memory limit, one CPU, restart count zero and OOMKilled=false. Three observed pool constructors printed max=2. Sampled app RSS peaked at 218,365,952 bytes; sampled pool acquisition waiters remained zero. Log: `/tmp/whr97-em.log` (local temporary evidence). This does not reproduce the staging incident or establish its cause. Earl's staging evidence remains the next required input; no PR or READY claim.

## Hung-storage source fix

Earl subsequently reported flat staging memory (~15.5%) and CPU (~3%); historical request logs were no longer available. The authorized next step was a hung-storage regression and source fix, not an instance resize. Local reproduction establishes a real cross-request blocking defect; it does not reconstruct the exact old platform response without those logs.

Root cause reproduced: export preparation held `security_state FOR UPDATE` while awaiting storage. A never-resolving storage promise therefore blocked independent admin reads. Download likewise retained authority locks while reading storage. Request database pools also had no acquisition, lock or statement deadline, allowing that queue to exceed a platform response budget.

Red before the source change: `WHR-97 hung storage releases admin authority and leaves a retryable export` failed with `expected false to be true` at the independent admin read responsiveness assertion after 500 ms; one failed, 42 skipped. The test adapter never resolves until cleanup, so this is a hung operation, not a slow two-second success.

The fix releases every database transaction before storage I/O. Preparation checks the claim before upload and publishes only after a fresh lock, live creator authorization, matching lease nonce/fence and unexpired lease. A five-second abort plus promise race bounds ignored cancellation. A late write uses an unpublished random key and cannot resume publication. Downloads validate bytes/checksum outside the transaction, then recheck current session, permissions, creator, expiry and artifact identity before returning bytes. The adapter bounds both headers and the entire body and destroys a stalled stream.

Request database bounds: acquisition 5 s, server lock wait 3 s, server statement 5 s, client query 6 s, idle transaction 15 s. Client query timeouts discard the connection rather than enqueue rollback behind a still-running query; failed rollback and asynchronous client errors also discard it. Idle pool errors are handled with a generic log event. Server statement cancellation retains normal rollback semantics.

Regression evidence:

- Hung upload under a two-connection pool: independent admin read completes within 500 ms; export exits failed with no lease within the five-second storage bound; retry succeeds; the original ignored-abort write can finish afterward without changing the published artifact.
- Hung download: independent admin read remains responsive; download fails `temporarily_unavailable`, and retry with working storage succeeds.
- Upload authorization revocation / lease expiry during storage cannot publish; session revocation during download cannot release bytes.
- Real local HTTP storage response sends headers and one byte then never finishes: timeout returns `temporarily_unavailable` and the socket closes. Separate mocked transport tests cover completely ignored aborts.
- Real PostgreSQL held authority lock and exhausted request pool return JSON 503 with `temporarily_unavailable`, `retryable:true`, then recover.
- Real PostgreSQL client read timeout discards the active connection; idle transaction termination produces no unhandled client error and a fresh transaction succeeds.

Builder checks: typecheck and lint passed; unit 529/529 passed; complete cards integration 48/48 passed; after strengthening late-write assertions the six WHR-97 integration cases passed again (19.55 s); production build passed. Full migrated integration had 344 passed, one failed and 39 skipped solely because MinIO at localhost:9000 was unavailable (offboarding evidence write and sync suite setup). EM final-head verification and independent code/security/integrity review remain required.

Escape gotcha: never await external storage while holding the global admin authority lock; deadline the whole body and re-authorize after I/O. The agent file is sandbox-protected, so this gotcha is recorded here for EM handling rather than editing `.codex`.
