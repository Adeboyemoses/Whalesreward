# WO-app-6d: admin policy and failed-export messages

Run on the local app with fictional fixtures; never change deployed policy or client data. Approved copy comes from WHR-101 and supersedes the earlier retained-copy assertions in WO-core-7d. Existing implementation briefs for admin rows 01, 07, 15 and 16 supply the screen and permission context.

1. At desktop and phone width, make admin sign-in return `auth_policy_unconfigured` with HTTP 409 (B01). Expect exactly: “Sign-in isn't set up on this server yet. Contact your system administrator.” Stay on sign-in; no private response detail appears.
2. With an authorized fictional admin, make assignable roles or a users/roles mutation return `delegation_policy_unconfigured` with HTTP 409 (H02/H03/H06). Expect exactly: “Access settings aren't set up on this server, so roles can't be changed. Contact your system administrator.” No change is claimed successful.
3. Open a fictional batch's export history and make a protected file request return `export_failed` with HTTP 409 (K02/K03). Expect exactly: “File preparation failed. Prepare a new export.” The failed item offers a new-export path, no same-preparation retry or download. No file downloads and stock/status/codes stay unchanged.
4. Repeat with an export whose metadata state is `failed` (K02). Expect the same approved message and new-export path. Follow it, review and explicitly confirm a fresh export; it uses a new operation ID.
5. Contrast a temporary/unavailable export response (K02). Expect same-operation retry to remain available; no fresh preparation is created automatically.

Automated regression: `tests/e2e/policy-status-messages.spec.ts` in desktop and attendant projects; unit tests for the safe client error mappings. Additional existing export lifecycle browser cases protect unchanged inventory and retry semantics.
