# WO-app-7 sales and corrections smoke

Use fictional local fixtures and the local application. Earl's combined M3 acceptance follows WO-app-8; these steps establish this slice's READY state.

1. Sign in as an attendant; open History (A09). Only this account's sales appear, newest receipt first. Pending phone records are explicitly local and not repeated after upload.
2. Open an accepted sale (A10). Check recorded basis, rate, seller, amount, quantity, separate app/receipt times, immutable originals and paged revision/correction/decision history. Inspect the actual meter photo; pending/deleted/unavailable evidence states say so.
3. Correct the numeric value (A11). Only the recorded basis is editable; rate/customer/medium/photo stay read-only. A reason is required; unchanged/invalid values cannot save. Counterpart uses exact recorded settings.
4. Disconnect before saving. The correction is saved separately on this phone; reconnect/retry preserves its identity. An unaccepted original shows Waiting for the original, then submits only against the matching accepted base. Effective-value changes require attention.
5. Observe server result: applied automatically, pending validation, or awaiting review. A late correction leaves accepted values counting. Test correction_pending, no_change, sale_not_correctable and changed base messages.
6. Switch attendant accounts with local work pending. Neither rows nor photos nor corrections from the previous account appear or upload. Return to the original account to resume.
7. As a sales admin, open Sales (B03), search each supported identity/reference and use status/day filters. Summary covers the whole filtered set, excludes uncredited spend and separates products/units. Exact customer filter persists into detail and back until cleared.
8. Open sale detail (B04). Inspect actual evidence using freshly authorized photo access, original values, revisions, corrections, decisions and flags. Missing/deleted evidence never displays an approved placeholder. Export/Correct/Mark duplicate/Cancel are absent.
9. Review a late proposal (S01) with sales AND corrections. Compare current and requested values, enter reason, choose outcome, explicitly confirm; Keep reviewing changes nothing. A recovered request labels unverified authorship; executor and grant authorizer are refused. Closed/stale reviews explain the conflict without overwriting.
10. Reopen views; inspect Network and Cache Storage. History and photos are never served from service-worker caches. Phone layouts work at 390 and 360 px, admin at 1440 px and narrow widths, with labelled inputs and visible focus.
