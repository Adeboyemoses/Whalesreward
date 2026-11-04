# Product invariants

The rules the code must enforce, distilled from Features and Requirements (F&R) and the Technical Requirements (TRD) as of 3–4 November 2026. Each line names its source so you can read the full rule. If this file and the product docs disagree, the product docs win: fix this file in the same PR and flag it.

Every invariant here needs at least one automated test that fails when the rule is broken. The test name goes in the [coverage map](coverage-map.md).

**Proposals, not settled rules.** These are TRD or design recommendations awaiting the client. Build them behind one constant or setting, and never report a deviation from them as INTEGRITY-P1: Africa/Lagos as the station timezone ("provisionally"), NGN/kobo as the currency (store a currency code beside every amount), the seven-character card alphabet, competition-rank display (1, 1, 3), half-up rounding, `priceReview` defaulting to Owner, and the "litres" spelling (Q-517).

## Identity, access and assignment (F01, F12, TRD "Authentication")

- I-01 Each attendant has a personal account: name, unique username, password and a permanent system-generated ID. Shared pump logins do not exist.
- I-02 Sign-in, account switching and customer registration need connectivity. Capture can continue offline inside an existing session.
- I-03 Offline capture is allowed for **24 hours after the last successful online sign-in**. Reopening the app or regaining signal never renews the window. Only a fresh online sign-in with the same account does. At expiry, capture and uploads pause and pending sales stay on the phone. (F&R "Confirmed offline-use window")
- I-04 An account writes only for its authorized station and pump. The sale product and unit come from the pump, never from a field the attendant edits. **New** captures use the assignment loaded by the current fresh online session.
- I-05 Pump reassignment is done by an authorized admin. The attendant must sign out and sign in online before using the new pump. Earlier sales and queued records keep their original pump and assignment.
- I-05a A queued record from before a reassignment is validated against **that account's assignment history at capture**, never rejected because the current pump differs, and never rewritten to match it. Uncertain capture authorization or timing goes to review, not automatic credit. (TRD "Reassignment and existing outboxes")
- I-06 Logout offers upload-first when connected. Pending records stay under the originating account. Uploads pause until that account signs in online again. A different ordinary account cannot see, upload or edit them.
- I-07 Admin users, roles and permissions are separate from attendant accounts. Permissions are action-level, deny-by-default and checked on the server for every protected read, write, export and status change.
- I-08 At least one active Owner always exists. Concurrent changes cannot remove the last Owner.
- I-09 Disabling an account or removing a permission revokes it on active sessions.
- I-10 A role administrator cannot grant more authority than they hold.
- I-11 Five sensitive permissions default to Owner only and are granted separately: `queueRecovery` (needs sales view), `cardEligibility` (needs sales view), `dateReview` (needs sales view), `giveawayFinalize` (needs leaderboard view), `giveawayRevise` (needs leaderboard view). Finalizing does not grant revising, or the reverse. `priceReview` (needs sales view) is proposed as Owner-only by default. The rest of the role matrix is proposed (D06).
- I-12 Admin password recovery uses a **verified** email only. All requests get the same generic response (no account enumeration). Reset tokens are single-use, short-lived and stored hashed. A reset revokes existing sessions and sends a security notification. Verification needs the recipient to confirm from the link; sending a link verifies nothing; an admin cannot mark an email verified by hand; changing the email clears verification.
- I-13 New admin accounts start with a temporary password and must change it at first sign-in. Plaintext passwords are never logged or stored.

## Customers and cards (F02, F03, F08)

- I-14 Registration captures name, phone and a fixed category: car owners, commercial bus drivers, three-wheeler users, bike users, keg buyers, cooking-gas customers. Category belongs to the customer; what they buy never moves them to another leaderboard.
- I-15 Phone numbers are normalized before the uniqueness check. One phone, one customer. Changing the number keeps the purchase history.
- I-16 Card codes are unique across all batches, collision-retried, reserved before print export and never reused after retirement. Lookup trims spaces and uppercases input. No fuzzy matching. Format (proposed, F&R F03): seven uppercase characters from a non-ambiguous alphabet without 0, 1, I and O, kept in one constant.
- I-17 QR scan and typed code resolve the same card. Internal IDs are UUIDs, independent of printed codes.
- I-18 Batch lifecycle is Generated → Printed → Active, forward only, server-validated, audited with actor, previous and new state, reason and server time.
- I-19 A card can be linked only when its batch is Active and the card is unassigned and not retired, checked atomically at link time (registration and replacement).
- I-20 PDF print sheets and Excel registers are generated from the reserved codes. Exporting never changes status or regenerates codes.
- I-21 Card replacement keeps the customer and retires the old card atomically. A retired card never comes back.
- I-21a Before replacing a lost card, the admin verifies a code sent to the registered phone (through the phone-verification adapter; provider undecided, D06). Replacement disables the old card immediately. If both card and phone access are lost, an in-person station-manager review comes before any number change or new card, recording the verification done and why phone verification wasn't possible. Ordinary purchases and registration never need a code. (F&R F08)

## Purchases, evidence and sync (F04, F05, TRD "Offline capture and synchronization protocol")

