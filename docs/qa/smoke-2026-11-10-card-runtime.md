# WHR-97 card generation and exports

Use fictional staging data. Repeat retest workbook r1 on the merged build.

1. Generate a batch of five cards. Expected: one generated batch with five reserved codes; retrying the same confirmation does not duplicate it.
2. Prepare PDF. Expected: preparation completes and the authorized download is a valid PDF with those reserved codes.
3. Prepare Excel. Expected: preparation completes and the authorized download is a valid workbook with the same reserved codes.
4. Repeat preparation and inspect batch status. Expected: exports do not change status or codes; no platform error pages.
5. Correlate request times with Earl-supplied process logs and Insights. Expected: no crash/restart or sustained lock/storage wait.

Reference: retest r1 / s02; no visual design changes.
