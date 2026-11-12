# WO-app-9 smoke: customer account changes

Use the local real stack and fictional fixtures. Sign in with customers and recovery permissions. No external provider is required: production-unconfigured behavior is an acceptance path; automated verification uses the server test adapter only.

1. Open a customer profile and Update phone number (C02). Check the masked current number and account identity. Review requires a new valid number, reason and card-inspected attestation; there is no OTP.
2. Review a phone update (C02). Old/new phones are masked. Keep editing works. Confirm applies to the same account and shows C05 receipt/history with actor, reason and Lagos server time. Try invalid, unchanged and occupied numbers; each has a useful error.
3. Change customer/card version after review (automated companion test). Confirm must fail stale, never silently apply to a different card/context.
4. Choose Replace lost card (C03), request a code with the adapter unconfigured. Expect "Lost-card replacement isn't switched on yet" and a working manager intake link.
5. With the local server test adapter, request and verify a code (C03). Only registered masked phone appears; wrong/expired/unavailable codes share one message. Code input clears after every use; resend respects its countdown. No browser persistence, trace or log contains a secret.
6. Choose an unused Active card, give a reason and review (C03). Confirm retires the old card and retains customer/history. C05 shows server receipt and history. An unavailable candidate leaves the old card intact; a lost response retries the same operation.
7. Open manager intake (C04). Enter customer-present, checks made and why the code cannot be used, without identity-document numbers, phones or secrets. Confirm shows "Recorded for a manager, nothing changed yet". Repeat must show the existing/open case without account changes.
8. Sign in with customers only. History is readable; recovery actions are absent/denied. Revoke recovery or sign out during a request: no stale data or result may surface under another session.
9. Disconnect during editing/review. Mutation controls must not imply offline completion. Reconnect and deliberately retry if needed.
10. Inspect all four screens at 1440 px and narrow phone width. Labels, keyboard focus, notice states, review panels and scrollable history must remain usable.

Automated evidence and fidelity report will be linked in the READY comment. Earl's end-of-M3 workbook remains the human acceptance check.
