# WO-app-6a smoke verification

Use fictional local fixtures for automation; Earl retests M2 workbook s02, s09 and s17 after READY.

1. s02, K02/K03: prepare PDF, poll until ready, preview and download; repeat the same preparation after an uncertain response. Expect the same export ID, verified PDF bytes, unchanged batch version/status/codes. Repeat for Excel and verify XLSX bytes. Record precisely which receipt, schema or file check rejects a response. If the cause is server-side, stop and post evidence for T1 without changing client checks.
2. s09, A03/A24/A06/A07 at 390 px: find valid unknown code Z9Z9Z9Z. Expect Register this customer to open registration. Where permitted, retain the code in the card field. The registration server still checks active, unassigned stock.
3. A03/A24: enter a code containing I, O, 0 or 1, and codes shorter/longer than seven characters. Expect Enter the seven-character code printed on the card, without a lookup or the unregistered-card notice.
4. s17, A17 at 390 px: with a live attendant session, change the assignment through the authorized local admin flow. Expect the reassignment banner on Sale and every attendant screen until a fresh online sign-in. Existing queues retain their originating account and assignment.
5. A17/A04/A05: trigger reassignment while saving a sale. Expect the save to finish atomically without navigation or interruption; the persistent notice remains visible afterward. Fresh sign-in loads the new assignment and clears the notice.

Required before READY: EM final-head gates; independent code, security and integrity PASS within three rounds; independent board fidelity; green reviewed PR merged into staging. No STATUS, coverage or lane edits in the feature PR.
