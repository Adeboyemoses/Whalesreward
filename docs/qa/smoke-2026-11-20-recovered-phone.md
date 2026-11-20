# Recovered phone census enforcement

Use a disposable local database and fictional fixture accounts only. This is
server mutation verification; no UI board changes are included.

1. Configure a campaign, verified named manager and complete phone census.
2. Propose a phone unavailable; independently approve with a different verified person.
3. Submit an empty phone check with fresh guards but the same census. Expect HTTP
   409, no check, pointer, version, operation or audit changes.
4. Record a replacement census, retaining the recovered phone and full account
   coverage. Submit an empty check using the new census and fresh guards. Expect
   HTTP 201 with a check pinned to the replacement census.
5. Verify the old approved exclusion and any old snapshot remain unchanged.

Automated evidence: unchanged T2 recovered-phone contract regression, added real
HTTP recovery flow, and real PostgreSQL concurrent transitions as a non-superuser.