- I-22 Every sale has a client-generated operation ID. The database enforces one original purchase per originating account and operation ID. A repeated identical request returns the existing result. The same ID with different content is a conflict.
- I-23 The sale and its photo blob are saved atomically in IndexedDB **before** the phone shows "Saved on phone".
- I-24 Photos come from the live in-app camera only. No gallery or file picker.
- I-25 Uploads go to a unique staging path through a short-lived signed permission scoped to that pending purchase. The server reads the staged bytes under size, dimension and decode limits, checks the digest, and writes the validated bytes to a server-only final path. A reused staging URL can never change accepted evidence.
- I-26 Credit needs: resolved customer, complete details, validated photo, price checks and eligibility, accepted atomically with an audit record. Only then does the phone show "Synced".
- I-27 A definitive "customer not found" cancels the record with a reason. A network or server error leaves it pending.
- I-28 Store app capture time and server receipt time separately. Preserve the first durably recorded receipt across retries.
- I-29 Amount entry is the default; Quantity entry is available. Only the chosen value is editable. Amount mode keeps the exact entered money and derives quantity at the product's precision. Quantity mode multiplies exact decimal quantity by the captured rate and rounds money once (half-up proposed). Money has two decimals. Store basis, entered value, derived value, rate and price version.
- I-30 Liquids offer Bought into: Vehicle, Keg, Three-wheeler, Bike. Cooking gas sets Cylinder automatically, in kilograms. The server validates the medium against the pump's product.
- I-31 A sale is held for price review, with zero credit, only when its captured rate is an **unresolved or uncertain** mismatch against the price history in force at capture. A capture provably made before an activation stays valid at the earlier rate. A configuration-version change alone (for example precision only) never creates a hold, and the sync-time price alone proves nothing. Outcomes: accept captured values, correct from meter evidence (new revision), or cancel as invalid, each with a reason. A retry cannot clear the hold. (TRD "Immediate price activation", "Calculation implementation refinement")
- I-32 Price activation is immediate on server confirmation, one price per product for the station, checked against the expected configuration version. No scheduled prices. Historical sales are never repriced.
- I-33 A sale uploaded against a card replaced before upload is held for card-eligibility review with zero credit. Confirming it never reactivates the old card.
- I-34 A sale with an unreliable capture date is held until an admin records an evidence-supported verified date (no later than trusted receipt), kept separate from the original timestamp.
- I-35 Each hold (price, card, date) clears only itself. Every other check still runs before credit. Duplicate flags are **not** holds (I-40).
- I-36 Admin-assisted recovery of a stranded queue happens on the original phone, with online admin authorization, a reason and a confirmation step. It preserves the original seller and IDs, submits records for normal validation, and never grants credit, transfers ownership or unlocks the attendant account.

## Corrections, duplicates and audit (F06, F07)

- I-37 An attendant's own correction received by the server before midnight (Africa/Lagos) on the sale date applies automatically. At or after midnight it needs admin review, and the prior accepted revision keeps counting. Amended by WO-spec-3a, 4 Nov 2026: P-19 recovered unverified corrections always need independent sales AND corrections review, excluding executor and grant authorizer; never automatic treatment.
- I-38 An original sale arriving after midnight does not reopen editing. An offline correction is never merged into its original to dodge late review.
- I-39 Optimistic version checks reject a correction based on an outdated revision.
- I-40 Retries never duplicate credit. Separately entered suspected duplicates are **flagged** for an admin, who may cancel with a reason or clear the flag and keep both. A flagged, uncancelled sale follows the ordinary automatic-credit rule: there is no pre-approval queue. The original stays in the audit record. (F&R F07)
- I-41 Sensitive changes write an audit event with actor, target, previous and new values, reason and trusted time, and no secrets.

## Leaderboards, reports and giveaway (F09, F10, F11)

- I-42 Qualifying totals come from each purchase's current accepted revision, excluding cancelled, held and ineligible purchases.
- I-43 Rank by exact qualifying spend. Equal spend shares a rank. Transaction counts and quantities are shown, never used to break ties. The displayed numbering (competition ranking 1, 1, 3 via SQL `RANK()`) is a proposal pending the client; keep it in one place.
- I-44 All-time totals are kept separate from campaign-qualifying totals. Litres and kilograms are never summed together.
- I-45 Purchase cutoff, upload grace period and photo retention are configurable, versioned and audited, apply only after launch, and the UI shows the effective cutoff, deadline and timezone. Unset retention means no deletion. Unset campaign values block finalization.
- I-45a **Which clock decides what.** Server receipt decides the midnight correction rule (I-37) and the upload deadline. Whether a purchase falls **inside the purchase period** is decided by when it was made: trusted capture evidence or an admin-verified sale date, never receipt time. Grace allows late delivery of eligible purchases, not new purchases after the cutoff. Amended by WO-spec-3a, 4 Nov 2026: P-18/WHR-38 permits the bounded capturing-sign-in to first-receipt interval to establish uniform eligibility answers; varying answers remain held. Client confirmation is pending Q-528. (F&R F11)
- I-46 Finalization happens only after cutoff and grace have passed and all holds and reconciliation are resolved. It saves a numbered, frozen snapshot. Later accepted changes produce an audited new revision linked to its predecessor. Earlier snapshots are never mutated.
- I-47 Prize distribution stays manual. No prize inventory or fulfilment.

## Storage, privacy and operations (TRD)

- I-48 Photos live in private Spaces buckets per environment, under random paths with no names or phone numbers. Admins read them through authorized, short-lived signed URLs. No public CDN.
- I-49 The service worker caches only the generic capture shell and fonts. Never passwords, tokens, customer lists, photos or admin responses.
- I-50 Cache only minimal customer lookup data on the phone. Never bulk-cache phone numbers.
- I-51 Retention deletion runs only under an approved policy, skips pending evidence and active holds, and records what it deleted.
- I-52 Scheduled jobs are idempotent, bounded, leased and restartable. They never decide credit or enforce midnight.
