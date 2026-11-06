# WO-core-6 backend verification plan

Part of WHR-10. Backend only; WO-app-5 supplies the later staging screen smoke.

Run typecheck, lint, unit, production build, real PostgreSQL/MinIO integration,
local Playwright and both configured timezone suites on the final source.
Record actual commands, named new test cases, counts, and limitations at READY.

Acceptance checks: atomic attendant and initial assignment creation; unique normalized
names/usernames and immutable codes; first-password restrictions; price races and
precision-only changes; stale versions and replay; live permission revocation;
configured versus acknowledged assignment and unchanged old capture contexts;
P-20 price and assignment changes inside and outside [S, U], including late receipt
with U capped at the original offline expiry; disabled-account rejection; no sale
or price history rewrite. Domain changes must audit actor/reason/server time.

Pump edit/deactivation and attendant enable/disable conflict with M2 exclusions;
those operations remain pending Earl's scope answer. Existing disabled-account
rejection tests are independently in scope.
