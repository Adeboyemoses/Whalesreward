# P-23 register then sell smoke

Part of WHR-94. Run on the staging build containing the core and app P-23 releases, using fictional test customers and an active unused card. Earl manages environment configuration; do not copy evidence or configuration values into reports.

1. Sign in online as an assigned attendant. Open Register (A06). Register a new fictional customer and link an active unused card. Expected: Card linked (A07), without an invalid-response error.
2. Choose the sale action immediately, enter the sale details and take a fresh meter photo (A02/A03). Expected: matching customer and original assignment; no second registration.
3. Save and wait for details and photo to sync (A04). Expected: sale credited when ordinary price, assignment, campaign and evidence checks pass (acceptance s06 + s08). Verify the admin sale outcome; never paste receipt bytes.
4. Look up the card online, then disconnect. Start another sale with that cached card (A05). Take a fresh photo and save. Expected: Saved on phone, without claiming credit.
5. Close and reopen the app while offline. Expected: saved sale and photo remain; the lookup keeps its original evidence. Reconnect and upload (A15/A16). Expected: the same sale reaches its authoritative outcome exactly once.
6. Leave a queued sale, switch to another attendant, then return to the first account online (A12/A13). Expected: the second account sees none of the first account's customers/queue; the original sale retains its original evidence and assignment.
7. Repeat an uncertain registration using the same attempt. Expected: historical result, current card validation before composing a new sale, and no duplicate registration. Check legacy responses still work with null evidence.

Other holds remain independent. Automated tests cover draft refresh races, context changes, legacy database rows, transaction/quota failure and lost-response retries. A real phone retest remains Earl's acceptance step after READY.
