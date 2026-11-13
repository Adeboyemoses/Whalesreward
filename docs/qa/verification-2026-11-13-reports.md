# Reports and overview backend verification

WHR-24 / WO-core-13 implements the reports, overview and export sections of M4 as amended by WO-spec-4a. This is backend verification; E05–E07 and B02 screen work belongs to WO-app-12. No campaign policy, client dates, retention deletion or cloud resources are activated.

## Named PostgreSQL coverage

Run `pnpm exec vitest run --project integration tests/integration/reports-adversarial.test.ts tests/integration/reports-exports-adversarial.test.ts tests/integration/reports-http-adversarial.test.ts tests/integration/reports-meter-adversarial.test.ts tests/integration/reports-currency-adversarial.test.ts --maxWorkers=1` against an isolated local PostgreSQL database.

- `I-42 one accepted predicate separates currencies and units, retains flags and matches customer totals`: shared operational inclusion, duplicate and late-proposal flags, exact currency and unit separation.
- `I-42 exclusion precedence is cancelled, held or policy-blocked, incomplete, then ineligible`: mutually exclusive source buckets and excluded sums.
- `I-05 report groups preserve original seller and pump after offboarding and profile edits`: captured attribution survives live account changes.
- `I-29 actual meter decision is aggregated and exported as stored instead of recalculating its pair`: real P-26 review through reports and XLSX.
- `I-29 PostgreSQL sums beyond BIGINT and JavaScript safe integers remain exact`: two maximum BIGINT source amounts sum to 18446744073709551614 kobo.
- `inclusive Lagos sale days use accepted verified date without substituting trusted receipt`: inclusive day boundaries, original timestamps and accepted dates.
- `all group pages keep full totals and source cursor binds filters and generation`, `flag and original validation changes invalidate the report generation`, and `one PostgreSQL snapshot never exposes an uncommitted flag or a generation without its data`: pagination, stale views and concurrent source changes.
- `I-07 overview permission gates match M3 status filters across all days`: global distinct attention counts, recent projections and launch-unset behavior.
- `I-41 one immutable request and terminal audit survive replay and source changes`: same-generation export, frozen data, replay and terminal audit uniqueness.
- `export ceiling rejects 100001 real source rows atomically without truncation`: production ceiling and rollback, without a lowered test limit.
- `I-07 both status and file are creator-only even for another equally privileged administrator`: narrow artifact authority.
- Revoked-creator, upload-revocation and stream-start cases test live permissions before processing, publication and download.
- Hung-storage and expired-lease cases test bounded waits, responsive unrelated reads and fenced publication.
- `failed render exhaustion is terminal with 409 export_failed and replay never restarts it`, plus HTTP failed/pending/expired cases: stable nonretryable domain errors even with unavailable storage.
- `24-hour expiry and corrupt stored bytes deny downloads without deleting source evidence`: expiry, checksum verification and preservation.
- `exact XLSX refuses unsafe precision, includes exclusions and never executes formula-like labels`: explicit precision failure and inert text cells.
- `I-41 version-2 report audit validates fields at persistence and safely projects malformed historical payloads`: strict mappings and safe legacy fallback.
- HTTP tests cover Origin, strict shapes, body bounds, invalid/range dates, first-password and disabled sessions. Report/source/export privacy assertions exclude customer phones, evidence credentials and raw provenance.

The additional `reports-currency-adversarial.test.ts` proves production rejects USD, then widens only three currency CHECKs inside its disposable fixture schema to exercise future-compatible NGN/USD included and excluded grouping, stable ordering, frozen sources and numeric XLSX cells. All acceptance and immutability guards remain. This tests the report projection; it does not enable live USD purchases.

## Arithmetic and rendering coverage

`src/server/modules/reports/reports.test.ts` verifies exact aggregation, NUMERIC(30) overflow refusal, range and cursor bounds, XLSX decimal round trips and formula safety, PDF pagination with wide/Unicode labels, and audit persistence validation. A NUMERIC(30) overflow cannot practically be constructed through valid bounded source rows; the arithmetic boundary is tested directly, while PostgreSQL tests exercise sums beyond BIGINT.

## Release gates

The EM runs typecheck, lint, unit tests, build, the complete PostgreSQL suite, both timezone suites and browser regressions on the integrated branch. Final counts and the reviewed head are recorded in the PR and `.review/core__wo-13-reports.md`. Two existing image lint warnings are unrelated to this change. A baseline operator-suite cleanup timeout under default parallel load passed in isolation; final local PostgreSQL execution uses bounded workers without changing assertions or timeouts.
