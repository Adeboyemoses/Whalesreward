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

/** Fail closed until all required runtime integrations have landed and been reviewed.
 * Database rows cannot assert that absent application code has been installed.
 */
export async function assertReleaseV2Installation(
  _db: Pick<pg.PoolClient, "query">,
  _stationId: string,
): Promise<void> {
  void _db;
  void _stationId;
  throw new Error("release_policy_unconfigured");
}
