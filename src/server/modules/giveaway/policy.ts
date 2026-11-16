import type pg from "pg";
import { RECONCILIATION_DIGEST } from "./reconciliation-policy";
/** Registry identity is persisted and scoped. Environment strings never activate it. */
export async function recordedReconciliationPolicy(
  db: Pick<pg.PoolClient, "query">,
  stationId?: string,
): Promise<string | null> {
  const installed = (
    await db.query<{ installed: boolean }>(
      `SELECT to_regclass('giveaway_preview') IS NOT NULL AND to_regclass('giveaway_reconciliation') IS NOT NULL AND to_regclass('giveaway_phone_check') IS NOT NULL AND to_regclass('giveaway_phone_exclusion_transition') IS NOT NULL AND to_regclass('photo_receipt_observation') IS NOT NULL AND to_regclass('photo_receipt_fact') IS NOT NULL AND to_regclass('held_release_state') IS NOT NULL AND to_regclass('station_reconciliation_policy') IS NOT NULL AS installed`,
    )
  ).rows[0]?.installed;
  if (!installed) return null;
  const rows = (
    await db.query(
      `SELECT s.id,p.policy_version FROM station s LEFT JOIN station_reconciliation_policy b ON b.station_id=s.id LEFT JOIN reconciliation_policy_definition p ON p.policy_version=b.policy_version AND p.policy_version='reconciliation-v1' AND p.evaluator_identity='reconciliation-v1' AND p.semantics_digest=$2 AND p.partial_uploads='exact_incomplete' AND p.approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026' WHERE ($1::uuid IS NULL OR s.id=$1) ORDER BY s.id LIMIT 2`,
      [stationId ?? null, RECONCILIATION_DIGEST],
    )
  ).rows;
  return rows.length === 1 && rows[0]?.policy_version === "reconciliation-v1"
    ? "reconciliation-v1"
    : null;
}
