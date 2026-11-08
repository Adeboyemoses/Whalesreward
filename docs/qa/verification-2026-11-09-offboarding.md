# WO-core-6a P-21 backend verification plan

Part of WHR-80. Implement the M2 assignment/end API, M1 P-21 amendment and existing
data-model transaction specification. No UI parity or new M3 recovery authority.

Required checks: exact attendant/assignment guard and rollback; OR-grant authorization
and revoked replay; immediate revocation of every full/restricted session and previously
unrevoked context; immutable opening assignment history plus explicit ending audit;
no-assignment ready/restricted sign-in with generic non-revealing errors and no anchor;
end/end, reassign, sign-in, first-password and finalize/storage races; retained old
queues and same-account later resumption; P-20 termination before/at/after original U;
replay after reassignment must preserve the original receipt without revoking new sessions.

EM will paste named real-PostgreSQL output and final typecheck/lint/unit/build,
integration, timezone and local browser results here before review. Existing M3
recovery policy gates remain closed; no unimplemented recovery route is claimed tested.
