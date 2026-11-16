import type pg from "pg";
import { reviewEvidenceReleaseArtifact } from "./release.ts";

/** New identity: the v1 artifact above remains byte-for-byte unchanged. */
export const reviewEvidenceV2ReleaseArtifact = `${reviewEvidenceReleaseArtifact}
review-evidence-v2
admission: complete original v1 source closure; material temporal boundary defeats every lawful ordinary outcome; missing history/policy/customer/photo/settings/deadline is not admission
paper: held_release_sheet purpose; one JPEG within meter limits; private immutable source and stripped display; uploader-person binding; live per-kind access; pilot keep-all
people: canonical server-verified identity; both actors require sales and kind permission; distinct from attendant and all recovery executors/authorizers; approver distinct from proposer; unknown denies
attestation: original I remains immutable; independent paper J intersects I; exact original context and candidate basis; confirm only selected target; cancel only photographed matching void entry
consistency: intersect all applied per-sale attested ranges with retained typed predicates and source generations; never reuse J as trusted proof for siblings or later corrections
transitions: immutable pending content; pending to approved/rejected/superseded only; guarded purchase/proposal versions; authority before historical replay; stale approval never rebases
integration: pending proposals block initial/revision/unchanged giveaway; every transition invalidates previews under shared generation locks; snapshots immutable
policy: complete proposal/person/photo/decision/audit/giveaway installation required; explicit higher scoped database-comment approval; no automatic activation or reevaluation
meter-dependency: meter-evidence-v1 is unconfigured under review-evidence-v2; no substituted dependency identity
`;

/** Installation inventory is code-owned, never asserted by an operator JSON blob.
 * M4 readiness/finalization/revision/reconciliation is installed by WHR-22.
 * Installation is not policy activation: scoped approval and verified people remain required.
 */
export const reviewEvidenceV2Installation = Object.freeze({
  proposals: true,
  canonicalPersonBinding: true,
  sheetPurpose: true,
  independentDecisions: true,
  auditTransitions: true,
  contributionConsistency: true,
  giveawayReadinessAndFinalization: true,
});
export async function assertReleaseV2Installation(
  db: Pick<pg.PoolClient, "query">,
  stationId: string,
  purpose: "mutation" | "preparation" = "mutation",
): Promise<void> {
  if (!Object.values(reviewEvidenceV2Installation).every(Boolean))
    throw new Error("release_policy_unconfigured");
  const tables = await db.query<{ installed: boolean }>(
    `SELECT to_regclass('held_release_proposal') IS NOT NULL
      AND to_regclass('held_release_transition') IS NOT NULL
      AND to_regclass('held_release_person_binding') IS NOT NULL
      AND to_regclass('held_release_sheet_validation') IS NOT NULL
      AND to_regclass('giveaway_reconciliation') IS NOT NULL
      AND to_regclass('giveaway_preview') IS NOT NULL
      AND to_regclass('giveaway_preview_consumption') IS NOT NULL
      AND to_regclass('giveaway_phone_check') IS NOT NULL
      AND to_regclass('photo_receipt_fact') IS NOT NULL AS installed`,
  );
  if (!tables.rows[0]?.installed)
    throw new Error("release_policy_unconfigured");
  const people = await db.query<{ ready: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM station WHERE id=$1) AND
      (SELECT count(DISTINCT b.person_id) FROM auth_user u JOIN admin a ON a.user_id=u.id
       JOIN LATERAL (SELECT person_id,verified FROM held_release_person_binding WHERE station_id=$1 AND user_id=u.id ORDER BY version DESC LIMIT 1) b ON b.verified
       WHERE u.enabled) >= 2 AND
      ($2::boolean OR NOT EXISTS(SELECT 1 FROM auth_user u WHERE u.enabled AND NOT EXISTS(
       SELECT 1 FROM held_release_person_binding b WHERE b.station_id=$1 AND b.user_id=u.id AND b.verified
       AND b.version=(SELECT max(x.version) FROM held_release_person_binding x WHERE x.station_id=b.station_id AND x.user_id=b.user_id)))) AS ready`,
    [stationId, purpose === "preparation"],
  );
  if (!people.rows[0]?.ready) throw new Error("release_policy_unconfigured");
}
