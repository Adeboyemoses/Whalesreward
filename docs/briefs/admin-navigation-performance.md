# Admin navigation performance correction

WO-app-4a / WHR-75. Existing approved briefs `admin-row-01-access.md`, `admin-row-02-recovery.md`, `admin-row-03-verification.md`, `admin-row-15-users.md` and `admin-row-16-roles.md` remain the visual and behavior references. All existing board states and copy stay in scope as regression boundaries; no new screen or product policy is designed.

| Surface / boards | Reads and writes | Required correction | Authority / states |
|---|---|---|---|
| Access shell, H01–H10 | Existing M2 session and protected user/role APIs | Keep current session/permissions in memory across client navigation; preserve list context and show detail progress inline | Server authorizes every request; initial load, ready, background refresh, transient failure, definitive denial, changed identity/grants |
| Entry and logout, B01/B08/B09/B18 | Existing sign-in, first-password and sign-out APIs | Explicitly invalidate old account state/drafts on sign-in/out, never retain credentials in shared shell | First-password restriction and server-confirmed sign-out unchanged |
| Recipient flows, B10–B17/M01/M02 | Existing token inspect/confirm and mail request APIs | Preserve token scrubbing, same-tab replacement/replay and race fencing through client navigation | Token/page memory only; no automatic authentication or fabricated email delivery |
| Review/editor, H02/H03/H04/H06/H08/H09/H10 | Existing versioned domain writes | Focus refresh must not remount healthy drafts; changing route/account clears secret and confirmation drafts | Live server permission/version checks, uncertain retry keys and explicit review/confirm unchanged |

Measure staging before code changes and repeat the same four operations after deployment. Session provider placement is an engineering choice to verify against the current App Router layout. No server endpoint, schema, auth expiry, role policy, browser cache or service-worker scope change is proposed. Success at focus refresh must not blank or remount the screen; authoritative denial must revoke its usability immediately and show a clear reason. Target tab return under 300 ms and user/role detail under one second on staging. Distinguish real browser tab discard from app-driven clearing using only non-sensitive performance diagnostics.

No copy/style redesign; retain the existing 1440 px boards and usable 390 px fallback. Existing out-of-scope Reports reference (H07) and WHR-69/70 limitations are not added work. Code, security and integrity reviewers must independently check the final head.
