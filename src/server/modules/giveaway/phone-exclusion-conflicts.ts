import type pg from "pg";

/** Caller holds security, reporting and campaign locks. Historical evidence is read only. */
export async function hasConflictingPhoneExclusion(
  db: pg.PoolClient,
  campaignId: string,
  exclusionId: string,
  content: Record<string, unknown>,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM giveaway_phone_exclusion e
     JOIN LATERAL(SELECT state FROM giveaway_phone_exclusion_transition
       WHERE exclusion_id=e.id ORDER BY version DESC LIMIT 1)t ON true
     WHERE e.campaign_id=$1 AND e.id<>$2 AND t.state='approved'
       AND e.content->'kind' = $3::jsonb->'kind'
       AND e.content->'censusId' = $3::jsonb->'censusId'
       AND e.content->'designationId' = $3::jsonb->'designationId'
       AND e.content->'settingsVersionId' = $3::jsonb->'settingsVersionId'
       AND e.content->'previousSnapshotId' = $3::jsonb->'previousSnapshotId'
       AND e.content->'policyVersion' = $3::jsonb->'policyVersion'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.content->'partialSources') a,
         jsonb_array_elements($3::jsonb->'partialSources') b
         WHERE a->'purchaseId'=b->'purchaseId' AND a->'purchaseVersion'=b->'purchaseVersion')
     LIMIT 1`,
    [campaignId, exclusionId, JSON.stringify(content)],
  );
  return (result.rowCount ?? 0) > 0;
}
