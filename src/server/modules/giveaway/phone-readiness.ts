import { hasConflictingPhoneExclusion } from "./phone-exclusion-conflicts";
import { RECONCILIATION_DIGEST } from "./reconciliation-policy";
import type pg from "pg";
export type PhoneReadiness = {
  phoneCheckId: string | null;
  approvedExclusionIds: string[];
  partialExclusions: { purchaseId: string; phoneExclusionId: string }[];
  blockers: ("phone_check_required" | "phone_exclusion_pending")[];
  policyVersion: string | null;
  status: {
    managerAdminId: string | null;
    censusVersion: number;
    phoneCheckId: string | null;
    state: "missing" | "stale" | "complete";
    pendingExclusions: string;
  };
};
/** Caller holds security, reporting and campaign locks. No policy is activated here. */
export async function phoneReadiness(
  db: pg.PoolClient,
  campaignId: string,
  kind: "initial" | "revision",
): Promise<PhoneReadiness> {
  const row = (
    await db.query(
      `SELECT c.*,s.data_version::text,d.manager_admin_id,pc.version AS census_version,
 ch.content AS check_content,ch.entries,CASE WHEN pd.evaluator_identity='reconciliation-v1' AND pd.semantics_digest='${RECONCILIATION_DIGEST}' AND pd.partial_uploads='exact_incomplete' AND pd.approval_reference='WHR-158 / WHR-162 / Earl 16 Nov 2026' THEN sp.policy_version END AS policy_version
 FROM campaign c JOIN station_reporting_state s ON s.station_id=c.station_id
 LEFT JOIN giveaway_manager_designation d ON d.id=c.manager_designation_id
 LEFT JOIN giveaway_phone_census pc ON pc.id=c.phone_census_id
 LEFT JOIN giveaway_phone_check ch ON ch.id=c.phone_check_id
 LEFT JOIN station_reconciliation_policy sp ON sp.station_id=c.station_id LEFT JOIN reconciliation_policy_definition pd ON pd.policy_version=sp.policy_version
 WHERE c.id=$1`,
      [campaignId],
    )
  ).rows[0];
  const pending = (
    await db.query(
      `SELECT count(*)::text AS n FROM giveaway_phone_exclusion e
 JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true
 WHERE e.campaign_id=$1 AND t.state='pending'`,
      [campaignId],
    )
  ).rows[0].n;
  const check = row?.check_content;
  const result: PhoneReadiness = {
    phoneCheckId: null,
    approvedExclusionIds: [],
    partialExclusions: [],
    blockers: [],
    policyVersion: row?.policy_version ?? null,
    status: {
      managerAdminId: row?.manager_admin_id ?? null,
      censusVersion: row?.census_version ?? 1,
      phoneCheckId: row?.phone_check_id ?? null,
      state: check ? "stale" : "missing",
      pendingExclusions: pending,
    },
  };
  if (pending !== "0") result.blockers.push("phone_exclusion_pending");
  if (
    !check ||
    check.kind !== kind ||
    check.sourceDataVersion !== row.data_version ||
    check.settingsVersionId !== row.current_timing_version_id ||
    check.censusId !== row.phone_census_id ||
    check.designationId !== row.manager_designation_id ||
    check.previousSnapshotId !== row.latest_snapshot_id ||
    check.policyVersion !== row.policy_version
  ) {
    result.blockers.push("phone_check_required");
    return result;
  }
  const liveManager = (
    await db.query(
      `SELECT 1 FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id
    JOIN LATERAL(SELECT verified FROM held_release_person_binding WHERE station_id=$2 AND user_id=u.id ORDER BY version DESC LIMIT 1)b ON b.verified
    WHERE a.id=$1 AND u.enabled AND r.enabled AND NOT u.must_change_password
    AND (SELECT count(DISTINCT permission_code) FROM role_permission WHERE role_id=r.id AND permission_code=ANY($3::text[]))=3`,
      [
        row.manager_admin_id,
        row.station_id,
        [
          "sales",
          "leaderboards",
          kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
        ],
      ],
    )
  ).rowCount;
  if (!liveManager) {
    result.blockers.push("phone_check_required");
    return result;
  }
  for (const entry of row.entries) {
    if (entry.result !== "unavailable") continue;
    const exclusion = (
      await db.query(
        `SELECT e.content,t.state FROM giveaway_phone_exclusion e
   JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true
   WHERE e.id=$1 AND e.campaign_id=$2`,
        [entry.exclusionId, campaignId],
      )
    ).rows[0];
    if (!exclusion || exclusion.state !== "approved") {
      result.blockers.push("phone_check_required");
      return result;
    }
    if (
      await hasConflictingPhoneExclusion(
        db,
        campaignId,
        entry.exclusionId,
        exclusion.content,
      )
    ) {
      result.blockers.push("phone_check_required");
      return result;
    }
    for (const source of exclusion.content.partialSources) {
      const valid = (
        await db.query(
          `SELECT 1 FROM purchase p WHERE p.id=$1 AND p.station_id=$2 AND p.version=$3
    AND p.current_revision_id IS NULL AND NOT EXISTS(SELECT 1 FROM photo_receipt_observation o WHERE o.purchase_id=p.id)`,
          [source.purchaseId, row.station_id, source.purchaseVersion],
        )
      ).rowCount;
      if (!valid) {
        result.blockers.push("phone_check_required");
        return result;
      }
      result.partialExclusions.push({
        purchaseId: source.purchaseId,
        phoneExclusionId: entry.exclusionId,
      });
    }
    result.approvedExclusionIds.push(entry.exclusionId);
  }
  if (result.blockers.length === 0) {
    result.phoneCheckId = row.phone_check_id;
    result.status.state = "complete";
  }
  return result;
}
