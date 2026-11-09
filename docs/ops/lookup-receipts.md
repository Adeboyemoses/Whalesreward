# P-23 lookup receipt configuration

Earl configures staging; no cloud change is part of WO-core-7a.

- `WHR_LOOKUP_RECEIPT_KEYS`: secret JSON object mapping allowlisted key IDs to canonical unpadded base64url keys. Each key must be independently random, at least 32 bytes and dedicated to lookup receipts. Use distinct keys for each environment. Key IDs use 1–32 ASCII letters, digits, underscores or hyphens.
- `WHR_LOOKUP_RECEIPT_ACTIVE_KID`: the key ID used for new receipts. It must exist in the allowlist.

No key values belong in source control, logs, PRs or Linear. Missing or malformed configuration disables issuance; lookup and registration continue with null evidence for capable callers. Without an active key, a valid allowlist can still verify old receipts. Unknown/removed keys cause fallback to the original sign-in bound on first submission, never rejection.

Rotate by adding a fresh key to the allowlist while keeping previous verification keys, then change the active ID. Retain old verification keys for outstanding saved evidence, including delayed upload and recovery: the 24-hour composition expiry is not an upload deadline. Removing a verification key deliberately makes any not-yet-submitted evidence using it fall back. Already durably verified purchases keep their frozen result through rotation and finalization. Do not regenerate a key under an existing ID.

Clients opt into response evidence with exactly `X-WR-Lookup-Receipt: 1`. Enable the app capability only after this core release. Legacy responses omit the field; legacy submissions retain their original digest namespace. Registration freezes evidence regardless of capability and projects the same original result on replay.

Existing ordinary lookup and registration authorization is unchanged. An expired session/context still receives its existing authorization error; if receipt eligibility disappears after authorization, the receipt helper returns null. This feature does not change midnight or correction-cutoff policy.
