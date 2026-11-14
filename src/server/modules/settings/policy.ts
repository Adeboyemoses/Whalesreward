import { timingEvaluatorInstalled, TIMING_SEMANTICS_DIGEST } from "./evaluator";
export {
  timingEvaluatorInstalled,
  TIMING_SEMANTICS_DIGEST,
  TIMING_SEMANTICS,
} from "./evaluator";
import type pg from "pg";
import { AuthError } from "../auth/errors";
export const TIMING_POLICY_VERSION = "campaign-timing-v1";
export const TIMING_EVALUATOR = "campaign-timing-v1";
export const TIMING_APPROVAL = "WHR-138 / Whales 13 Nov / Earl 14 Nov 2026";
/** Synchronous environment status cannot establish a persisted station approval. */
export function timingPolicyConfigured(): boolean {
  return false;
}
export async function recordedTimingPolicy(
  db: Pick<pg.PoolClient, "query">,
  stationId?: string,
): Promise<string | null> {
  if (!timingEvaluatorInstalled()) return null;
  const rows = (
    await db.query(
      `SELECT s.id,p.policy_version,p.evaluator_identity,p.semantics_digest,p.approval_reference
    FROM station s LEFT JOIN station_timing_policy b ON b.station_id=s.id AND b.policy_version=$1
    LEFT JOIN timing_policy_definition p ON p.policy_version=b.policy_version
    WHERE ($2::uuid IS NULL OR s.id=$2) ORDER BY s.id LIMIT 2`,
      [TIMING_POLICY_VERSION, stationId ?? null],
    )
  ).rows;
  return rows.length === 1 &&
    rows[0].policy_version === TIMING_POLICY_VERSION &&
    rows[0].evaluator_identity === TIMING_EVALUATOR &&
    rows[0].semantics_digest === TIMING_SEMANTICS_DIGEST &&
    rows[0].approval_reference === TIMING_APPROVAL
    ? TIMING_POLICY_VERSION
    : null;
}
export async function requireTimingPolicy(
  db: Pick<pg.PoolClient, "query">,
  stationId: string,
) {
  const version = await recordedTimingPolicy(db, stationId);
  if (!version) throw new AuthError("timing_policy_unconfigured", 409);
  return version;
}
