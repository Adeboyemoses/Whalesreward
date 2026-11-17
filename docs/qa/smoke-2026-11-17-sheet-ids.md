# WHR-176 sheet identifier smoke check

Use fictional local PostgreSQL and MinIO data, with the existing held-release flow and fictional v2 policy enabled only in an isolated local test environment. Sign in an authorized proposer, reserve a sheet, request its upload URL, PUT valid image bytes, finalize, then propose using the returned asset ID unchanged. Expect UUIDv7 upload/asset IDs, successful HTTP responses and a pending proposal with zero credit. Verify strict UUIDv4 rejection and randomized private storage keys. Do not activate v2 in a deployed environment or change runtime defaults.
