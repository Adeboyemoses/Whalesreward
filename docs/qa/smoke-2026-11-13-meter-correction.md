# WHR-132 meter correction smoke · 13 Nov 2026

Use fictional local fixtures with a test-only approved meter profile. No production configuration activation is part of this work order. Earl's combined end-of-M3 staging smoke remains the acceptance gate.

1. As a full admin with sales and priceReview, open a held sale and choose Correct from meter evidence. Check original values/rate remain read-only and price cancellation stays unavailable.
2. Open the validated photo full size. Close by keyboard and return to the editor; unavailable/expired evidence should explain the problem rather than imply validation succeeded.
3. Independently enter the photographed amount and litres/kilograms. Editing one must never change the other. Check two-decimal money and captured quantity precision, including zero, negative, exponent, excess precision, and a very large exact amount.
4. Enter a reason and evidence explanation, review the exact pair, then confirm. With a passing test pair, verify the server records one revision/decision with unchanged original context and only the price hold resolved. Any other hold still prevents credit.
5. Use another sale and a pair outside the test profile's display allowance. Verify plain-language refusal, unchanged effective values and no credit/decision. Never adjust a value merely to satisfy reconciliation.
6. Check missing meter configuration, nonuniform historical rate, unchanged pair and stale sale/hold/revision responses. Wording explains that the sale stays held and when a fresh read/review is needed.
7. Lose a committed confirmation response, then retry the identical frozen operation. Verify one decision and no second credit; edits/new keys remain unavailable until the uncertain operation is resolved.
8. Revoke priceReview or change account during review; confirm the UI cannot submit using obsolete access. Check keyboard operation and 1440px S04 layout plus responsive narrow rendering.

Automated evidence: real-stack browser tests, independent 1440px fidelity report, and code/security/integrity review verdicts linked from the feature PR.
